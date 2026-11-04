"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  AlertCircle,
  ArrowUpRight,
  Bell,
  BellOff,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  Circle,
  CircleCheck,
  Flag,
  FolderKanban,
  MailCheck,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Modal, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/types";
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationItem,
} from "@/lib/notifications";
import { dayGroupInZone, formatDateTimeInZone, type NotificationDayGroup } from "@/lib/timezone";
import type { NotificationsController } from "@/lib/use-notifications";

interface NotificationCenterProps {
  controller: NotificationsController;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onNavigateEntity: (item: NotificationItem) => void;
  onOpenPreferences: () => void;
}

const GROUP_ORDER: NotificationDayGroup[] = ["Today", "Yesterday", "Earlier"];

function categoryToneAndIcon(item: NotificationItem) {
  if (item.category === "deadline") {
    const overdue = item.type === "task_overdue" || Boolean(item.metadata?.overdue);
    return {
      tone: overdue ? "red" : "amber",
      Icon: overdue ? AlertCircle : AlarmClock,
      badge: overdue ? "Overdue" : "Deadline",
    };
  }
  if (item.category === "project") {
    const isMilestone = item.type === "milestone_approaching" || item.type === "milestone_completed";
    const isDone = item.type === "milestone_completed";
    return {
      tone: isDone ? "green" : "blue",
      Icon: isDone ? CircleCheck : isMilestone ? Flag : FolderKanban,
      badge: isMilestone ? "Milestone" : "Project",
    };
  }
  if (item.category === "calendar") {
    return { tone: "blue", Icon: CalendarClock, badge: "Calendar" };
  }
  if (item.category === "system") {
    const kind = item.metadata?.systemKind;
    if (kind === "welcome") return { tone: "violet", Icon: Sparkles, badge: "Welcome" };
    if (kind === "security") return { tone: "green", Icon: ShieldCheck, badge: "Security" };
    if (kind === "verification") return { tone: "green", Icon: MailCheck, badge: "Verified" };
    if (kind === "integration") return { tone: "blue", Icon: CalendarClock, badge: "Integration" };
    return { tone: "neutral", Icon: Sparkles, badge: "Account" };
  }
  return { tone: "violet", Icon: BellRing, badge: "Task" };
}

function actionLabelForItem(item: NotificationItem): string | null {
  if (item.metadata?.actionLabel) return item.metadata.actionLabel;
  if (item.entityType === "task") return "Open task";
  if (item.entityType === "project") return "View project";
  if (item.entityType === "milestone") return "View milestone";
  if (item.entityType === "calendar_event") return "Open calendar";
  if (item.entityType === "settings") return "Open settings";
  return null;
}

