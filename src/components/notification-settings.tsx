"use client";
import TIMEZONE_OPTIONS from "@/lib/timezones.json";

import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  Check,
  Clock3,
  FolderKanban,
  Globe,
  Moon,
  RefreshCw,
  ServerCog,
  SquareCheckBig,
} from "lucide-react";
import { Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/types";
import {
  CALENDAR_INTERVAL_OPTIONS,
  DEFAULT_REMINDER_TIMINGS,
  DEFAULT_TIMING_LABELS,
  type DefaultReminderTiming,
  type NotificationPreferencesData,
} from "@/lib/notifications";
import { isValidTimezone } from "@/lib/timezone";
import type { NotificationsController } from "@/lib/use-notifications";

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function getSupportedTimezones(current: string): string[] {
  return [...new Set([current, ...TIMEZONE_OPTIONS])].filter(Boolean);
}

interface NotificationSettingsProps {
  controller: NotificationsController;
  notify: (message: string, tone?: "success" | "error") => void;
}

export function NotificationSettingsSection({
  controller,
  notify,
}: NotificationSettingsProps) {
  const { preferences, scheduler, prefsLoading, updatePreferences, runReminderCheck } =
    controller;

  const [draft, setDraft] = useState<NotificationPreferencesData>(preferences);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const timezones = useMemo(
    () => getSupportedTimezones(draft.timezone),
    [draft.timezone],
  );

  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  async function applyPatch(patch: Partial<NotificationPreferencesData>) {
    const previous = draft;
    const optimistic = { ...draft, ...patch };
    setDraft(optimistic);
    setSaving(true);
    try {
      const saved = await updatePreferences(patch);
      setDraft(saved);
      setSavedAt(Date.now());
    } catch (err) {
      setDraft(previous);
      notify(
        err instanceof Error ? err.message : "Couldn’t save notification preferences.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleInterval(minutes: number) {
    const current = draft.calendarReminderIntervals;
    const exists = current.includes(minutes);
    const next = exists
      ? current.filter((m) => m !== minutes)
      : [...current, minutes].sort((a, b) => a - b);
    if (next.length === 0) {
      notify("Keep at least one reminder interval selected, or pause Event reminders.", "error");
      return;
    }
    void applyPatch({ calendarReminderIntervals: next });
  }

  async function handleCheckNow() {
    setCheckingNow(true);
    try {
      const res = await runReminderCheck();
      const total = res.created + res.released;
      notify(
        total > 0
          ? `Processed reminders — ${total} new notification${total === 1 ? "" : "s"} delivered.`
          : res.queued > 0
            ? `Queued ${res.queued} reminder${res.queued === 1 ? "" : "s"} for after quiet hours.`
            : "All due reminders are up to date.",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t check reminders.", "error");
    } finally {
      setCheckingNow(false);
    }
  }

  if (prefsLoading) {
    return (
      <section id="notifications-settings" className="panel settings-card nf-settings-card">
        <span className="pj-sk" style={{ height: 26, width: "45%", display: "block" }} />
        <span className="pj-sk" style={{ height: 64, marginTop: 14, display: "block" }} />
        <span className="pj-sk" style={{ height: 110, marginTop: 14, display: "block" }} />
      </section>
    );
  }

  const allDisabled = !draft.enabled;

  return (
    <section
      id="notifications-settings"
      className="panel settings-card nf-settings-card"
      aria-labelledby="nf-settings-heading"
    >
      <div className="nf-settings-head">
        <div className="nf-settings-head-left">
          <span className="settings-data-icon nf-settings-hero-icon">
            <Bell size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 id="nf-settings-heading">Notifications & reminders</h2>
            <p>
              Decide what deserves a gentle tap on the shoulder — and when Folio
              should stay quiet.
            </p>
          </div>
        </div>
        <div className="nf-settings-status">
          {saving ? (
            <span className="nf-save-state">
              <Spinner size={12} />
              Saving…
            </span>
          ) : savedAt ? (
            <span className="nf-save-state is-saved">
              <Check size={12} aria-hidden="true" />
              Saved
            </span>
          ) : null}
        </div>
      </div>

      {/* Master switch */}
      <div className="nf-master-row">
        <div>
          <strong>Enable notifications</strong>
          <span>
            Master switch for all task, deadline, project, milestone, and Google
            Calendar notifications.
          </span>
        </div>
        <label className="nf-toggle-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => {
              void applyPatch({ enabled: e.target.checked });
            }}
          />
          <span className="pe-switch" aria-hidden="true" />
          <span className="sr-only">Enable all notifications</span>
        </label>
      </div>

      <div className={`nf-settings-sections ${allDisabled ? "is-dimmed" : ""}`}>
        {/* General Preferences */}
        <div className="nf-pref-block">
          <h3>
            <Clock3 size={15} aria-hidden="true" />
            General preferences
          </h3>

          <div className="nf-pref-grid">
            <label className="nf-pref-field">
              <span>Default task reminder timing</span>
              <select
                value={draft.defaultReminderTiming}
                disabled={allDisabled}
                onChange={(e) => {
                  void applyPatch({
                    defaultReminderTiming: e.target.value as DefaultReminderTiming,
                  });
                }}
              >
                {DEFAULT_REMINDER_TIMINGS.map((timing) => (
                  <option key={timing} value={timing}>
                    {DEFAULT_TIMING_LABELS[timing]}
                  </option>
                ))}
              </select>
              <small>Applied automatically to new tasks that have a due date.</small>
            </label>

            <label className="nf-pref-field">
              <span>Default due time</span>
              <input
                type="time"
                value={draft.defaultDueTime}
                disabled={allDisabled}
                onChange={(e) => {
                  if (e.target.value) {
                    void applyPatch({ defaultDueTime: e.target.value });
                  }
                }}
              />
              <small>Anchor time for date-only tasks and all-day events.</small>
            </label>
          </div>

          <div className="nf-pref-field nf-tz-field">
            <div className="nf-tz-top">
              <label htmlFor="nf-tz-select">
                <Globe size={13} aria-hidden="true" />
                Timezone
              </label>
              {isValidTimezone(browserTimezone) &&
                browserTimezone !== draft.timezone && (
                  <button
                    type="button"
                    className="nf-inline-link"
                    disabled={allDisabled}
                    onClick={() => {
                      void applyPatch({
                        timezone: browserTimezone,
                        timezoneAutoDetected: true,
                      });
                    }}
                  >
                    Use browser timezone ({browserTimezone})
                  </button>
                )}
            </div>
            <select
              id="nf-tz-select"
              value={draft.timezone}
              disabled={allDisabled}
              onChange={(e) => {
                void applyPatch({
                  timezone: e.target.value,
                  timezoneAutoDetected: true,
                });
              }}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <small>
              Used to evaluate Today / Overdue cutoffs, task due times, and quiet
              hours accurately.
            </small>
          </div>

          {/* Quiet Hours */}
          <div className="nf-quiet-box">
            <div className="nf-toggle-row">
              <div>
                <strong>
                  <Moon size={14} aria-hidden="true" />
                  Quiet hours
                  {scheduler?.quietHoursActiveNow && draft.quietHoursEnabled && (
                    <em className="nf-active-tag">Active now</em>
                  )}
                </strong>
                <span>
                  Hold incoming reminders during rest hours and deliver them once
                  quiet hours end.
                </span>
              </div>
              <label className="nf-toggle-label">
                <input
                  type="checkbox"
                  checked={draft.quietHoursEnabled}
                  disabled={allDisabled}
                  onChange={(e) => {
                    void applyPatch({ quietHoursEnabled: e.target.checked });
                  }}
                />
                <span className="pe-switch" aria-hidden="true" />
                <span className="sr-only">Enable quiet hours</span>
              </label>
            </div>

            {draft.quietHoursEnabled && (
              <div className="nf-quiet-times">
                <label>
                  <span>From</span>
                  <input
                    type="time"
                    value={draft.quietHoursStart}
                    disabled={allDisabled}
                    onChange={(e) => {
                      if (e.target.value) {
                        void applyPatch({ quietHoursStart: e.target.value });
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Until</span>
                  <input
                    type="time"
                    value={draft.quietHoursEnd}
                    disabled={allDisabled}
                    onChange={(e) => {
                      if (e.target.value) {
                        void applyPatch({ quietHoursEnd: e.target.value });
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Enabled Notification Categories */}
          <div className="nf-categories-box">
            <span className="nf-sub-label">Enabled notification categories</span>
            <div className="nf-chip-toggles" role="group" aria-label="Notification categories">
              {(
                [
                  ["categoryTask", "Tasks"],
                  ["categoryDeadline", "Deadlines"],
                  ["categoryProject", "Projects"],
                  ["categoryCalendar", "Calendar"],
                  ["categorySystem", "System"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={allDisabled}
                  aria-pressed={draft[key]}
                  className={`nf-chip-btn ${draft[key] ? "is-on" : ""}`}
                  onClick={() => {
                    void applyPatch({ [key]: !draft[key] });
                  }}
                >
                  {draft[key] && <Check size={12} aria-hidden="true" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Task Notifications */}
        <div className="nf-pref-block">
          <h3>
            <SquareCheckBig size={15} aria-hidden="true" />
            Task notifications
          </h3>
          <div className="nf-toggle-list">
            <PrefToggleRow
              title="Upcoming deadlines"
              description="Notify when tasks are due today or due tomorrow."
              checked={draft.taskUpcomingDeadlines}
              disabled={allDisabled || !draft.categoryDeadline}
              onChange={(val) => {
                void applyPatch({ taskUpcomingDeadlines: val });
              }}
            />
            <PrefToggleRow
              title="Overdue tasks"
              description="Alert when an incomplete task passes its due date."
              checked={draft.taskOverdue}
              disabled={allDisabled || !draft.categoryDeadline}
              onChange={(val) => {
                void applyPatch({ taskOverdue: val });
              }}
            />
            <PrefToggleRow
              title="Task reminders"
              description="Deliver custom and scheduled reminders configured on individual tasks."
              checked={draft.taskReminders}
              disabled={allDisabled || !draft.categoryTask}
              onChange={(val) => {
                void applyPatch({ taskReminders: val });
              }}
            />
          </div>
        </div>

        {/* Project Notifications */}
        <div className="nf-pref-block">
          <h3>
            <FolderKanban size={15} aria-hidden="true" />
            Project & milestone notifications
          </h3>
          <div className="nf-toggle-list">
            <PrefToggleRow
              title="Project deadlines"
              description="Heads-up when active project target dates are within 3 days."
              checked={draft.projectDeadlines}
              disabled={allDisabled || !draft.categoryDeadline}
              onChange={(val) => {
                void applyPatch({ projectDeadlines: val });
              }}
            />
            <PrefToggleRow
              title="Milestone reminders"
              description="Notify when milestones are approaching or marked complete."
              checked={draft.milestoneReminders}
              disabled={allDisabled || !draft.categoryProject}
              onChange={(val) => {
                void applyPatch({ milestoneReminders: val });
              }}
            />
            <PrefToggleRow
              title="Project updates"
              description="Status transitions, deadline shifts, and newly converted projects."
              checked={draft.projectUpdates}
              disabled={allDisabled || !draft.categoryProject}
              onChange={(val) => {
                void applyPatch({ projectUpdates: val });
              }}
            />
          </div>
        </div>

        {/* Calendar Notifications */}
        <div className="nf-pref-block">
          <h3>
            <CalendarClock size={15} aria-hidden="true" />
            Google Calendar notifications
          </h3>
          <div className="nf-toggle-list">
            <PrefToggleRow
              title="Upcoming events"
              description="Daily heads-up for confirmed events on your selected Google Calendars."
              checked={draft.calendarUpcomingEvents}
              disabled={allDisabled || !draft.categoryCalendar}
              onChange={(val) => {
                void applyPatch({ calendarUpcomingEvents: val });
              }}
            />
            <PrefToggleRow
              title="Event reminders"
              description="Trigger reminders before Google Calendar events at your chosen intervals."
              checked={draft.calendarEventReminders}
              disabled={allDisabled || !draft.categoryCalendar}
              onChange={(val) => {
                void applyPatch({ calendarEventReminders: val });
              }}
            />
          </div>

          {draft.calendarEventReminders && draft.categoryCalendar && (
            <div className="nf-intervals-box">
              <span className="nf-sub-label">Calendar reminder intervals</span>
              <div className="nf-chip-toggles" role="group" aria-label="Calendar reminder intervals">
                {CALENDAR_INTERVAL_OPTIONS.map((opt) => {
                  const active = draft.calendarReminderIntervals.includes(opt.minutes);
                  return (
                    <button
                      key={opt.minutes}
                      type="button"
                      disabled={allDisabled}
                      aria-pressed={active}
                      className={`nf-chip-btn ${active ? "is-on" : ""}`}
                      onClick={() => toggleInterval(opt.minutes)}
                    >
                      {active && <Check size={12} aria-hidden="true" />}
                      {opt.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Honest Scheduled Processing Telemetry */}
        <div className="nf-scheduler-box">
          <div className="nf-scheduler-top">
            <span className="nf-scheduler-icon">
              <ServerCog size={16} aria-hidden="true" />
            </span>
            <div>
              <h4>
                Reminder delivery engine
                <span
                  className={`nf-sched-badge ${scheduler?.cronConfigured ? "is-cron" : "is-ondemand"}`}
                >
                  {scheduler?.cronConfigured
                    ? scheduler.lastCronRunAt
                      ? "Scheduled cron active"
                      : "Cron endpoint ready"
                    : "No external cron configured"}
                </span>
              </h4>
              <p>
                {scheduler?.cronConfigured
                  ? scheduler.lastCronRunAt
                    ? `External cron last ran ${timeAgo(scheduler.lastCronRunAt)}. Due reminders process automatically even while Folio is closed.`
                    : "FOLIO_CRON_SECRET is configured. Point Netlify Scheduled Functions or your cron runner to POST /api/notifications/process to run while Folio is closed."
                  : "External background cron isn’t configured yet (set FOLIO_CRON_SECRET and schedule POST /api/notifications/process — see REMINDERS_SCHEDULING.md). Due and missed reminders are evaluated server-side whenever Folio connects."}
              </p>
              {scheduler?.lastRunAt && (
                <small className="nf-sched-meta">
                  Last evaluation: {timeAgo(scheduler.lastRunAt)} ({scheduler.lastRunSource ?? "auto"})
                </small>
              )}
            </div>
          </div>
          <button
            type="button"
            className="pj-btn is-secondary is-sm"
            disabled={checkingNow}
            onClick={() => {
              void handleCheckNow();
            }}
          >
            {checkingNow ? (
              <Spinner size={13} />
            ) : (
              <RefreshCw size={13} aria-hidden="true" />
            )}
            Check due reminders
          </button>
        </div>
      </div>
    </section>
  );
}

function PrefToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={`nf-toggle-row ${disabled ? "is-disabled" : ""}`}>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <label className="nf-toggle-label">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="pe-switch" aria-hidden="true" />
        <span className="sr-only">{title}</span>
      </label>
    </div>
  );
}
