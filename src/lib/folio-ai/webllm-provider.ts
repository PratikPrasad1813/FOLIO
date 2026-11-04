"use client";

import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import type { AIProgress } from "@/lib/folio-ai/types";
import type { LocalAIProvider, LocalChatMessage } from "@/lib/folio-ai/provider";
import type { FolioAIModelInfo } from "@/lib/folio-ai/models";

/** Dynamically imported only after the user chooses to load the local model. */
export class WebLLMProvider implements LocalAIProvider {
  readonly providerId = "webllm" as const;
  readonly inferenceLocation = "local" as const;
  readonly modelId: string;
  readonly modelName: string;
  private engine: import("@mlc-ai/web-llm").WebWorkerMLCEngine | null = null;
  private worker: Worker | null = null;
  private initialization: Promise<{ cached: boolean }> | null = null;
  private progress: (value: AIProgress) => void = () => {};

  constructor(model: FolioAIModelInfo) {
    this.modelId = model.modelId;
    this.modelName = model.modelName;
  }

  initialize(onProgress: (value: AIProgress) => void): Promise<{ cached: boolean }> {
    this.progress = onProgress;
    if (this.engine) return Promise.resolve({ cached: true });
    if (this.initialization) return this.initialization;
    this.initialization = this.load().catch(error => {
      this.worker?.terminate();
      this.worker = null;
      this.engine = null;
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  private async load(): Promise<{ cached: boolean }> {
    this.progress({ progress: 0, text: "Checking the local model registry…", cached: false });
    const webllm = await import("@mlc-ai/web-llm");
    const model = webllm.prebuiltAppConfig.model_list.find(record => record.model_id === this.modelId);
    if (!model) throw new Error(`The installed WebLLM build does not include ${this.modelId}. Install the supported WebLLM version or update the model in Folio AI settings.`);
    const cached = await webllm.hasModelInCache(this.modelId, webllm.prebuiltAppConfig).catch(() => false);
    this.progress({ progress: 0.01, text: cached ? "Found model files in this browser’s cache. Preparing WebGPU…" : `Preparing ${this.modelName} (${webllm.modelVersion})…`, cached });
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module", name: "folio-local-ai" });
    worker.addEventListener("error", event => {
      console.error("Folio AI WebWorker error:", event.message);
    });
    this.worker = worker;
    try {
      const engine = await webllm.CreateWebWorkerMLCEngine(worker, this.modelId, {
        appConfig: webllm.prebuiltAppConfig,
        logLevel: "ERROR",
        initProgressCallback: report => {
          this.progress({
            progress: Math.max(0, Math.min(1, report.progress)),
            text: report.text || (cached ? "Initializing the cached model…" : "Downloading model files…"),
            cached,
          });
        },
      });
      this.engine = engine;
      this.progress({ progress: 1, text: "Local model ready on this device.", cached });
      return { cached };
    } catch (error) {
      worker.terminate();
      this.worker = null;
      throw error;
    }
  }

  async generate(messages: LocalChatMessage[], signal: AbortSignal, onToken: (token: string) => void) {
    if (!this.engine) throw new Error("Load the local AI model before sending a message.");
    const engine = this.engine;
    const interrupt = () => { void engine.interruptGenerate(); };
    signal.addEventListener("abort", interrupt, { once: true });
    let text = "";
    let outputTokens = 0;
    try {
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.65,
        top_p: 0.9,
        max_tokens: FOLIO_AI_CONFIG.maxOutputTokens,
      });
      for await (const chunk of stream) {
        if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
        const token = chunk.choices[0]?.delta?.content;
        if (typeof token === "string" && token) { text += token; onToken(token); }
        if (chunk.usage?.completion_tokens) outputTokens = chunk.usage.completion_tokens;
      }
      if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
      return { text: text.trim(), outputTokens };
    } catch (error) {
      if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
      throw error;
    } finally {
      signal.removeEventListener("abort", interrupt);
    }
  }

  async interrupt() { if (this.engine) await this.engine.interruptGenerate(); }
  async resetConversation() { if (this.engine) await this.engine.resetChat(true, this.modelId); }
  async unload() {
    try { await this.engine?.unload(); }
    finally { this.engine = null; this.initialization = null; this.worker?.terminate(); this.worker = null; }
  }
}
