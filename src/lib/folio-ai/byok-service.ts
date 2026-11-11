/**
 * Folio AI BYOK engine (server-side only).
 *
 * Folio ships no central AI provider key. Every inference request carries the
 * user's own credentials through request headers, and this module is the single
 * place where third-party AI SDKs are constructed or called:
 *
 *   anthropic   -> @anthropic-ai/sdk   (Claude 3.5 Sonnet / Haiku)
 *   openai      -> openai              (GPT-4o / GPT-4o-mini)
 *   openrouter  -> openai              (same SDK, OpenRouter base URL)
 *   google      -> openai              (same SDK, Google AI Studio's official
 *                                      OpenAI-compatible endpoint)
 *
 * Nothing here may read provider credentials from the environment; a request
 * without a user-supplied key fails fast with `api_key_required`.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AIUsageError } from "@/lib/folio-ai/usage";
import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";

export type BYOKProviderId = "anthropic" | "openai" | "openrouter" | "google";

export const BYOK_PROVIDER_IDS: BYOKProviderId[] = ["anthropic", "openai", "openrouter", "google"];

export interface BYOKConfig {
  provider: BYOKProviderId;
  apiKey: string;
  model: string;
}

export interface BYOKProviderMeta {
  id: BYOKProviderId;
  label: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  keyUrl: string;
  keyLabel: string;
}

export const BYOK_PROVIDERS: Record<BYOKProviderId, BYOKProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude 3.5 Sonnet)",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet — best quality" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku — fastest" },
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "console.anthropic.com",
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT-4o)",
    defaultModel: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini — efficient default" },
      { id: "gpt-4o", label: "GPT-4o — most capable" },
    ],
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "platform.openai.com",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (multi-provider)",
    defaultModel: "openai/gpt-4o-mini",
    models: [
      { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini" },
      { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
      { id: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
      { id: "anthropic/claude-3.5-haiku", label: "Anthropic Claude 3.5 Haiku" },
    ],
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "openrouter.ai/keys",
  },
  google: {
    id: "google",
    label: "Google AI Studio (Gemini)",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite — fast default" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash — most intelligent Flash" },
      { id: "gemini-4-argon", label: "Gemini 4 Argon — flagship reasoning" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro — advanced reasoning (preview)" },
    ],
    keyUrl: "https://aistudio.google.com/apikey",
    keyLabel: "aistudio.google.com",
  },
};

export function isBYOKProviderId(value: unknown): value is BYOKProviderId {
  return typeof value === "string" && (BYOK_PROVIDER_IDS as string[]).includes(value);
}

const HEADER_KEY = "x-user-ai-key";
const HEADER_PROVIDER = "x-user-ai-provider";
const HEADER_MODEL = "x-user-ai-model";

/**
 * Extracts and validates the BYOK credentials attached to an AI request.
 * Throws a 400 `api_key_required` error when no usable key is present.
 */
export function requireBYOKConfig(request: Request): BYOKConfig {
  const apiKey = (request.headers.get(HEADER_KEY) ?? "").trim();
  const providerRaw = (request.headers.get(HEADER_PROVIDER) ?? "").trim();
  const modelRaw = (request.headers.get(HEADER_MODEL) ?? "").trim();

  if (!apiKey) {
    throw new AIUsageError("Please provide an API key in AI Settings.", 400, "api_key_required");
  }
  if (apiKey.length < 8 || apiKey.length > 512) {
    throw new AIUsageError("Please provide an API key in AI Settings.", 400, "api_key_required");
  }
  if (!isBYOKProviderId(providerRaw)) {
    throw new AIUsageError("Please provide an API key in AI Settings.", 400, "api_key_required");
  }
  const meta = BYOK_PROVIDERS[providerRaw];
  const model = modelRaw && modelRaw.length <= 200 ? modelRaw : meta.defaultModel;
  return { provider: providerRaw, apiKey, model };
}

/** OpenAI-compatible base URLs: providers reachable through the `openai` SDK. */
const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<BYOKProviderId, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  // Google AI Studio's official OpenAI-compatible endpoint (streaming and
  // stream_options.include_usage are supported; unknown parameters are ignored).
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
};

/** Builds the provider SDK client for a BYOK config. Never cached — keys are per-request. */
export function createBYOKClient(config: BYOKConfig): { kind: "anthropic"; client: Anthropic } | { kind: "openai"; client: OpenAI } {
  if (config.provider === "anthropic") {
    return {
      kind: "anthropic",
      client: new Anthropic({ apiKey: config.apiKey, maxRetries: 0 }),
    };
  }
  const baseURL = OPENAI_COMPATIBLE_BASE_URLS[config.provider];
  return {
    kind: "openai",
    client: new OpenAI({
      apiKey: config.apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 0,
      ...(config.provider === "openrouter" ? { defaultHeaders: { "X-Title": "Folio Workspace Studio" } } : {}),
    }),
  };
}

