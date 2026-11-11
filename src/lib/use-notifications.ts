"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationItem,
  type NotificationPreferencesData,
  type ReminderTiming,
  type SchedulerTelemetry,
  type TaskReminderConfig,
} from "@/lib/notifications";
import { isValidTimezone } from "@/lib/timezone";
import { isDesktopRuntime } from "@/lib/desktop/runtime";

const PAGE_SIZE = 30;
const POLL_INTERVAL_MS = 30_000;

/**
 * Desktop shells never fire notification requests while offline: the API is
 * remote, the requests would all reject, and notifications are a cloud-only
 * feature anyway. The UI simply keeps its last-known state (empty on a fresh
 * install) — no error banners, no unhandled rejections, no blocked panels.
 */
function desktopNotificationsOffline(): boolean {
  return isDesktopRuntime() && typeof navigator !== "undefined" && !navigator.onLine;
}

export function broadcastNotificationsSync() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("folio:notifications-sync"));
  }
}

export function useNotifications(
  notify?: (message: string, tone?: "success" | "error") => void,
) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | "all">("all");
  const [panelOpen, setPanelOpen] = useState(false);

  const [preferences, setPreferences] = useState<NotificationPreferencesData>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [scheduler, setScheduler] = useState<SchedulerTelemetry | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);

  const [reminders, setReminders] = useState<TaskReminderConfig[]>([]);

  const panelOpenRef = useRef(panelOpen);
  const unreadRef = useRef(unreadCount);
  const lastPollAt = useRef(0);
  const autoTzAttempted = useRef(false);
  const nativeNotificationCutoffAt = useRef<number | null>(null);
  const seenNativeNotificationIds = useRef(new Set<string>());

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    unreadRef.current = unreadCount;
  }, [unreadCount]);

  const remindersByTask = useMemo(() => {
    const map = new Map<string, TaskReminderConfig>();
    for (const r of reminders) map.set(r.taskId, r);
    return map;
  }, [reminders]);

  const fetchNotifications = useCallback(
    async (opts: { silent?: boolean; appendOffset?: number } = {}) => {
      if (desktopNotificationsOffline()) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      if (!opts.silent && opts.appendOffset === undefined) setLoading(true);
      if (opts.appendOffset !== undefined) setLoadingMore(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(opts.appendOffset ?? 0),
        });
        if (unreadOnly) params.set("unreadOnly", "1");
        if (categoryFilter !== "all") params.set("category", categoryFilter);

        const res = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
        const body = (await res.json()) as {
          notifications?: NotificationItem[];
          unreadCount?: number;
          total?: number;
          hasMore?: boolean;
          timezone?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error || "Couldn’t load notifications.");

        const nextList = body.notifications ?? [];
        if (nativeNotificationCutoffAt.current === null) {
          nativeNotificationCutoffAt.current = Date.now();
        } else {
          for (const item of nextList) {
            if (seenNativeNotificationIds.current.has(item.id)) continue;
            if (
              !item.read &&
              Date.parse(item.createdAt) >= nativeNotificationCutoffAt.current &&
              document.visibilityState === "hidden"
            ) {
              window.folioWindowsAPI?.sendNotification(item.title, item.description);
            }
          }
        }
        for (const item of nextList) seenNativeNotificationIds.current.add(item.id);
        if (opts.appendOffset !== undefined && opts.appendOffset > 0) {
          setItems((prev) => {
            const seen = new Set(prev.map((n) => n.id));
            return [...prev, ...nextList.filter((n) => !seen.has(n.id))];
          });
        } else {
          setItems(nextList);
        }
        if (typeof body.unreadCount === "number") setUnreadCount(body.unreadCount);
        if (typeof body.total === "number") setTotal(body.total);
        setHasMore(Boolean(body.hasMore));
        setError("");
      } catch (err) {
        if (!opts.silent) {
          setError(err instanceof Error ? err.message : "Couldn’t load notifications.");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [unreadOnly, categoryFilter],
  );

  const fetchUnreadCount = useCallback(async () => {
    if (desktopNotificationsOffline()) return;
    try {
      const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { unreadCount?: number };
      lastPollAt.current = Date.now();
      if (typeof body.unreadCount === "number") {
        const changed = body.unreadCount !== unreadRef.current;
        setUnreadCount(body.unreadCount);
        if (changed) {
          void fetchNotifications({ silent: true });
        }
      }
    } catch {
      // Silent background poll failure; UI keeps existing count.
    }
  }, [fetchNotifications]);

  const fetchReminders = useCallback(async () => {
    if (desktopNotificationsOffline()) return;
    try {
      const res = await fetch("/api/notifications/reminders", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { reminders?: TaskReminderConfig[] };
      if (Array.isArray(body.reminders)) setReminders(body.reminders);
    } catch {
      // Ignore transient errors on background reminder refresh.
    }
  }, []);

  const fetchPreferences = useCallback(async () => {
    if (desktopNotificationsOffline()) {
      setPrefsLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/notifications/preferences", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        preferences?: NotificationPreferencesData;
        scheduler?: SchedulerTelemetry;
      };
      if (body.preferences) {
        setPreferences(body.preferences);
        if (body.scheduler) setScheduler(body.scheduler);

        // One-time browser timezone detection so fresh workspaces default to the user's real zone.
        if (!body.preferences.timezoneAutoDetected && !autoTzAttempted.current) {
          autoTzAttempted.current = true;
          const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (browserTz && isValidTimezone(browserTz)) {
            const patchRes = await fetch("/api/notifications/preferences", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ timezone: browserTz, timezoneAutoDetected: true }),
            });
            if (patchRes.ok) {
              const patched = (await patchRes.json()) as {
                preferences?: NotificationPreferencesData;
                scheduler?: SchedulerTelemetry;
              };
              if (patched.preferences) setPreferences(patched.preferences);
              if (patched.scheduler) setScheduler(patched.scheduler);
            }
          }
        }
      }
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  // Initial load & filter updates
  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    void fetchPreferences();
    void fetchReminders();
  }, [fetchPreferences, fetchReminders]);

  // Refresh full list whenever user opens the notification dropdown
  useEffect(() => {
    if (panelOpen) {
      void fetchNotifications({ silent: items.length > 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally triggers on open transition
  }, [panelOpen]);

  // Visibility-aware polling + workspace mutation sync listener
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" || window.folioWindowsAPI) {
        void fetchUnreadCount();
      }
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastPollAt.current > 15_000
      ) {
        void fetchUnreadCount();
        if (panelOpenRef.current) void fetchNotifications({ silent: true });
      }
    };

    const onWorkspaceSync = () => {
      void fetchUnreadCount();
      void fetchReminders();
      if (panelOpenRef.current) void fetchNotifications({ silent: true });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("folio:notifications-sync", onWorkspaceSync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("folio:notifications-sync", onWorkspaceSync);
    };
  }, [fetchUnreadCount, fetchNotifications, fetchReminders]);

  const markRead = useCallback(
    async (id: string, read = true) => {
      let wasUnread = false;
      setItems((prev) =>
        prev.flatMap((item) => {
          if (item.id !== id) return [item];
          wasUnread = !item.read;
          if (unreadOnly && read) return [];
          return [{ ...item, read, readAt: read ? new Date().toISOString() : null }];
        }),
      );
      if (wasUnread && read) setUnreadCount((c) => Math.max(0, c - 1));
      else if (!wasUnread && !read) setUnreadCount((c) => c + 1);

      try {
        const res = await fetch(`/api/notifications/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read }),
        });
        const body = (await res.json()) as { unreadCount?: number; error?: string };
        if (!res.ok) throw new Error(body.error || "Couldn’t update notification.");
        if (typeof body.unreadCount === "number") setUnreadCount(body.unreadCount);
      } catch (err) {
        void fetchNotifications({ silent: true });
        notify?.(err instanceof Error ? err.message : "Couldn’t update notification.", "error");
      }
    },
    [unreadOnly, fetchNotifications, notify],
  );

  const markAllRead = useCallback(async () => {
    const previous = items;
    const prevUnread = unreadCount;
    setUnreadCount(0);
    setItems((prev) =>
      unreadOnly
        ? []
        : prev.map((item) =>
            item.read ? item : { ...item, read: true, readAt: new Date().toISOString() },
          ),
    );
    try {
      const res = await fetch("/api/notifications/mark-all-read", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn’t mark notifications as read.");
    } catch (err) {
      setItems(previous);
      setUnreadCount(prevUnread);
      notify?.(err instanceof Error ? err.message : "Couldn’t mark all as read.", "error");
    }
  }, [items, unreadCount, unreadOnly, notify]);

  const deleteNotification = useCallback(
    async (id: string) => {
      const target = items.find((n) => n.id === id);
      setItems((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      if (target && !target.read) setUnreadCount((c) => Math.max(0, c - 1));

      try {
        const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
        const body = (await res.json()) as { unreadCount?: number; error?: string };
        if (!res.ok) throw new Error(body.error || "Couldn’t delete notification.");
        if (typeof body.unreadCount === "number") setUnreadCount(body.unreadCount);
      } catch (err) {
        void fetchNotifications({ silent: true });
        notify?.(err instanceof Error ? err.message : "Couldn’t delete notification.", "error");
      }
    },
    [items, fetchNotifications, notify],
  );

  const clearAllNotifications = useCallback(async () => {
    const previous = items;
    const prevUnread = unreadCount;
    const prevTotal = total;
    setItems([]);
    setUnreadCount(0);
    setTotal(0);
    setHasMore(false);
    try {
      const res = await fetch("/api/notifications", { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn’t clear notifications.");
      notify?.("All notifications cleared.");
    } catch (err) {
      setItems(previous);
      setUnreadCount(prevUnread);
      setTotal(prevTotal);
      notify?.(err instanceof Error ? err.message : "Couldn’t clear notifications.", "error");
      throw err;
    }
  }, [items, unreadCount, total, notify]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    void fetchNotifications({ appendOffset: items.length });
  }, [loadingMore, hasMore, items.length, fetchNotifications]);

  const saveTaskReminder = useCallback(
    async (input: {
      taskId: string;
      enabled: boolean;
      timing: ReminderTiming;
      dueTime?: string;
      customLocal?: string | null;
    }) => {
      const res = await fetch("/api/notifications/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await res.json()) as { reminder?: TaskReminderConfig; error?: string };
      if (!res.ok || !body.reminder) {
        throw new Error(body.error || "Couldn’t save reminder.");
      }
      const saved = body.reminder;
      setReminders((prev) => {
        const rest = prev.filter((r) => r.taskId !== saved.taskId);
        return [...rest, saved];
      });
      void fetchUnreadCount();
      return saved;
    },
    [fetchUnreadCount],
  );

  const deleteTaskReminder = useCallback(async (taskId: string) => {
    const res = await fetch(
      `/api/notifications/reminders?taskId=${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(body.error || "Couldn’t remove reminder.");
    setReminders((prev) => prev.filter((r) => r.taskId !== taskId));
  }, []);

  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferencesData>) => {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as {
        preferences?: NotificationPreferencesData;
        scheduler?: SchedulerTelemetry;
        error?: string;
      };
      if (!res.ok || !body.preferences) {
        throw new Error(body.error || "Couldn’t save notification preferences.");
      }
      setPreferences(body.preferences);
      if (body.scheduler) setScheduler(body.scheduler);
      void fetchReminders();
      void fetchUnreadCount();
      return body.preferences;
    },
    [fetchReminders, fetchUnreadCount],
  );

  const runReminderCheck = useCallback(async () => {
    const res = await fetch("/api/notifications/process", { method: "POST" });
    const body = (await res.json()) as {
      result?: { created: number; queued: number; released: number };
      scheduler?: SchedulerTelemetry;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error || "Couldn’t check reminders.");
    if (body.scheduler) setScheduler(body.scheduler);
    await fetchNotifications({ silent: true });
    await fetchReminders();
    return body.result ?? { created: 0, queued: 0, released: 0 };
  }, [fetchNotifications, fetchReminders]);

  return {
    items,
    unreadCount,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    unreadOnly,
    setUnreadOnly,
    categoryFilter,
    setCategoryFilter,
    panelOpen,
    setPanelOpen,
    preferences,
    scheduler,
    prefsLoading,
    remindersByTask,
    refreshNotifications: fetchNotifications,
    refreshReminders: fetchReminders,
    refreshPreferences: fetchPreferences,
    markRead,
    markAllRead,
    deleteNotification,
    clearAllNotifications,
    loadMore,
    saveTaskReminder,
    deleteTaskReminder,
    updatePreferences,
    runReminderCheck,
  };
}

export type NotificationsController = ReturnType<typeof useNotifications>;
