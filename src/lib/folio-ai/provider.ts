import type { AIProgress } from "@/lib/folio-ai/types";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface AIProvider {
  readonly providerId: string;
  readonly inferenceLocation: "hosted";
  readonly modelId: string;
  readonly modelName: string;
  initialize(onProgress: (progress: AIProgress) => void): Promise<{ cached: boolean }>;
  generate(
    messages: ChatMessage[],
    signal: AbortSignal,
    onToken: (token: string) => void,
    onStage?: (stage: string) => void,
    onUsage?: (tokens: number) => void,
    taskId?: string,
  ): Promise<{ text: string; outputTokens: number; promptTokens?: number }>;
  interrupt(): Promise<void>;
  resetConversation(): Promise<void>;
  unload(): Promise<void>;
}

export interface AIActionDefinition<Args = unknown, Result = unknown> {
  id: string;
  description: string;
  confirmation: "none" | "preview" | "explicit";
  validate(input: unknown): Args;
  /** Implementations must live server-side and use authenticated Folio services. */
  execute?: (userId: string, input: Args) => Promise<Result>;
}
