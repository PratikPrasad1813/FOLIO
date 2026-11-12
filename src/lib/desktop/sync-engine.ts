"use client";

/**
 * Folio desktop background sync engine — the "silent worker" half of the
 * local-first architecture (Outbox Mutation Queue + LWW delta sync).
 *
 * THE CONTRACT (root cause #1/#3 of the offline crashes):
 *
 *   - The engine NEVER runs on the UI critical path. The workspace renders
 *     from local SQLite; this worker only converges the cloud copy.
 *   - Every network operation is wrapped in try…catch. Connectivity
 *     failures (`TypeError: Failed to fetch`, DNS errors, timeouts) are
 *     caught SILENTLY: no unhandled promise rejections, no error modals,
 *     no console spam — the status just parks on "offline" and the queue
 *     stays durable in SQLite until the network returns.
 *   - Triggers: app launch (immediately), a 60-second interval, and the
 *     OS `online` event (Wi-Fi coming back). The `offline` event flips
 *     the status to "offline" (gray dot) without touching any data.
 *   - A 401 does NOT sign the user out and never wipes local data: the
 *     engine reports `auth-expired`, the top bar shows a subtle prompt,
 *     and every offline capability keeps working. Only an explicit
 *     "Sign out" (auth-store) ever clears the session.
 *
 * Cycle (single-flight, never overlapping):
 *   1. navigator.onLine check — offline parks the engine in `offline`.
 *   2. PUSH: drain the sync_queue outbox in batches of 200 to
 *      `${API_BASE}/api/sync/push` with the Bearer token from local_auth.
 *      Acknowledged rows (applied / skipped / rejected — all terminal)
 *      are deleted from the queue.
 *   3. PROFILE: when a settings change was made offline, PATCH the
 *      profile (best effort, retried next cycle while it stays dirty).
 *   4. PULL: GET `${API_BASE}/api/sync/pull?since=last_pulled_at`, apply
 *      every delta to local SQLite with Last-Write-Wins (remote >= local
 *      wins, tombstones remove rows), persist the fresh profile +
 *      activity snapshot, then advance last_pulled_at to the authoritative
 *      server_time.
 *   5. Notify the UI: status events drive the SyncIndicator; a
 *      `folio:workspace-sync` event reloads the local-first workspace —
 *      but only when something actually changed.
 */

import { useSyncExternalStore } from "react";
import type { User } from "@/lib/types";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { desktopApiUrl } from "@/lib/desktop/api-base";
import {
  getDesktopSession,
  isNetworkError,
  DESKTOP_SESSION_EVENT,
} from "@/lib/desktop/auth-store";
import {
  applyPulledRows,
  clearLocalMetadata,
  countPendingMutations,
  deleteMutations,
  getCachedActivities,
  getCachedProfile,
  getLocalMetadata,
  initLocalDb,
  META_KEYS,
  setCachedActivities,
  setCachedProfile,
  setLocalMetadata,
  takePendingMutations,
  wipeLocalDatabase,
} from "@/lib/desktop/local-db";
import {
  SYNC_ENTITY_TYPES,
  type SyncPullResponse,
  type SyncPushResponse,
} from "@/lib/sync-protocol";

export type SyncState = "idle" | "offline" | "syncing" | "synced" | "error" | "auth-expired";

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export const SYNC_STATUS_EVENT = "folio:sync-status";
export const SYNC_INTERVAL_MS = 60_000;
const PUSH_BATCH = 200;
const PUSH_TIMEOUT_MS = 20_000;
const PULL_TIMEOUT_MS = 30_000;

const IDLE_STATUS: SyncStatus = { state: "idle", pendingCount: 0, lastSyncedAt: null, lastError: null };

class DesktopSyncEngine {
  private status: SyncStatus = { ...IDLE_STATUS };
  private listeners = new Set<(status: SyncStatus) => void>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private sessionHandler: (() => void) | null = null;
  private running = false;
  private started = false;

