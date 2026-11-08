"use client";

import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import type { AIProvider, ChatMessage } from "@/lib/folio-ai/provider";
import type { AIProgress } from "@/lib/folio-ai/types";

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GoogleGeminiProvider implements AIProvider {
  readonly providerId = "google-gemini";
  readonly inferenceLocation = "hosted" as const;
  readonly modelId = FOLIO_AI_CONFIG.modelId;
  readonly modelName = FOLIO_AI_CONFIG.modelName;

  async initialize(onProgress: (progress: AIProgress) => void): Promise<{ cached: boolean }> {
    onProgress({ progress: 0.4, text: "Connecting securely to Google Gemini…", cached: false });
    const response = await fetch("/api/ai/generate", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not connect to Google Gemini.");
    if (body.configured !== true) {
      throw new Error("Folio AI is not configured yet. Add GEMINI_API_KEY to the server environment and restart the app.");
    }
    onProgress({ progress: 1, text: `${this.modelName} is ready.`, cached: false });
    return { cached: false };
  }

  async generate(
    messages: ChatMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
    onStage?: (stage: string) => void,
    onUsage?: (tokens: number) => void,
    taskId?: string,
  ): Promise<{ text: string; outputTokens: number; promptTokens?: number }> {
    if (!taskId) throw new Error("Gemini generation requires an active Folio AI task.");
    onStage?.("Connecting to Google Gemini…");
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, messages }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Google Gemini request failed (${response.status}).`);
    }
    if (!response.body) throw new Error("Google Gemini returned an empty response stream.");

    onStage?.("Gemini is thinking through your request…");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let promptTokens: number | undefined;
    let outputTokens = 0;

    const consumeEvent = (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim())
        .join("\n");
      if (!data) return;
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(data) as GeminiChunk;
      } catch {
        throw new Error("Google Gemini sent a malformed streaming response.");
      }
      const token = (chunk.candidates ?? [])
        .flatMap(candidate => candidate.content?.parts ?? [])
        .map(part => part.text ?? "")
        .join("");
      if (token) {
        text += token;
        onToken(token);
      }
      const usage = chunk.usageMetadata;
      if (usage) {
        if (typeof usage.promptTokenCount === "number") promptTokens = usage.promptTokenCount;
        if (typeof usage.candidatesTokenCount === "number") outputTokens = usage.candidatesTokenCount;
        const total = usage.totalTokenCount ??
          (promptTokens === undefined ? undefined : promptTokens + outputTokens);
        if (total !== undefined) onUsage?.(total);
      }
    };

    try {
      while (true) {
        if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) consumeEvent(event);
        if (done) break;
      }
      if (buffer.trim()) consumeEvent(buffer);
    } finally {
      reader.releaseLock();
    }

    if (signal.aborted) throw new DOMException("Generation stopped.", "AbortError");
    if (!text.trim()) throw new Error("Google Gemini returned no text. Try rephrasing the request.");
    return { text: text.trim(), outputTokens, promptTokens };
  }

  async interrupt() {}
  async resetConversation() {}
  async unload() {}
}
