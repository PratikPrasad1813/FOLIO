"use client";

import { extractActionPlan, AI_ACTION_PLAN_CLOSE, AI_ACTION_PLAN_OPEN } from "@/lib/folio-ai/actions";
import { estimateTokenCount, FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import type { LocalAIProvider, LocalChatMessage } from "@/lib/folio-ai/provider";
import type { FolioAIModelInfo } from "@/lib/folio-ai/models";
import type { AIProgress } from "@/lib/folio-ai/types";
import type { LocalModelSpec } from "@/lib/folio-ai/model-catalog";
import { WebLLMProvider } from "@/lib/folio-ai/webllm-provider";

type WorkflowRole = "planner" | "reviewer" | "writer" | "action";
interface WorkflowStage { model: LocalModelSpec; role: WorkflowRole; outputTokens: number }

const MODEL_ROLE_PREFERENCE: Record<WorkflowRole, string[]> = {
  planner: ["qwen2.5-7b", "qwen2.5-3b", "phi-3.5-mini", "gemma-2-2b"],
  reviewer: ["phi-3.5-mini", "qwen2.5-3b", "qwen2.5-7b", "gemma-2-2b"],
  writer: ["gemma-2-2b", "phi-3.5-mini", "qwen2.5-3b", "qwen2.5-7b"],
  action: ["qwen2.5-3b", "qwen2.5-7b", "phi-3.5-mini", "gemma-2-2b"],
};

export function createQualityWorkflow(models: readonly LocalModelSpec[]): WorkflowStage[] {
  if (models.length < 2) return [];
  const remaining = new Map(models.map(model => [model.id, model]));
  const stages: WorkflowStage[] = [];
  const roleOrder: WorkflowRole[] = models.length >= 4
    ? ["planner", "reviewer", "writer", "action"]
    : models.length === 3
      ? ["planner", "reviewer", "writer"]
      : ["planner", "writer"];

  for (const role of roleOrder) {
    const model = MODEL_ROLE_PREFERENCE[role]
      .map(id => remaining.get(id))
      .find((candidate): candidate is LocalModelSpec => Boolean(candidate));
    if (!model) continue;
    remaining.delete(model.id);
    stages.push({ model, role, outputTokens: role === "writer" ? 768 : role === "reviewer" ? 256 : 512 });
  }
  for (const model of remaining.values()) {
    stages.push({ model, role: "reviewer", outputTokens: 256 });
  }
  return stages;
}

function modelInfo(model: LocalModelSpec): FolioAIModelInfo {
  return {
    tier: model.category === "fast" ? "lightweight" : model.category === "structured" ? "balanced" : "high",
    modelId: model.webLlmModelId,
    modelName: model.name,
    approximateDownloadBytes: model.approximateDownloadBytes,
    requiredGpuMemoryMB: Math.round(model.minRamGb * 1024 * 0.75),
    contextWindowTokens: 4_096,
    description: model.tagline,
    advantage: model.strengths.join(", "),
    limitation: model.tradeoffs?.join(", ") ?? `Suggested system memory: ${model.minRamGb} GB or more.`,
    verifiedInWebLLM: true,
  };
}

function stageInstruction(role: WorkflowRole, finalWriter: boolean): string {
  switch (role) {
    case "planner":
      return "You are the planning stage of a private multi-model Folio workflow. Break the user's request into a concise, realistic sequence of outcomes and dependencies. Do not write the final answer or emit action-protocol markers. Do not invent workspace data.";
    case "reviewer":
      return "Review and improve the proposed plan for missing steps, feasibility, and dependencies. Return only a concise corrected plan. Do not answer the user or emit action-protocol markers.";
    case "writer":
      return `Write the final helpful response to the user based on their request and the reviewed plan. Be concise but cover the important deliverables. Do not claim workspace changes are complete. ${finalWriter ? "If Folio workspace actions are explicitly requested, append one valid action-plan block following the system instructions." : "Do not emit an action-plan block; a separate stage will prepare any requested Folio actions."}`;
    case "action":
      return `Prepare only the action-plan block for Folio workspace changes explicitly requested by the user, using the system action protocol. Use the reviewed plan and proposed response as context. Do not claim actions were executed. If no workspace change is explicitly requested, output exactly NO_ACTIONS.`;
  }
}

function buildStageMessages(
  stage: WorkflowStage,
  source: LocalChatMessage[],
  outputs: Partial<Record<WorkflowRole, string>>,
  finalWriter: boolean,
): LocalChatMessage[] {
  const system = source.find(message => message.role === "system")?.content ?? "";
  const conversation = source.filter(message => message.role !== "system");
  const latestPrompt = [...conversation].reverse().find(message => message.role === "user")?.content ?? "";
  const instruction = stageInstruction(stage.role, finalWriter);

  if (stage.role === "planner") {
    const first = conversation[0]?.role === "user" ? 1 : 0;
    return [
      { role: "system", content: `${system}\n\n${instruction}` },
      ...conversation.slice(first),
    ];
  }

  const context = [
    `User request:\n${latestPrompt}`,
    outputs.planner ? `Proposed plan:\n${outputs.planner}` : "",
    outputs.reviewer ? `Plan review:\n${outputs.reviewer}` : "",
    outputs.writer && stage.role === "action" ? `Proposed response:\n${outputs.writer}` : "",
  ].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: `${system}\n\n${instruction}` },
    { role: "user", content: context },
  ];
}