  /**
   * Stable-reference snapshot (required by useSyncExternalStore): the same
   * object is returned until a status change replaces it.
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.getStatus());
      } catch {
        // A broken UI listener must never take the engine down.
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<SyncStatus>(SYNC_STATUS_EVENT, { detail: this.getStatus() }));
    }
  }

  /** Idempotent engine bootstrap. Only meaningful in the desktop runtime. */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    this.onlineHandler = () => {
      // Wi-Fi is back: refresh immediately (yellow pulse → green dot).
      this.setStatus({ state: "syncing", lastError: null });
      void this.runCycle();
    };
    this.offlineHandler = () => {
      // Airplane mode: park silently. Nothing is lost — the outbox is
      // durable in SQLite and every read stays local.
      this.setStatus({ state: "offline", lastError: null });
    };
    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") void this.runCycle();
    };
    // Sign-out (or an account switch performed by auth-store) stops the
    // engine so no sessionless cycle ever runs; a later sign-in starts a
    // fresh engine through the session gate.
    this.sessionHandler = () => {
      this.stop();
    };

    window.addEventListener("online", this.onlineHandler);
    window.addEventListener("offline", this.offlineHandler);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener(DESKTOP_SESSION_EVENT, this.sessionHandler);
    this.intervalHandle = setInterval(() => {
      void this.runCycle();
    }, SYNC_INTERVAL_MS);

    void this.runCycle();
  }

  stop(): void {
    if (this.intervalHandle !== null) clearInterval(this.intervalHandle);
    if (this.onlineHandler) window.removeEventListener("online", this.onlineHandler);
    if (this.offlineHandler) window.removeEventListener("offline", this.offlineHandler);
    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
    if (this.sessionHandler) window.removeEventListener(DESKTOP_SESSION_EVENT, this.sessionHandler);
    this.intervalHandle = null;
    this.onlineHandler = null;
    this.offlineHandler = null;
    this.visibilityHandler = null;
    this.sessionHandler = null;
    this.started = false;
    this.running = false;
    this.setStatus({ ...IDLE_STATUS });
  }

  /** Manual trigger (SyncIndicator click). */
  forceSync(): void {
    void this.runCycle();
  }

  private async runCycle(): Promise<void> {
    if (this.running || !this.started) return;
    this.running = true;
    try {
      await initLocalDb();

      // Offline check first: no network attempt is ever made while the OS
      // reports no connectivity (silent by construction).
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        this.setStatus({ state: "offline", lastError: null });
        return;
      }

      const session = await getDesktopSession();
      if (!session) {
        // Not signed in on this device (fresh install or after sign-out).
        this.setStatus({ ...IDLE_STATUS });
        return;
      }

      this.setStatus({ state: "syncing", lastError: null });

      const pushSummary = await this.pushOutbox(session);
      await this.pushProfile(session);
      const pullSummary = await this.pullDeltas(session);

      this.setStatus({
        state: "synced",
        pendingCount: await countPendingMutations(),
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });

      // Only bounce the workspace through a reload when something actually
      // changed, or when local edits were acknowledged by the server.
      if (pullSummary.changed > 0 || pushSummary.pushed > 0) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("folio:workspace-sync"));
        }
      }
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        // Keep every local capability; the UI shows a subtle re-auth prompt.
        this.setStatus({
          state: "auth-expired",
          pendingCount: await countPendingMutations().catch(() => this.status.pendingCount),
          lastError: "Your sign-in expired. Sign in again to resume syncing.",
        });
        return;
      }
      if (isNetworkError(error)) {
        // Silent by design: expected in any offline-capable app.
        this.setStatus({ state: "offline", lastError: null });
        return;
      }
      this.setStatus({
        state: "error",
        pendingCount: await countPendingMutations().catch(() => this.status.pendingCount),
        lastError: error instanceof Error ? error.message : "Sync could not complete.",
      });
    } finally {
      this.running = false;
    }
  }

  /** fetch with Bearer auth and a hard timeout. */
  private async syncFetch(url: string, init: RequestInit, token: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.method === "POST" ? PUSH_TIMEOUT_MS : PULL_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        credentials: "omit",
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async pushOutbox(session: { token: string }): Promise<{ pushed: number }> {
    let pushed = 0;
    for (;;) {
      const mutations = await takePendingMutations(PUSH_BATCH);
      if (!mutations.length) break;

      const response = await this.syncFetch(desktopApiUrl("/api/sync/push"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations }),
      }, session.token);

      if (response.status === 401) throw new AuthExpiredError();
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Your changes could not be uploaded.");
      }

      const body = (await response.json()) as SyncPushResponse;
      // applied | skipped | rejected are all terminal: the queue row goes.
      const acknowledged = new Set(body.results.map((result) => result.id));
      await deleteMutations(mutations.filter((mutation) => acknowledged.has(mutation.id)).map((mutation) => mutation.id));
      pushed += body.applied;
      this.setStatus({ pendingCount: await countPendingMutations() });

      if (mutations.length < PUSH_BATCH) break;
    }
    return { pushed };
  }

  /**
   * Push a locally-edited profile (Settings saved while offline). The change
   * was already applied to the local snapshot when it was made, so a failure
   * here is silent: the dirty flag stays set and the next cycle retries.
   */
  private async pushProfile(session: { token: string; user: User }): Promise<void> {
    const dirty = await getLocalMetadata(META_KEYS.profileDirty);
    if (dirty !== "1") return;
    const pendingRaw = await getLocalMetadata(META_KEYS.profilePending);
    if (!pendingRaw) {
      await clearLocalMetadata([META_KEYS.profileDirty]);
      return;
    }
    let pending: { name?: string; weeklyGoal?: number; complete?: boolean; guideDismissed?: boolean };
    try {
      pending = JSON.parse(pendingRaw) as { name?: string; weeklyGoal?: number; complete?: boolean; guideDismissed?: boolean };
    } catch {
      await clearLocalMetadata([META_KEYS.profileDirty, META_KEYS.profilePending]);
      return;
    }

    const response = await this.syncFetch(desktopApiUrl("/api/profile"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
    }, session.token);

    if (response.status === 401) throw new AuthExpiredError();
    if (!response.ok) return; // transient: retried on the next cycle

    await clearLocalMetadata([META_KEYS.profileDirty, META_KEYS.profilePending]);
  }

  private async pullDeltas(session: { token: string; user: User }): Promise<{ changed: number }> {
    const since = await getLocalMetadata(META_KEYS.lastPulledAt);
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await this.syncFetch(desktopApiUrl(`/api/sync/pull${query}`), { method: "GET" }, session.token);

    if (response.status === 401) throw new AuthExpiredError();
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || "Your workspace changes could not be fetched.");
    }

    const data = (await response.json()) as SyncPullResponse;
    if (!data.profile || !data.profile.id) {
      throw new Error("The sync response was missing your account.");
    }

    // Account switch: the local mirror (and any unsynced outbox entries of
    // the previous account) must never leak into the new session.
    const cachedUser = await getCachedProfile();
    if (cachedUser && cachedUser.id !== data.profile.id) {
      await wipeLocalDatabase();
    }

    let changed = 0;
    for (const kind of SYNC_ENTITY_TYPES) {
      const rows = data.changes[kind] ?? [];
      if (!rows.length) continue;
      const outcome = await applyPulledRows(kind, rows, data.profile.id);
      changed += outcome.applied + outcome.removed;
    }

    // A pending local profile edit keeps winning over the pulled snapshot
    // until its own push succeeds.
    const dirty = (await getLocalMetadata(META_KEYS.profileDirty)) === "1";
    if (!dirty) {
      // The wire profile is produced by the same publicUser serializer as
      // the workspace endpoint, so the cast only crosses the JSON boundary.
      await setCachedProfile(data.profile as unknown as User);
    }

    // Merge the server activity feed with local entries the server has not
    // seen yet (offline feedback), newest first, capped at 40.
    const localActivities = await getCachedActivities();
    const serverIds = new Set(data.activities.map((entry) => entry.id));
    const merged = [...data.activities, ...localActivities.filter((entry) => !serverIds.has(entry.id))]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, 40);
    await setCachedActivities(merged);

    await setLocalMetadata(META_KEYS.lastPulledAt, data.server_time);
    return { changed };
  }
}