export function NotificationCenter({
  controller,
  isOpen,
  onToggle,
  onClose,
  onNavigateEntity,
  onOpenPreferences,
}: NotificationCenterProps) {
  const {
    items,
    unreadCount,
    hasMore,
    loading,
    loadingMore,
    error,
    unreadOnly,
    setUnreadOnly,
    categoryFilter,
    setCategoryFilter,
    preferences,
    scheduler,
    refreshNotifications,
    markRead,
    markAllRead,
    deleteNotification,
    clearAllNotifications,
    loadMore,
  } = controller;

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    controller.setPanelOpen(isOpen);
  }, [isOpen, controller]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmClearOpen) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, confirmClearOpen, onClose]);

  const grouped = useMemo(() => {
    const buckets: Record<NotificationDayGroup, NotificationItem[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    const now = new Date();
    for (const item of items) {
      const group = dayGroupInZone(item.createdAt, preferences.timezone, now);
      buckets[group].push(item);
    }
    return GROUP_ORDER.filter((group) => buckets[group].length > 0).map((group) => ({
      group,
      list: buckets[group],
    }));
  }, [items, preferences.timezone]);

  async function handleConfirmClear() {
    setClearing(true);
    try {
      await clearAllNotifications();
      setConfirmClearOpen(false);
    } catch {
      // Error toast is already surfaced by controller.
    } finally {
      setClearing(false);
    }
  }

  function handleItemClick(item: NotificationItem) {
    if (!item.read) {
      void markRead(item.id, true);
    }
    onClose();
    onNavigateEntity(item);
  }

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className="notifications-wrap nf-wrap">
      <button
        type="button"
        className={`icon-button notification-button nf-bell-btn ${isOpen ? "is-open" : ""} ${unreadCount > 0 ? "has-unread" : ""}`}
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="nf-badge" aria-hidden="true">
            {badgeText}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className="menu-dismiss"
            aria-label="Close notifications"
            onClick={onClose}
          />
          <div
            ref={panelRef}
            className="nf-panel"
            role="dialog"
            aria-label="Notification center"
          >
            <header className="nf-header">
              <div className="nf-header-title">
                <h3>Notifications</h3>
                {unreadCount > 0 && (
                  <span className="nf-unread-pill">{unreadCount} new</span>
                )}
                {!preferences.enabled && (
                  <span className="nf-paused-pill" title="All notifications are paused in Settings">
                    <BellOff size={11} aria-hidden="true" />
                    Paused
                  </span>
                )}
                {preferences.enabled && scheduler?.quietHoursActiveNow && (
                  <span
                    className="nf-quiet-pill"
                    title={`Quiet hours active (${preferences.quietHoursStart}–${preferences.quietHoursEnd})`}
                  >
                    <Moon size={11} aria-hidden="true" />
                    Quiet
                  </span>
                )}
              </div>

              <div className="nf-header-actions">
                <button
                  type="button"
                  className="nf-action-btn"
                  disabled={unreadCount === 0}
                  title="Mark all notifications as read"
                  aria-label="Mark all notifications as read"
                  onClick={() => {
                    void markAllRead();
                  }}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  <span>Mark all read</span>
                </button>
                <button
                  type="button"
                  className="nf-icon-btn"
                  disabled={items.length === 0 && unreadCount === 0}
                  title="Clear all notifications"
                  aria-label="Clear all notifications"
                  onClick={() => setConfirmClearOpen(true)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="nf-icon-btn"
                  title="Notification preferences"
                  aria-label="Notification preferences"
                  onClick={() => {
                    onClose();
                    onOpenPreferences();
                  }}
                >
                  <Settings2 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="nf-icon-btn"
                  aria-label="Close notification center"
                  onClick={onClose}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="nf-filters">
              <div className="nf-tabs" role="tablist" aria-label="Filter by read state">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!unreadOnly}
                  className={!unreadOnly ? "is-active" : ""}
                  onClick={() => setUnreadOnly(false)}
                >
                  All
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={unreadOnly}
                  className={unreadOnly ? "is-active" : ""}
                  onClick={() => setUnreadOnly(true)}
                >
                  Unread
                  {unreadCount > 0 && <span>{unreadCount}</span>}
                </button>
              </div>

              <div className="nf-cat-pills" role="group" aria-label="Filter by category">
                <button
                  type="button"
                  className={categoryFilter === "all" ? "is-active" : ""}
                  aria-pressed={categoryFilter === "all"}
                  onClick={() => setCategoryFilter("all")}
                >
                  All types
                </button>
                {NOTIFICATION_CATEGORIES.map(
                  (cat: NotificationCategory) => (
                    <button
                      key={cat}
                      type="button"
                      className={categoryFilter === cat ? "is-active" : ""}
                      aria-pressed={categoryFilter === cat}
                      onClick={() =>
                        setCategoryFilter(categoryFilter === cat ? "all" : cat)
                      }
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="nf-body">
              {loading && items.length === 0 ? (
                <div className="nf-skeleton-list" role="status" aria-label="Loading notifications">
                  {[0, 1, 2].map((idx) => (
                    <div key={idx} className="nf-skeleton-row">
                      <span className="pj-sk nf-sk-icon" />
                      <div className="nf-sk-lines">
                        <span className="pj-sk" style={{ width: "74%", height: 13 }} />
                        <span className="pj-sk" style={{ width: "92%", height: 11 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="nf-empty is-error" role="alert">
                  <span className="nf-empty-icon is-red">
                    <AlertCircle size={20} aria-hidden="true" />
                  </span>
                  <h4>Couldn’t load notifications</h4>
                  <p>{error}</p>
                  <button
                    type="button"
                    className="pj-btn is-secondary is-sm"
                    onClick={() => {
                      void refreshNotifications();
                    }}
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    Try again
                  </button>
                </div>
              ) : grouped.length === 0 ? (
                <div className="nf-empty">
                  <span className="nf-empty-icon">
                    <Sparkles size={20} strokeWidth={1.65} aria-hidden="true" />
                  </span>
                  <h4>
                    {unreadOnly
                      ? "You’re all caught up"
                      : categoryFilter !== "all"
                        ? `No ${CATEGORY_LABELS[categoryFilter].toLowerCase()} notifications`
                        : "Calm, clear, and caught up"}
                  </h4>
                  <p>
                    {unreadOnly
                      ? "Every notification has been read. Switch to All to browse earlier activity."
                      : categoryFilter !== "all"
                        ? "Nothing in this category right now. Try viewing all notification types."
                        : "Task reminders, approaching deadlines, milestone wins, and calendar alerts will appear right here."}
                  </p>
                  {(unreadOnly || categoryFilter !== "all") && (
                    <button
                      type="button"
                      className="pj-btn is-secondary is-sm"
                      onClick={() => {
                        setUnreadOnly(false);
                        setCategoryFilter("all");
                      }}
                    >
                      Show all notifications
                    </button>
                  )}
                </div>
              ) : (
                <div className="nf-groups">
                  {grouped.map(({ group, list }) => (
                    <section key={group} className="nf-group" aria-label={group}>
                      <h4 className="nf-group-heading">{group}</h4>
                      <ul className="nf-list">
                        {list.map((item) => {
                          const { tone, Icon, badge } = categoryToneAndIcon(item);
                          const actionHint = actionLabelForItem(item);
                          const exactTime = formatDateTimeInZone(
                            item.createdAt,
                            preferences.timezone,
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          );
                          const shortClock = formatDateTimeInZone(
                            item.createdAt,
                            preferences.timezone,
                            {
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          );
                          return (
                            <li
                              key={item.id}
                              className={`nf-item ${item.read ? "is-read" : "is-unread"}`}
                            >
                              <button
                                type="button"
                                className="nf-item-main"
                                onClick={() => handleItemClick(item)}
                              >
                                <span
                                  className={`nf-item-icon tone-${tone}`}
                                  aria-hidden="true"
                                >
                                  <Icon size={15} strokeWidth={1.9} />
                                </span>
                                <span className="nf-item-content">
                                  <span className="nf-item-top">
                                    <strong className="nf-item-title">
                                      {!item.read && (
                                        <i
                                          className="nf-unread-dot"
                                          aria-label="Unread"
                                        />
                                      )}
                                      {item.title}
                                    </strong>
                                  </span>
                                  {item.description && (
                                    <span className="nf-item-desc">
                                      {item.description}
                                    </span>
                                  )}
                                  <span className="nf-item-meta">
                                    <span className={`nf-cat-chip tone-${tone}`}>
                                      {badge || CATEGORY_LABELS[item.category] || item.category}
                                    </span>
                                    <time
                                      dateTime={item.createdAt}
                                      title={exactTime}
                                    >
                                      {timeAgo(item.createdAt)} &middot; {shortClock}
                                    </time>
                                    {actionHint && (
                                      <span className="nf-item-cta">
                                        {actionHint}
                                        <ArrowUpRight size={11} aria-hidden="true" />
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </button>

                              <div className="nf-item-actions">
                                <button
                                  type="button"
                                  className="nf-mini-btn"
                                  title={item.read ? "Mark as unread" : "Mark as read"}
                                  aria-label={
                                    item.read
                                      ? `Mark "${item.title}" as unread`
                                      : `Mark "${item.title}" as read`
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void markRead(item.id, !item.read);
                                  }}
                                >
                                  {item.read ? (
                                    <Circle size={12} aria-hidden="true" />
                                  ) : (
                                    <Check size={13} aria-hidden="true" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="nf-mini-btn is-danger"
                                  title="Delete notification"
                                  aria-label={`Delete "${item.title}"`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deleteNotification(item.id);
                                  }}
                                >
                                  <Trash2 size={12} aria-hidden="true" />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}

                  {hasMore && (
                    <div className="nf-load-more">
                      <button
                        type="button"
                        className="pj-btn is-secondary is-sm"
                        disabled={loadingMore}
                        onClick={loadMore}
                      >
                        {loadingMore ? (
                          <>
                            <Spinner size={13} />
                            Loading…
                          </>
                        ) : (
                          "Load earlier notifications"
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="nf-footer">
              <span>Timezone: {preferences.timezone}</span>
              <button
                type="button"
                className="nf-footer-link"
                onClick={() => {
                  onClose();
                  onOpenPreferences();
                }}
              >
                Manage preferences
              </button>
            </footer>
          </div>
        </>
      )}

      {confirmClearOpen && (
        <Modal
          title="Clear all notifications?"
          onClose={() => {
            if (!clearing) setConfirmClearOpen(false);
          }}
          className="confirm-modal"
        >
          <div className="confirm-icon">
            <Trash2 size={24} />
          </div>
          <h3>Start with a clean slate</h3>
          <p>
            This permanently removes all notifications currently in your
            notification center. Active task and calendar reminders scheduled
            for the future will still trigger on time.
          </p>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={clearing}
              onClick={() => setConfirmClearOpen(false)}
            >
              Keep notifications
            </button>
            <button
              type="button"
              className="button danger"
              disabled={clearing}
              onClick={() => {
                void handleConfirmClear();
              }}
            >
              {clearing ? <Spinner size={15} /> : <Trash2 size={15} />}
              Clear all
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
