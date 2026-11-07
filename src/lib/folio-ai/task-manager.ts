"use client";

import { estimateTokenCount, FOLIO_AI_CONFIG, maxReservedTokensForModel } from "@/lib/folio-ai/config";
import { extractActionPlan } from "@/lib/folio-ai/actions";
import { parseNaturalLanguageIntent, type WorkspaceSummaryContext } from "@/lib/folio-ai/intent-pipeline";
import type { LocalAIProvider, LocalChatMessage } from "@/lib/folio-ai/provider";
import type {
  AIActionResult,
  AIReservation,
  AITaskRecord,
  AITaskStatus,
  AIUsage,
} from "@/lib/folio-ai/types";
import type { AiConversation } from "@/lib/use-ai-conversations";

const TAB_RUNNING_TASKS_KEY = "folio.ai.tabRunningTaskIds";

export interface LiveTaskSnapshot {
  task: AITaskRecord;
  conversation: AiConversation;
  userMessageId: string;
  assistantMessageId: string;
  startedAtMs: number;
  lastActivityAtMs: number;
  syncPending: boolean;
  usage: AIUsage | null;
}

type Listener = () => void;

interface ActiveRunner {
  snapshot: LiveTaskSnapshot;
  controller: AbortController;
  provider: LocalAIProvider;
  heartbeatTimer: number | null;
  stallTimer: number | null;
}

const activeByTaskId = new Map<string, ActiveRunner>();
const snapshotsByTaskId = new Map<string, LiveTaskSnapshot>();
const latestByConversationId = new Map<string, LiveTaskSnapshot>();
const listeners = new Set<Listener>();

function emitChange() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // listener errors should not break runtime loop
    }
  }
}

export function subscribeToTaskRuntime(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readTabRunningIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(TAB_RUNNING_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeTabRunningIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    if (ids.length) {
      sessionStorage.setItem(TAB_RUNNING_TASKS_KEY, JSON.stringify([...new Set(ids)]));
    } else {
      sessionStorage.removeItem(TAB_RUNNING_TASKS_KEY);
    }
  } catch {
    // sessionStorage is optional
  }
}

function registerTabRunningTask(taskId: string) {
  const current = readTabRunningIds();
  if (!current.includes(taskId)) {
    writeTabRunningIds([...current, taskId]);
  }
}

function unregisterTabRunningTask(taskId: string) {
  const current = readTabRunningIds();
  writeTabRunningIds(current.filter(id => id !== taskId));
}

/**
 * Returns any task IDs that were executing in this tab prior to a full page
 * reload (`F5`) whose in-memory WebWorker no longer exists in `activeByTaskId`.
 */
export function consumeInterruptedTabTaskIds(): string[] {
  const recorded = readTabRunningIds();
  const interrupted = recorded.filter(id => !activeByTaskId.has(id));
  if (interrupted.length) {
    writeTabRunningIds(recorded.filter(id => activeByTaskId.has(id)));
  }
  return interrupted;
}

export function getLiveTaskForConversation(conversationId: string | null): LiveTaskSnapshot | null {
  if (!conversationId) return null;
  let newestActive: LiveTaskSnapshot | null = null;
  for (const runner of activeByTaskId.values()) {
    if (runner.snapshot.task.conversationId === conversationId) {
      newestActive = runner.snapshot;
    }
  }
  return newestActive ?? latestByConversationId.get(conversationId) ?? null;
}

export function getTaskSnapshotsForConversation(conversationId: string | null): LiveTaskSnapshot[] {
  if (!conversationId) {
    return Array.from(snapshotsByTaskId.values());
  }
  return Array.from(snapshotsByTaskId.values()).filter(
    s => s.task.conversationId === conversationId,
  );
}

export function getAnyActiveTaskSnapshot(): LiveTaskSnapshot | null {
  const first = activeByTaskId.values().next();
  return first.done ? null : first.value.snapshot;
}

export function isTaskRunningInThisTab(taskId: string): boolean {
  return activeByTaskId.has(taskId);
}

function broadcastUsageUpdate() {
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel("folio-ai-account-usage");
      channel.postMessage({ updated: true });
      channel.close();
    } catch {
      // BroadcastChannel is optional
    }
  }
}

