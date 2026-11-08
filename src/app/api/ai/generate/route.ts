import { estimateTokenCount, FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import { aiError, aiJson, parseSmallJson, requireAIUser } from "@/lib/folio-ai/http";
import { claimGeminiRequest, getAITaskById, updateAITaskProgress } from "@/lib/folio-ai/tasks-service";
import { AIUsageError } from "@/lib/folio-ai/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INPUT_TOKENS = FOLIO_AI_CONFIG.maxReservedTokensPerGeneration - FOLIO_AI_CONFIG.maxOutputTokens;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GeminiChunk {
  error?: { code?: number; message?: string; status?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function parseChunk(event: string): GeminiChunk | null {
  const data = event
    .split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  return JSON.parse(data) as GeminiChunk;
}

function upstreamErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message.slice(0, 400);
  }
  return "Google Gemini could not complete the request.";
}

export async function GET(request: Request) {
  try {
    await requireAIUser(request);
    return aiJson({ configured: Boolean(process.env.GEMINI_API_KEY), model: FOLIO_AI_CONFIG.modelName });
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
    const systemText = messages.filter(message => message.role === "system").map(message => message.content).join("\n\n");
    const contents = messages
      .filter(message => message.role !== "system")
      .map(message => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    if (!contents.some(message => message.role === "user")) {
      throw new AIUsageError("A user message is required to generate a response.", 400, "user_message_required");
    }
    if (!process.env.GEMINI_API_KEY) {
      throw new AIUsageError("Folio AI is not configured. Add GEMINI_API_KEY to the server environment.", 503, "provider_not_configured");
    }

    const task = await getAITaskById(user.id, body.taskId);
    if (!task || task.status !== "running") {
      throw new AIUsageError("This Folio AI task is no longer active. Start a new message and try again.", 409, "task_not_active");
    }
    if (!await claimGeminiRequest(user.id, task.id)) {
      throw new AIUsageError("This task has already started a Gemini request. Start a new message to retry.", 409, "request_already_started");
    }

    const controller = new AbortController();
    const abortUpstream = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abortUpstream, { once: true });

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${FOLIO_AI_CONFIG.modelId}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
          contents,
          generationConfig: {
            maxOutputTokens: FOLIO_AI_CONFIG.maxOutputTokens,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: controller.signal,
      },
    );
    if (!upstream.ok || !upstream.body) {
      const message = upstreamErrorMessage(await upstream.json().catch(() => null));
      throw new AIUsageError(message, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, "gemini_request_failed");
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let observedTokens = 0;
    let generatedText = "";
    let usageRecorded = false;
    const recordEvent = (event: string) => {
      const chunk = parseChunk(event);
      if (!chunk) return;
      if (chunk.error) throw new Error(upstreamErrorMessage(chunk));
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.text === "string") generatedText += part.text;
        }
      }
      const usage = chunk.usageMetadata;
      if (usage?.totalTokenCount !== undefined) observedTokens = Math.max(observedTokens, usage.totalTokenCount);
      else if (usage?.promptTokenCount !== undefined) {
        observedTokens = Math.max(observedTokens, usage.promptTokenCount + (usage.candidatesTokenCount ?? 0));
      }
    };
    const estimatedUsage = () => Math.min(
      FOLIO_AI_CONFIG.maxReservedTokensPerGeneration,
      Math.max(observedTokens, inputTokens + estimateTokenCount(generatedText)),
    );

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() ?? "";
            for (const event of events) recordEvent(event);
            if (value) streamController.enqueue(value);
            if (done) {
              if (buffer.trim()) recordEvent(buffer);
              break;
            }
          }
          await updateAITaskProgress(user.id, task.id, { usageTokens: estimatedUsage() });
          usageRecorded = true;
          streamController.close();
        } catch (error) {
          controller.abort(error);
          await reader.cancel().catch(() => {});
          console.error("Folio AI Gemini stream failed:", error);
          streamController.error(error instanceof Error ? error : new Error("Google Gemini stream ended unexpectedly."));
        } finally {
          request.signal.removeEventListener("abort", abortUpstream);
          if (!usageRecorded) {
            await updateAITaskProgress(user.id, task.id, { usageTokens: estimatedUsage() }).catch(error => {
              console.error("Folio AI Gemini usage could not be recorded:", error);
            });
          }
        }
      },
      async cancel(reason) {
        controller.abort(reason);
        await reader.cancel(reason).catch(() => {});
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
