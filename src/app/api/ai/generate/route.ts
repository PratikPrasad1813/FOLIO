import { estimateTokenCount, FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { requireBYOKConfig, streamBYOKChat, type BYOKConfig } from "@/lib/folio-ai/byok-service";
import { claimProviderRequest, getAITaskById, updateAITaskProgress } from "@/lib/folio-ai/tasks-service";
import { AIUsageError } from "@/lib/folio-ai/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INPUT_TOKENS = FOLIO_AI_CONFIG.maxReservedTokensPerGeneration - FOLIO_AI_CONFIG.maxOutputTokens;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * GET: reports whether the request carries usable BYOK credentials.
 * No server-side provider key exists; the user's own key is the only key.
 */
export async function GET(request: Request) {
  try {
    await requireAIUser(request);
    let configured = false;
    let provider = "";
    let model = "";
    try {
      const config = requireBYOKConfig(request);
      configured = true;
      provider = config.provider;
      model = config.model;
    } catch {
      configured = false;
    }
    return aiJson({ configured, provider, model });
  } catch (error) {
    return aiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAIUser(request);
    const body = await parseSmallJson(request, 32_000);
    if (typeof body.taskId !== "string" || !TASK_ID.test(body.taskId)) {
      throw new AIUsageError("An active Folio AI task is required.", 400, "task_required");
    }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) {
      throw new AIUsageError("The conversation context is invalid.", 400, "invalid_messages");
    }

    const messages: ChatMessage[] = [];
    let inputCharacters = 0;
    for (const candidate of body.messages) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new AIUsageError("The conversation context is invalid.", 400, "invalid_messages");
      }
      const message = candidate as Record<string, unknown>;
      if (
        (message.role !== "system" && message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        message.content.length === 0 ||
        message.content.length > 12_288
      ) {
        throw new AIUsageError("The conversation context is invalid.", 400, "invalid_messages");
      }
      inputCharacters += message.content.length;
      messages.push({ role: message.role, content: message.content });
    }
    const inputTokens = estimateTokenCount(messages.map(message => message.content).join("\n"));
    if (inputTokens > MAX_INPUT_TOKENS || inputCharacters > MAX_INPUT_TOKENS * FOLIO_AI_CONFIG.approximateCharactersPerToken) {
      throw new AIUsageError("This conversation is too long to fit within the Folio AI token allowance. Start a new chat or shorten the prompt.", 413, "context_too_large");
    }
    if (!messages.some(message => message.role === "user")) {
      throw new AIUsageError("A user message is required to generate a response.", 400, "user_message_required");
    }

    // BYOK: credentials come from the user, never from the server environment.
    let config: BYOKConfig;
    try {
      config = requireBYOKConfig(request);
    } catch (error) {
      if (error instanceof AIUsageError) throw error;
      throw new AIUsageError("Please provide an API key in AI Settings.", 400, "api_key_required");
    }

    const task = await getAITaskById(user.id, body.taskId);
    // "queued" is the fresh state right after POST /api/ai/tasks: the first
    // generation request always arrives before any heartbeat could mark the
    // row "running". claimProviderRequest activates it atomically below.
    if (!task || (task.status !== "running" && task.status !== "queued")) {
      throw new AIUsageError("This Folio AI task is no longer active. Start a new message and try again.", 409, "task_not_active");
    }
    if (!await claimProviderRequest(user.id, task.id)) {
      throw new AIUsageError("This task has already started an AI request. Start a new message to retry.", 409, "request_already_started");
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortUpstream, { once: true });

    let observedPromptTokens: number | undefined;
    let observedOutputTokens = 0;
    let generatedText = "";
    let usageRecorded = false;
    const estimatedUsage = () => Math.min(
      FOLIO_AI_CONFIG.maxReservedTokensPerGeneration,
      Math.max(observedPromptTokens === undefined ? 0 : observedPromptTokens + observedOutputTokens, inputTokens + estimateTokenCount(generatedText)),
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        const send = (payload: Record<string, unknown>) => {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          await streamBYOKChat(config, {
            messages,
            signal: controller.signal,
            maxOutputTokens: FOLIO_AI_CONFIG.maxOutputTokens,
            onToken: token => {
              generatedText += token;
              send({ type: "token", text: token });
            },
            onUsage: usage => {
              if (typeof usage.promptTokens === "number") observedPromptTokens = usage.promptTokens;
              if (typeof usage.outputTokens === "number") observedOutputTokens = usage.outputTokens;
              send({ type: "usage", promptTokens: usage.promptTokens, outputTokens: usage.outputTokens });
            },
          });
          await updateAITaskProgress(user.id, task.id, { usageTokens: estimatedUsage() });
          usageRecorded = true;
          streamController.close();
        } catch (error) {
          controller.abort(error);
          const message = error instanceof Error ? error.message.slice(0, 400) : "Your AI provider stream ended unexpectedly.";
          try {
            send({ type: "error", message });
          } catch {
            // stream already closed
          }
          console.error("Folio AI BYOK stream failed:", error);
          streamController.error(error instanceof Error ? error : new Error("Your AI provider stream ended unexpectedly."));
        } finally {
          request.signal.removeEventListener("abort", abortUpstream);
          if (!usageRecorded) {
            await updateAITaskProgress(user.id, task.id, { usageTokens: estimatedUsage() }).catch(error => {
              console.error("Folio AI usage could not be recorded:", error);
            });
          }
        }
      },
      async cancel(reason) {
        controller.abort(reason);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return aiError(error);
  }
}