/**
 * Translates provider SDK failures (rejected keys, rate limits, bad requests)
 * into AIUsageErrors so every BYOK provider surfaces the same calm, actionable
 * message. Unknown or non-HTTP failures fall through unchanged to the generic
 * handler in @/lib/folio-ai/http.
 */
function wrapProviderError(error: unknown): unknown {
  if (error instanceof AIUsageError) return error;
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  if (status < 400) return error; // includes AbortError and network teardown
  const raw = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403 || /api[ _-]?key|unregistered|authentication/i.test(raw)) {
    return new AIUsageError("Your AI provider rejected the API key. Check the provider and key in AI Settings.", 502, "provider_auth_error");
  }
  if (status === 429) {
    return new AIUsageError("Your AI provider is rate limiting this key. Wait a moment and try again.", 502, "provider_rate_limited");
  }
  return new AIUsageError("Your AI provider could not complete this request. Try again or pick another model in AI Settings.", 502, "provider_error");
}

export interface StreamChatOptions {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal: AbortSignal;
  maxOutputTokens: number;
  onToken: (text: string) => void;
  onUsage?: (usage: { promptTokens?: number; outputTokens?: number }) => void;
}

/**
 * Streams a chat completion from the configured provider, forwarding tokens as
 * they arrive. System messages are folded into the provider-native system slot
 * (Anthropic top-level `system`, OpenAI `system` role).
 */
