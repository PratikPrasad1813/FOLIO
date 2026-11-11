"use client";

/**
 * Browser-side BYOK provider. Reads the user's own AI credentials from
 * localStorage and passes them to the Folio server route via request headers;
 * the server forwards inference to the chosen provider and streams tokens back
 * in a provider-neutral SSE format.
 */
import type { AIProvider, ChatMessage } from "@/lib/folio-ai/provider";
import type { AIProgress } from "@/lib/folio-ai/types";
import type { BYOKProviderId } from "@/lib/folio-ai/byok-service";

export const BYOK_STORAGE = {
  provider: "folio_ai_provider",
  keyPrefix: "folio_ai_key_",
  modelPrefix: "folio_ai_model_",
} as const;

export const BYOK_PROVIDER_OPTIONS: {
  id: BYOKProviderId;
  label: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  keyUrl: string;
  keyLabel: string;
  keyHint: string;
}[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "console.anthropic.com",
    keyHint: "Starts with sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "platform.openai.com",
    keyHint: "Starts with sk-…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-4o-mini",
    models: [
      { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini" },
      { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
      { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku" },
    ],
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "openrouter.ai/keys",
    keyHint: "Starts with sk-or-…",
  },
  {
    id: "google",
    label: "Google AI Studio",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-4-argon", label: "Gemini 4 Argon" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
    ],
    keyUrl: "https://aistudio.google.com/apikey",
    keyLabel: "aistudio.google.com",
    keyHint: "Starts with AIza…",
  },
];

export interface StoredBYOKSettings {
  provider: BYOKProviderId;
  apiKey: string;
  model: string;
}

export function isBYOKProviderId(value: unknown): value is BYOKProviderId {
  return typeof value === "string" && BYOK_PROVIDER_OPTIONS.some(option => option.id === value);
}

export function readStoredBYOKSettings(): StoredBYOKSettings | null {
  if (typeof window === "undefined") return null;
  const provider = window.localStorage.getItem(BYOK_STORAGE.provider);
  if (!isBYOKProviderId(provider)) return null;
  const apiKey = (window.localStorage.getItem(BYOK_STORAGE.keyPrefix + provider) ?? "").trim();
  if (!apiKey) return null;
  const option = BYOK_PROVIDER_OPTIONS.find(item => item.id === provider);
  const model = (window.localStorage.getItem(BYOK_STORAGE.modelPrefix + provider) ?? "").trim() || option?.defaultModel || "";
  return { provider, apiKey, model };
}

export function saveStoredBYOKSettings(settings: StoredBYOKSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BYOK_STORAGE.provider, settings.provider);
  window.localStorage.setItem(BYOK_STORAGE.keyPrefix + settings.provider, settings.apiKey.trim());
  window.localStorage.setItem(BYOK_STORAGE.modelPrefix + settings.provider, settings.model.trim());
}

export function clearStoredBYOKSettings(provider?: BYOKProviderId): void {
  if (typeof window === "undefined") return;
  const target = provider ?? window.localStorage.getItem(BYOK_STORAGE.provider);
  if (!target) return;
  window.localStorage.removeItem(BYOK_STORAGE.keyPrefix + target);
  window.localStorage.removeItem(BYOK_STORAGE.modelPrefix + target);
  if (!provider || provider === window.localStorage.getItem(BYOK_STORAGE.provider)) {
    window.localStorage.removeItem(BYOK_STORAGE.provider);
  }
}

function byokHeaders(settings: StoredBYOKSettings): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-user-ai-provider": settings.provider,
    "x-user-ai-key": settings.apiKey,
    "x-user-ai-model": settings.model,
  };
}

interface NeutralChunk {
  type?: "token" | "usage" | "error";
  text?: string;
  promptTokens?: number;
  outputTokens?: number;
  message?: string;
}

export class MissingKeyError extends Error {
  constructor() {
    super("Please provide an API key in AI Settings.");
    this.name = "MissingKeyError";
  }
}

export class BYOKProvider implements AIProvider {
  readonly providerId: BYOKProviderId;
  readonly inferenceLocation = "hosted" as const;
  readonly modelId: string;
  readonly modelName: string;

  private settings: StoredBYOKSettings;

  constructor(settings?: StoredBYOKSettings | null) {
    const stored = settings ?? readStoredBYOKSettings();
    if (!stored) throw new MissingKeyError();
    this.settings = stored;
    this.providerId = stored.provider;
    this.modelId = stored.model;
    const option = BYOK_PROVIDER_OPTIONS.find(item => item.id === stored.provider);
    const modelLabel = option?.models.find(model => model.id === stored.model)?.label ?? stored.model;
    this.modelName = `${option?.label ?? "Your AI"} · ${modelLabel}`;
  }

  static isConfigured(): boolean {
    return readStoredBYOKSettings() !== null;
  }

  async initialize(onProgress: (progress: AIProgress) => void): Promise<{ cached: boolean }> {
    onProgress({ progress: 0.4, text: "Connecting to your AI provider…", cached: false });
    const response = await fetch("/api/ai/generate", { cache: "no-store", headers: byokHeaders(this.settings) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not reach the Folio AI service.");
    if (body.configured !== true) throw new MissingKeyError();
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
    if (!taskId) throw new Error("Folio AI generation requires an active Folio AI task.");
    onStage?.("Connecting to your AI provider…");
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      headers: byokHeaders(this.settings),
      body: JSON.stringify({ taskId, messages }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 400 && body.code === "api_key_required") throw new MissingKeyError();
      throw new Error(body.error || `Your AI provider request failed (${response.status}).`);
    }
    if (!response.body) throw new Error("Your AI provider returned an empty response stream.");

    onStage?.("Your assistant is thinking through the request…");
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
      let chunk: NeutralChunk;
      try {
        chunk = JSON.parse(data) as NeutralChunk;
      } catch {
        throw new Error("Folio AI received a malformed streaming response.");
      }
      if (chunk.type === "error") throw new Error(chunk.message || "Your AI provider could not complete the request.");
      if (chunk.type === "token" && chunk.text) {
        text += chunk.text;
        onToken(chunk.text);
      }
      if (chunk.type === "usage") {
        if (typeof chunk.promptTokens === "number") promptTokens = chunk.promptTokens;
        if (typeof chunk.outputTokens === "number") outputTokens = chunk.outputTokens;
        const total = (promptTokens ?? 0) + outputTokens;
        if (total > 0) onUsage?.(total);
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
    if (!text.trim()) throw new Error("Your AI provider returned no text. Try rephrasing the request.");
    return { text: text.trim(), outputTokens, promptTokens };
  }

  async interrupt() {}
  async resetConversation() {}
  async unload() {}
}