export class MultiModelWorkflowProvider implements LocalAIProvider {
  readonly providerId = "folio-multi-model";
  readonly inferenceLocation = "local" as const;
  readonly modelId = "folio-multi-model-v1";
  readonly modelName = "Folio multi-model workflow";
  private activeProvider: WebLLMProvider | null = null;
  private readonly stages: WorkflowStage[];

  constructor(stages: WorkflowStage[]) {
    if (stages.length < 2) throw new Error("A multi-model workflow needs at least two installed quality models.");
    this.stages = stages;
  }

  async initialize(onProgress: (progress: AIProgress) => void): Promise<{ cached: boolean }> {
    onProgress({ progress: 1, text: "Quality models are ready for a staged local workflow.", cached: true });
    return { cached: true };
  }

  async generate(
    messages: LocalChatMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
    onStage?: (stage: string) => void,
    onUsage?: (tokens: number) => void,
  ) {
    const outputs: Partial<Record<WorkflowRole, string>> = {};
    let promptTokens = 0;
    let outputTokens = 0;
    const finalWriter = !this.stages.some(stage => stage.role === "action");

    for (let index = 0; index < this.stages.length; index += 1) {
      if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
      const stage = this.stages[index];
      onStage?.(`${stage.role === "planner" ? "Planning" : stage.role === "reviewer" ? "Reviewing the plan" : stage.role === "writer" ? "Writing the response" : "Preparing Folio actions"} · ${index + 1} of ${this.stages.length} · ${stage.model.name}`);
      const provider = new WebLLMProvider(modelInfo(stage.model), stage.outputTokens);
      this.activeProvider = provider;
      try {
        await provider.initialize(progress => {
          onStage?.(`${stage.role === "planner" ? "Planning" : stage.role === "reviewer" ? "Reviewing the plan" : stage.role === "writer" ? "Writing the response" : "Preparing Folio actions"} · ${index + 1} of ${this.stages.length} · ${progress.text}`);
        });
        const stageMessages = buildStageMessages(stage, messages, outputs, finalWriter);
        const estimatedStagePromptTokens = estimateTokenCount(stageMessages.map(message => message.content).join("\n"));
        onUsage?.(promptTokens + outputTokens + estimatedStagePromptTokens);
        let stageOutput = "";
        const result = await provider.generate(stageMessages, signal, token => {
          stageOutput += token;
          onUsage?.(promptTokens + outputTokens + estimatedStagePromptTokens + estimateTokenCount(stageOutput));
        });
        outputs[stage.role] = result.text;
        promptTokens += result.promptTokens ?? estimatedStagePromptTokens;
        outputTokens += result.outputTokens || estimateTokenCount(result.text);
        onUsage?.(promptTokens + outputTokens);
      } finally {
        this.activeProvider = null;
        await provider.unload();
      }
    }

    const written = outputs.writer?.trim();
    if (!written) throw new Error("The writing model finished without a response.");
    const actionOutput = outputs.action?.trim();
    const actions = actionOutput ? extractActionPlan(actionOutput) : null;
    const finalText = actions?.length
      ? `${written}\n\n${AI_ACTION_PLAN_OPEN}\n${JSON.stringify({ actions, rationale: "Prepared from the reviewed multi-model plan." })}\n${AI_ACTION_PLAN_CLOSE}`
      : written;
    for (let offset = 0; offset < finalText.length; offset += 32) {
      if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
      onToken(finalText.slice(offset, offset + 32));
    }
    return { text: finalText, outputTokens, promptTokens };
  }

  async interrupt() {
    await this.activeProvider?.interrupt();
  }

  async resetConversation() {
    await this.activeProvider?.resetConversation();
  }

  async unload() {
    await this.activeProvider?.unload();
    this.activeProvider = null;
  }
}

export function isQualityWorkflowAvailable(
  stages: readonly WorkflowStage[],
  complexPrompt: boolean,
): boolean {
  return complexPrompt && stages.length >= 2 &&
    stages.reduce((total, stage) => total + stage.outputTokens, 0) <= FOLIO_AI_CONFIG.maxReservedTokensPerOrchestratedGeneration;
}