async function createTaskWithRetry(payload: {
  generationId: string;
  conversationId: string | null;
  prompt: string;
  modelId: string;
  userMessageId: string;
  assistantMessageId: string;
  resumeTaskId?: string | null;
  keepPartial?: boolean;
}): Promise<{
  task: AITaskRecord;
  conversation: AiConversation;
  reservation: AIReservation;
  usage: AIUsage;
  reused: boolean;
}> {
  let lastError: Error | null = null;
  // Retry once on transient network interruption; generationId makes POST /api/ai/tasks idempotent.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("/api/ai/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(body.error || "Couldn’t start the AI task.") as Error & {
          status?: number;
          code?: string;
          usage?: AIUsage;
        };
        err.status = response.status;
        err.code = body.code;
        err.usage = body.usage;
        throw err;
      }
      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Network error while starting task.");
      const status = (error as { status?: number })?.status;
      // Do not retry deterministic client errors (400, 401, 403, 409, 413, 429).
      if (status && status >= 400 && status < 500) {
        throw lastError;
      }
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
  }
  throw lastError ?? new Error("Couldn’t start the AI task.");
}

async function patchTaskOnServer(
  taskId: string,
  patch: {
    status?: AITaskStatus;
    stage?: string;
    partialContent?: string;
    tokenCount?: number;
    usageTokens?: number;
    plan?: { actions: { id: string; params: Record<string, unknown> }[] } | null;
    results?: AIActionResult[] | null;
    errorMessage?: string | null;
  },
  keepalive = false,
): Promise<{ task: AITaskRecord; usage: AIUsage; cancelled: boolean }> {
  const response = await fetch(`/api/ai/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Couldn’t sync AI task status.");
  }
  return body;
}

export interface StartAITaskOptions {
  prompt: string;
  conversationId: string | null;
  modelId: string;
  provider: LocalAIProvider;
  contextMessages: LocalChatMessage[];
  workspaceContext?: WorkspaceSummaryContext;
  resumeTask?: AITaskRecord | null;
  keepPartial?: boolean;
  onConversationCreated?: (conversation: AiConversation) => void;
  onUsageUpdated?: (usage: AIUsage) => void;
}

export async function startBackgroundAITask(options: StartAITaskOptions): Promise<LiveTaskSnapshot> {
  const generationId = crypto.randomUUID();
  const userMessageId = options.resumeTask?.userMessageId || crypto.randomUUID();
  const assistantMessageId = options.resumeTask?.assistantMessageId || crypto.randomUUID();
  const initialPartial =
    options.resumeTask && options.keepPartial ? options.resumeTask.partialContent : "";
  const initialTokens =
    options.resumeTask && options.keepPartial ? options.resumeTask.tokenCount : 0;

  // 1. Create or reuse the task & reservation on the server (idempotent by generationId)
  const created = await createTaskWithRetry({
    generationId,
    conversationId: options.conversationId,
    prompt: options.prompt,
    modelId: options.modelId,
    userMessageId,
    assistantMessageId,
    resumeTaskId: options.resumeTask?.id ?? null,
    keepPartial: options.keepPartial,
  });

  options.onConversationCreated?.(created.conversation);
  options.onUsageUpdated?.(created.usage);
  broadcastUsageUpdate();

  // If a duplicate request already had an active runner in this tab, return it
  const existingRunner = activeByTaskId.get(created.task.id);
  if (existingRunner) {
    return existingRunner.snapshot;
  }

  const nowMs = Date.now();
  const snapshot: LiveTaskSnapshot = {
    task: {
      ...created.task,
      userMessageId: created.task.userMessageId ?? userMessageId,
      assistantMessageId: created.task.assistantMessageId ?? assistantMessageId,
      partialContent: initialPartial || created.task.partialContent,
      tokenCount: initialTokens || created.task.tokenCount,
    },
    conversation: created.conversation,
    userMessageId: created.task.userMessageId ?? userMessageId,
    assistantMessageId: created.task.assistantMessageId ?? assistantMessageId,
    startedAtMs: nowMs,
    lastActivityAtMs: nowMs,
    syncPending: false,
    usage: created.usage,
  };

  const controller = new AbortController();
  const runner: ActiveRunner = {
    snapshot,
    controller,
    provider: options.provider,
    heartbeatTimer: null,
    stallTimer: null,
  };

  activeByTaskId.set(snapshot.task.id, runner);
  snapshotsByTaskId.set(snapshot.task.id, snapshot);
  latestByConversationId.set(snapshot.task.conversationId, snapshot);
  registerTabRunningTask(snapshot.task.id);
  emitChange();

  // 2. Run generation asynchronously in the module-level background runner
  void runTaskLifecycle(runner, options, initialPartial, initialTokens);

  return snapshot;
}

async function runTaskLifecycle(
  runner: ActiveRunner,
  options: StartAITaskOptions,
  initialPartial: string,
  initialTokens: number,
) {
  const { snapshot, controller, provider } = runner;
  const taskId = snapshot.task.id;
  const taskTokenLimit = maxReservedTokensForModel(snapshot.task.modelId);
  let accumulatedText = initialPartial;
  let tokenCount = initialTokens;
  let usageTokenCount = 0;
  let completedLocally = false;
  let providerStage: string | null = null;

  const resetStallWatchdog = () => {
    snapshot.lastActivityAtMs = Date.now();
    if (runner.stallTimer) window.clearTimeout(runner.stallTimer);
    runner.stallTimer = window.setTimeout(() => {
      controller.abort("inactivity-stall");
    }, FOLIO_AI_CONFIG.inactivityStallMilliseconds);
  };

  const computeRunningStage = () => {
    if (providerStage) return providerStage;
    const elapsedMs = Date.now() - snapshot.startedAtMs;
    if (tokenCount === 0) {
      if (elapsedMs >= FOLIO_AI_CONFIG.extendedRunningThresholdMilliseconds) {
        return "Reasoning on device · deep analysis in progress (no time cutoff)";
      }
      if (elapsedMs >= FOLIO_AI_CONFIG.longRunningThresholdMilliseconds) {
        return "Reasoning on device · preparing detailed response…";
      }
      return "Reasoning on device…";
    }
    if (elapsedMs >= FOLIO_AI_CONFIG.extendedRunningThresholdMilliseconds) {
      return "Generating response · saving checkpoints";
    }
    if (elapsedMs >= FOLIO_AI_CONFIG.longRunningThresholdMilliseconds) {
      return "Generating response";
    }
    return "Streaming response";
  };

  const sendHeartbeat = async () => {
    if (controller.signal.aborted || completedLocally) return;
    const stage = computeRunningStage();
    snapshot.task = {
      ...snapshot.task,
      status: "running",
      stage,
      partialContent: accumulatedText,
      tokenCount,
      usageTokenCount,
      heartbeatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    latestByConversationId.set(snapshot.task.conversationId, snapshot);
    emitChange();

    try {
      const synced = await patchTaskOnServer(taskId, {
        status: "running",
        stage,
        partialContent: accumulatedText,
        tokenCount,
        usageTokens: usageTokenCount,
      });
      if (synced.cancelled) {
        controller.abort("user-stop");
        return;
      }
      snapshot.usage = synced.usage;
      options.onUsageUpdated?.(synced.usage);
    } catch {
      // Transient network interruption during a heartbeat must NEVER abort local AI work.
      // The next heartbeat or completion step will sync the accumulated output.
    }
  };

  const onPageHide = () => {
    if (!completedLocally && !controller.signal.aborted && accumulatedText) {
      // Save latest partial output via keepalive before page unload
      void patchTaskOnServer(
        taskId,
        {
          status: "running",
          stage: snapshot.task.stage,
          partialContent: accumulatedText,
          tokenCount,
          usageTokens: usageTokenCount,
        },
        true,
      ).catch(() => {});
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  try {
    // Transition from queued -> running
    snapshot.task = {
      ...snapshot.task,
      status: "running",
      stage: initialPartial ? "Resuming generation on device…" : "Reasoning on device…",
      updatedAt: new Date().toISOString(),
    };
    latestByConversationId.set(snapshot.task.conversationId, snapshot);
    emitChange();

    resetStallWatchdog();
    runner.heartbeatTimer = window.setInterval(() => {
      void sendHeartbeat();
    }, FOLIO_AI_CONFIG.heartbeatIntervalMilliseconds);

    let paintFrame = 0;
    const flushToSnapshot = () => {
      if (paintFrame) cancelAnimationFrame(paintFrame);
      paintFrame = 0;
      const stage = computeRunningStage();
      snapshot.task = {
        ...snapshot.task,
        status: "running",
        stage,
        partialContent: accumulatedText,
        tokenCount,
        usageTokenCount,
        updatedAt: new Date().toISOString(),
      };
      latestByConversationId.set(snapshot.task.conversationId, snapshot);
      emitChange();
    };

    const messagesToSend: LocalChatMessage[] = initialPartial
      ? [
          ...options.contextMessages,
          { role: "assistant", content: initialPartial },
          {
            role: "user",
            content:
              "Continue your previous response seamlessly from where it left off without repeating the part already written.",
          },
        ]
      : options.contextMessages;
    const estimatedPromptTokens = messagesToSend.reduce(
      (total, message) => total + estimateTokenCount(message.content),
      0,
    );
    usageTokenCount = estimatedPromptTokens;

    const result = await provider.generate(
      messagesToSend,
      controller.signal,
      token => {
        resetStallWatchdog();
        accumulatedText += token;
        tokenCount += 1;
        usageTokenCount = Math.min(
          taskTokenLimit,
          Math.max(usageTokenCount, estimatedPromptTokens + estimateTokenCount(accumulatedText)),
        );
        if (!paintFrame) {
          paintFrame = requestAnimationFrame(flushToSnapshot);
        }
      },
      stage => {
        providerStage = stage;
        snapshot.task = { ...snapshot.task, stage, updatedAt: new Date().toISOString() };
        snapshotsByTaskId.set(taskId, snapshot);
        latestByConversationId.set(snapshot.task.conversationId, snapshot);
        emitChange();
      },
      tokens => {
        usageTokenCount = Math.min(taskTokenLimit, Math.max(usageTokenCount, Math.floor(tokens)));
        resetStallWatchdog();
      },
    );

    flushToSnapshot();
    const finalText = (initialPartial ? `${initialPartial}${result.text}` : result.text).trim();
    if (!finalText) {
      throw new Error("The local model finished without a response. This attempt was not counted.");
    }

    completedLocally = true;
    tokenCount = result.outputTokens || estimateTokenCount(result.text);
    usageTokenCount = Math.min(
      taskTokenLimit,
      (result.promptTokens ?? estimatedPromptTokens) + tokenCount,
    );

    let parsedPlan = extractActionPlan(finalText);
    if (!parsedPlan && options.prompt) {
      const intentResult = parseNaturalLanguageIntent(options.prompt, options.workspaceContext);
      if (intentResult?.actions?.length) {
        parsedPlan = intentResult.actions;
      }
    }
    const finalStatus: AITaskStatus = parsedPlan ? "waiting" : "completed";
    const finalStage = parsedPlan
      ? "Action plan ready · waiting for your review"
      : "Completed";

    // Keep status as "running" ("Saving response…") until the completion PATCH
    // commits on the server so rapid subsequent tasks or reloads never race the commit.
    snapshot.task = {
      ...snapshot.task,
      status: "running",
      stage: "Saving response…",
      partialContent: finalText,
      tokenCount,
      usageTokenCount,
      plan: parsedPlan ? { actions: parsedPlan } : null,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    };
    snapshotsByTaskId.set(taskId, snapshot);
    latestByConversationId.set(snapshot.task.conversationId, snapshot);
    emitChange();

    try {
      const synced = await patchTaskOnServer(
        taskId,
        {
          status: finalStatus,
          stage: finalStage,
          partialContent: finalText,
          tokenCount,
          usageTokens: usageTokenCount,
          plan: parsedPlan ? { actions: parsedPlan } : null,
        },
        true,
      );
      snapshot.task = synced.task;
      snapshot.usage = synced.usage;
      snapshot.syncPending = false;
      options.onUsageUpdated?.(synced.usage);
      broadcastUsageUpdate();
    } catch {
      // Preserve completed output locally and mark waiting for sync retry
      snapshot.syncPending = true;
      snapshot.task = {
        ...snapshot.task,
        status: "waiting",
        stage: "Response ready · waiting to sync with server",
        partialContent: finalText,
        tokenCount,
        plan: parsedPlan ? { actions: parsedPlan } : null,
      };
    }

    snapshotsByTaskId.set(taskId, snapshot);
    latestByConversationId.set(snapshot.task.conversationId, snapshot);
    emitChange();
  } catch (error) {
    const aborted = controller.signal.aborted;
    const reason = controller.signal.reason;
    const isStall = reason === "inactivity-stall";
    const isUserCancel = aborted && !isStall;
    const isContextLimit =
      error instanceof Error &&
      /(?:context|prompt).{0,40}(?:length|window|limit|size|exceed|too (?:long|large))|(?:maximum|max).{0,30}(?:context|sequence|token|length)|too many tokens/i.test(error.message);

    const nextStatus: AITaskStatus = isUserCancel ? "cancelled" : "failed";
    const errorMessage = isUserCancel
      ? null
      : isStall
        ? "The AI worker stopped producing output for 5 minutes. Partial output was saved and estimated local token usage was counted."
        : isContextLimit
          ? "This request is too large for the local model to answer in one go. Start a new chat or split it into smaller prompts."
        : error instanceof Error
          ? error.message
          : "Generation could not be completed.";
    const nextStage = isUserCancel
      ? "Cancelled by user · usage updated"
      : isContextLimit
        ? "Request too long · split into smaller prompts"
      : accumulatedText.trim()
        ? "Response interrupted · partial output preserved"
        : "Response interrupted";

    try {
      const synced = await patchTaskOnServer(
        taskId,
        {
          status: nextStatus,
          stage: nextStage,
          partialContent: accumulatedText,
          tokenCount,
          usageTokens: Math.max(
            usageTokenCount,
            Math.min(
              taskTokenLimit,
              estimateTokenCount(accumulatedText),
            ),
          ),
          errorMessage,
        },
        true,
      );
      snapshot.task = synced.task;
      snapshot.usage = synced.usage;
      options.onUsageUpdated?.(synced.usage);
      broadcastUsageUpdate();
    } catch {
      snapshot.task = {
        ...snapshot.task,
        status: nextStatus,
        stage: nextStage,
        partialContent: accumulatedText,
        tokenCount,
        usageTokenCount,
        errorMessage,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    snapshotsByTaskId.set(taskId, snapshot);
    latestByConversationId.set(snapshot.task.conversationId, snapshot);
    emitChange();
  } finally {
    if (runner.heartbeatTimer) window.clearInterval(runner.heartbeatTimer);
    if (runner.stallTimer) window.clearTimeout(runner.stallTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
    activeByTaskId.delete(taskId);
    unregisterTabRunningTask(taskId);
    emitChange();
  }
}

export async function cancelActiveAITask(taskId?: string): Promise<void> {
  const runner = taskId
    ? activeByTaskId.get(taskId)
    : activeByTaskId.values().next().value;

  if (runner) {
    runner.controller.abort("user-stop");
    try {
      await runner.provider.interrupt();
    } catch {
      // interrupt is best-effort; runTaskLifecycle handles finalization
    }
    return;
  }

  // If the task is running in another tab or waiting in DB, cancel it via API
  if (taskId) {
    await patchTaskOnServer(taskId, {
      status: "cancelled",
      stage: "Cancelled by user · usage updated",
    });
    const existing = Array.from(latestByConversationId.values()).find(s => s.task.id === taskId);
    if (existing) {
      existing.task = {
        ...existing.task,
        status: "cancelled",
        stage: "Cancelled by user · usage updated",
        completedAt: new Date().toISOString(),
      };
      latestByConversationId.set(existing.task.conversationId, existing);
      emitChange();
    }
  }
}

export async function retryPendingTaskSync(taskId: string): Promise<LiveTaskSnapshot | null> {
  const snapshot = Array.from(latestByConversationId.values()).find(s => s.task.id === taskId);
  if (!snapshot) return null;
  const parsedPlan = extractActionPlan(snapshot.task.partialContent);
  const targetStatus: AITaskStatus = parsedPlan ? "waiting" : "completed";
  const targetStage = parsedPlan ? "Action plan ready · waiting for your review" : "Completed";

  const synced = await patchTaskOnServer(taskId, {
    status: targetStatus,
    stage: targetStage,
    partialContent: snapshot.task.partialContent,
    tokenCount: snapshot.task.tokenCount,
    usageTokens: snapshot.task.usageTokenCount,
    plan: parsedPlan ? { actions: parsedPlan } : null,
  });

  snapshot.task = synced.task;
  snapshot.usage = synced.usage;
  snapshot.syncPending = false;
  latestByConversationId.set(snapshot.task.conversationId, snapshot);
  broadcastUsageUpdate();
  emitChange();
  return snapshot;
}