/** Internal control-flow signal: the Bearer token was rejected by the cloud. */
class AuthExpiredError extends Error {
  constructor() {
    super("The saved sign-in token is no longer valid.");
    this.name = "AuthExpiredError";
  }
}

let engineInstance: DesktopSyncEngine | null = null;

/** The process-wide engine singleton; null outside the Tauri desktop shell. */
export function getSyncEngine(): DesktopSyncEngine | null {
  if (typeof window === "undefined") return null;
  if (!isDesktopRuntime()) return null;
  if (!engineInstance) engineInstance = new DesktopSyncEngine();
  return engineInstance;
}

/** Stop and drop the engine (sign-out in the desktop shell). */
export function disposeSyncEngine(): void {
  engineInstance?.stop();
  engineInstance = null;
}

/**
 * React binding for the SyncIndicator (and any other surface).
 *
 * useSyncExternalStore keeps SSR and the hydration render identical (the
 * server snapshot is always the idle placeholder); the real status only
 * participates after mount, so there is no hydration mismatch and no
 * setState-in-effect.
 */
const IDLE_SERVER_STATUS: SyncStatus = { ...IDLE_STATUS };

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusServerSnapshot);
}

function subscribeSyncStatus(onStoreChange: () => void): () => void {
  const engine = getSyncEngine();
  if (!engine) return () => {};
  return engine.subscribe(() => onStoreChange());
}

function getSyncStatusSnapshot(): SyncStatus {
  return getSyncEngine()?.getStatus() ?? IDLE_SERVER_STATUS;
}

function getSyncStatusServerSnapshot(): SyncStatus {
  return IDLE_SERVER_STATUS;
}