export async function streamBYOKChat(config: BYOKConfig, options: StreamChatOptions): Promise<void> {
  const client = createBYOKClient(config);
  const systemText = options.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const chatMessages = options.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (client.kind === "anthropic") {
    let stream;
    try {
      stream = await client.client.messages.create(
        {
          model: config.model,
          max_tokens: Math.max(256, options.maxOutputTokens),
          ...(systemText ? { system: systemText } : {}),
          messages: chatMessages,
          stream: true,
        },
        { signal: options.signal },
      );
    } catch (error) {
      throw wrapProviderError(error);
    }
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        options.onToken(event.delta.text);
      } else if (event.type === "message_start" && event.message.usage?.input_tokens !== undefined) {
        options.onUsage?.({ promptTokens: event.message.usage.input_tokens });
      } else if (event.type === "message_delta" && event.usage?.output_tokens !== undefined) {
        options.onUsage?.({ outputTokens: event.usage.output_tokens });
      }
    }
    return;
  }

  let stream;
  try {
    stream = await client.client.chat.completions.create(
      {
        model: config.model,
        max_completion_tokens: Math.max(256, options.maxOutputTokens),
        messages: systemText
          ? [{ role: "system" as const, content: systemText }, ...chatMessages]
          : chatMessages,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: options.signal },
    );
  } catch (error) {
    throw wrapProviderError(error);
  }
  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) options.onToken(token);
    if (chunk.usage) {
      options.onUsage?.({
        promptTokens: chunk.usage.prompt_tokens ?? undefined,
        outputTokens: chunk.usage.completion_tokens ?? undefined,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Structured workspace planning: executeWorkspaceAI                    */
/* ------------------------------------------------------------------ */

export type WorkspaceAIIntent = "create_task" | "create_project" | "decompose_goal" | "plan_schedule";

export interface WorkspaceAITask {
  title: string;
  description: string;
  priority: "Urgent" | "High" | "Medium" | "Low" | "None";
  estimatedMinutes: number;
  subtasks: string[];
}

export interface WorkspaceAIPlan {
  intent: WorkspaceAIIntent;
  project: { name: string; description: string; color: string } | null;
  tasks: WorkspaceAITask[];
  summary: string;
}

export const WORKSPACE_AI_INTENTS: WorkspaceAIIntent[] = ["create_task", "create_project", "decompose_goal", "plan_schedule"];

const FOLIO_COLORS = ["violet", "green", "peach", "blue", "yellow", "pink"];
const TASK_PRIORITIES = ["Urgent", "High", "Medium", "Low", "None"];

const WORKSPACE_AI_SYSTEM_PROMPT = `You are the Folio workspace planning engine. The user gives you one natural-language request about their personal workspace, and you reply with ONLY a JSON object — no prose, no markdown fences, no explanation — matching exactly this shape:

{"intent":"create_task|create_project|decompose_goal|plan_schedule","project":{"name":"...","description":"...","color":"violet|green|peach|blue|yellow|pink"},"tasks":[{"title":"...","description":"...","priority":"Urgent|High|Medium|Low|None","estimatedMinutes":30,"subtasks":["..."]}],"summary":"one or two sentences describing the plan"}

Rules:
- intent: "create_task" for one concrete task, "create_project" when the user starts a new initiative, "decompose_goal" when a broad goal must be broken into steps, "plan_schedule" when the user asks to organize or schedule existing/next work.
- Include "project" only for "create_project" (and for "decompose_goal" when a container project clearly helps). color MUST be one of violet, green, peach, blue, yellow, pink.
- "tasks" holds 1 task for "create_task", and up to 8 concrete, ordered, actionable steps otherwise. Titles are short imperative phrases. "estimatedMinutes" is a realistic integer between 5 and 480. "subtasks" holds up to 4 short strings and may be empty.
- "priority" MUST be one of Urgent, High, Medium, Low, None.
- "summary" is one or two plain sentences, no markdown.
- Output raw JSON only. Never wrap it in \`\`\` fences. Never add keys beyond the documented shape.`;

/**
 * Robustly cleans model output before JSON parsing: strips ```json / ``` code
 * fences, JS-style comments, trailing commas, and stray whitespace.
 */
export function sanitizeJsonPayload(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  text = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
  // Extract the outermost JSON object when the model adds prose around it.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(/\/\/[^\n]*/g, "");
  text = text.replace(/,\s*([}\]])/g, "$1");
  return text.trim();
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function coercePlan(parsed: unknown): WorkspaceAIPlan {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AIUsageError("The AI response could not be parsed as a workspace plan.", 502, "invalid_model_json");
  }
  const record = parsed as Record<string, unknown>;
  const intent = WORKSPACE_AI_INTENTS.includes(record.intent as WorkspaceAIIntent)
    ? (record.intent as WorkspaceAIIntent)
    : record.project ? "create_project" : "create_task";

  let project: WorkspaceAIPlan["project"] = null;
  if (record.project && typeof record.project === "object" && !Array.isArray(record.project)) {
    const rawProject = record.project as Record<string, unknown>;
    const name = String(rawProject.name ?? "").trim().slice(0, 120);
    if (name) {
      project = {
        name,
        description: String(rawProject.description ?? "").trim().slice(0, 600),
        color: FOLIO_COLORS.includes(String(rawProject.color)) ? String(rawProject.color) : "violet",
      };
    }
  }

  const rawTasks = Array.isArray(record.tasks) ? record.tasks : [];
  const tasks: WorkspaceAITask[] = [];
  for (const entry of rawTasks.slice(0, 12)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rawTask = entry as Record<string, unknown>;
    const title = String(rawTask.title ?? "").trim().slice(0, 200);
    if (!title) continue;
    const priority = TASK_PRIORITIES.includes(String(rawTask.priority)) ? String(rawTask.priority) as WorkspaceAITask["priority"] : "Medium";
    const subtasks = Array.isArray(rawTask.subtasks)
      ? rawTask.subtasks.map(item => String(item ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 6)
      : [];
    tasks.push({
      title,
      description: String(rawTask.description ?? "").trim().slice(0, 600),
      priority,
      estimatedMinutes: clampInt(rawTask.estimatedMinutes, 5, 480, 30),
      subtasks,
    });
  }
  if (!tasks.length) {
    throw new AIUsageError("The AI response did not include any usable tasks.", 502, "invalid_model_json");
  }

  const summary = String(record.summary ?? "").trim().slice(0, 600) || `Prepared ${tasks.length} task${tasks.length === 1 ? "" : "s"} for your workspace.`;
  return { intent, project, tasks, summary };
}

/**
 * One-shot structured planner: asks the configured BYOK provider to turn a
 * natural-language prompt into a validated workspace plan JSON document.
 */
export async function executeWorkspaceAI(prompt: string, config: BYOKConfig): Promise<WorkspaceAIPlan> {
  const client = createBYOKClient(config);
  const maxOutputTokens = FOLIO_AI_CONFIG.maxOutputTokens;
  let raw = "";

  if (client.kind === "anthropic") {
    let response;
    try {
      response = await client.client.messages.create(
        {
          model: config.model,
          max_tokens: maxOutputTokens,
          system: WORKSPACE_AI_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        },
        { maxRetries: 0 },
      );
    } catch (error) {
      throw wrapProviderError(error);
    }
    raw = response.content
      .map(block => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
  } else {
    let response;
    try {
      response = await client.client.chat.completions.create(
        {
          model: config.model,
          max_completion_tokens: maxOutputTokens,
          messages: [
            { role: "system" as const, content: WORKSPACE_AI_SYSTEM_PROMPT },
            { role: "user" as const, content: prompt },
          ],
        },
        config.provider === "openrouter"
          ? { headers: { "X-Title": "Folio Workspace Studio" } }
          : {},
      );
    } catch (error) {
      throw wrapProviderError(error);
    }
    raw = (response.choices?.[0]?.message?.content ?? "").trim();
  }

  if (!raw) {
    throw new AIUsageError("The AI returned an empty response. Try rephrasing the request.", 502, "empty_model_response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonPayload(raw));
  } catch {
    throw new AIUsageError("The AI response was not valid JSON. Try again or pick another model.", 502, "invalid_model_json");
  }
  return coercePlan(parsed);
}
