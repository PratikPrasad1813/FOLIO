import type { AIProgress } from "@/lib/folio-ai/types";

export interface LocalChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface AIInferenceProvider {
  readonly providerId: string;
  readonly inferenceLocation: "local" | "hosted";
  readonly modelId: string;
  readonly modelName: string;
  initialize(onProgress: (progress: AIProgress) => void): Promise<{ cached: boolean }>;
  generate(
    messages: LocalChatMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
    onStage?: (stage: string) => void,
    onUsage?: (tokens: number) => void,
  ): Promise<{ text: string; outputTokens: number; promptTokens?: number }>;
  interrupt(): Promise<void>;
  resetConversation(): Promise<void>;
  unload(): Promise<void>;
}

/** Phase 1 uses a local implementation. A future hosted provider can implement
 * the same neutral interface without changing Folio AI's chat/action clients. */
export interface LocalAIProvider extends AIInferenceProvider {
  readonly inferenceLocation: "local";
}

export interface AIActionDefinition<Args = unknown, Result = unknown> {
  id: string;
  description: string;
  confirmation: "none" | "preview" | "explicit";
  validate(input: unknown): Args;
  /** Implementations must live server-side and use authenticated Folio services. */
  execute?: (userId: string, input: Args) => Promise<Result>;
}
