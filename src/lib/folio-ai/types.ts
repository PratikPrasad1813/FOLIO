export type AIMessageRole = "user" | "assistant";

export type AITaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export const AI_TASK_STATUSES: AITaskStatus[] = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
];

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  createdAt: number;
  generationId?: string;
  generationStatus?: "complete" | "cancelled" | "error";
  taskId?: string;
  taskStatus?: AITaskStatus;
  stage?: string;
  tokenCount?: number;
  errorMessage?: string;
  plan?: { actions: { id: string; params: Record<string, unknown> }[] } | null;
  results?: AIActionResult[] | null;
}

export interface AITaskRecord {
  id: string;
  conversationId: string;
  generationId: string;
  reservationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  prompt: string;
  modelId: string;
  status: AITaskStatus;
  stage: string;
  partialContent: string;
  tokenCount: number;
  usageTokenCount: number;
  plan: { actions: { id: string; params: Record<string, unknown> }[] } | null;
  results: AIActionResult[] | null;
  errorMessage: string | null;
  startedAt: string;
  heartbeatAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIUsage {
  plan: "free";
  modelId: string;
  usageDate: string;
  usedPercent: number;
  limitReached: boolean;
  resetAt: string;
}

export interface AIReservation {
  id: string;
  generationId: string;
  usageDate: string;
  expiresAt: string;
}

export interface AIProgress {
  progress: number;
  text: string;
  cached: boolean;
}

export type AICompatibilityState = "checking" | "supported" | "caution" | "unsupported";
export interface AICompatibility {
  state: AICompatibilityState;
  title: string;
  message: string;
  adapter?: string;
  deviceMemoryGB?: number;
}

export type AIInitErrorKind = "unsupported" | "resource" | "download" | "initialization";
export interface FolioAIError extends Error {
  kind: AIInitErrorKind;
  retryable: boolean;
}

export type AssistantPresentation = "neutral" | "feminine" | "masculine" | "custom";
export type AssistantStyle = "professional" | "friendly" | "concise" | "motivational" | "calm";
export const ASSISTANT_PRESENTATIONS: AssistantPresentation[] = ["neutral", "feminine", "masculine", "custom"];
export const ASSISTANT_STYLES: AssistantStyle[] = ["professional", "friendly", "concise", "motivational", "calm"];
export interface AIPreferences {
  assistantName: string;
  presentation: AssistantPresentation;
  style: AssistantStyle;
  modelPreference: "automatic" | "lightweight" | "balanced" | "high";
  selectedModelId: string | null;
}

export interface AIActionPlan {
  actions: { id: string; params: Record<string, unknown> }[];
  rationale?: string;
}

export interface AIActionResult {
  actionId: string;
  ok: boolean;
  summary: string;
  error?: string;
  result?: unknown;
}
