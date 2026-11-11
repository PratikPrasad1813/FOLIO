"use client";

/**
 * Sync status indicator for the Folio desktop shell.
 *
 * Hydration contract (this is the component that previously mismatched):
 * the server render and the hydration render BOTH emit the same static idle
 * placeholder — `useSyncExternalStore` guarantees it via the server snapshot
 * — and only after mount does the real, Tauri-powered status replace it. On
 * the web the indicator stays hidden.
 */

import { useSyncExternalStore } from "react";
import { CloudOff, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { getSyncEngine } from "@/lib/desktop/sync-engine";
import type { SyncState, SyncStatus } from "@/lib/desktop/sync-engine";

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true on every later render. */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATE_META: Record<SyncState, { label: string; icon: typeof CloudOff; title: string }> = {
  idle: { label: "Sync idle", icon: CloudOff, title: "Folio sync is starting…" },
  offline: { label: "Offline", icon: CloudOff, title: "You're offline. Changes are saved locally and will sync automatically." },
  syncing: { label: "Syncing", icon: Loader2, title: "Syncing your workspace with the cloud…" },
  synced: { label: "Synced", icon: ShieldCheck, title: "All changes are synced with the cloud." },
  error: { label: "Sync issue", icon: TriangleAlert, title: "Sync could not complete. Your work is safe locally; we'll retry." },
  "auth-expired": { label: "Sign in again", icon: TriangleAlert, title: "Your saved sign-in expired. Everything still works offline — sign in again to resume syncing." },
};

const PLACEHOLDER_STATUS: SyncStatus = { state: "idle", pendingCount: 0, lastSyncedAt: null, lastError: null };

export function SyncIndicator() {
  // Hydration guard: identical placeholder on server and hydration render.
  const mounted = useIsHydrated();
  // Engine presence doubles as the desktop-runtime flag — probed only after
  // mount, never during render on the server.
  const engine = useSyncExternalStore(
    (onStoreChange: () => void) => {
      const instance = getSyncEngine();
      if (!instance) return () => {};
      return instance.subscribe(() => onStoreChange());
    },
    () => getSyncEngine()?.getStatus() ?? PLACEHOLDER_STATUS,
    () => PLACEHOLDER_STATUS,
  );

  if (!mounted) return <span className="sync-indicator sync-idle" />;
  if (!getSyncEngine()) return null;

  const status = engine;
  const meta = STATE_META[status.state];
  const Icon = status.state === "syncing" || (status.state === "error" && status.pendingCount > 0) ? RefreshCw : meta.icon;
  const detail = status.state === "synced" && status.pendingCount > 0
    ? `${status.pendingCount} change${status.pendingCount === 1 ? "" : "s"} queued`
    : status.pendingCount > 0
      ? `${status.pendingCount} pending`
      : relativeTime(status.lastSyncedAt);

  return (
    <button
      type="button"
      className={`sync-indicator sync-${status.state}`}
      title={status.lastError ? `${meta.title} (${status.lastError})` : meta.title}
      aria-label={`Sync status: ${meta.label}${detail ? ` — ${detail}` : ""}`}
      onClick={() => getSyncEngine()?.forceSync()}
    >
      <Icon size={12} aria-hidden="true" className={status.state === "syncing" ? "sync-spin" : undefined} />
      <span className="sync-label">{meta.label}</span>
      {detail && <span className="sync-detail">{detail}</span>}
    </button>
  );
}
