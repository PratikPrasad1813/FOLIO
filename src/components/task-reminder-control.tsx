"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Bell, BellOff, BellRing, Check, Clock3, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui";
import type { Task } from "@/lib/types";
import {
  computeTaskRemindAt,
  REMINDER_TIMING_LABELS,
  REMINDER_TIMINGS,
  type ReminderTiming,
  type TaskReminderDraft,
} from "@/lib/notifications";
import { formatDateTimeInZone, formatUtcToCustomLocal } from "@/lib/timezone";
import type { NotificationsController } from "@/lib/use-notifications";

interface TaskEditorReminderProps {
  value: TaskReminderDraft;
  onChange: (next: TaskReminderDraft) => void;
  dueDate: string;
  timezone: string;
  disabled?: boolean;
}

export function TaskEditorReminderField({
  value,
  onChange,
  dueDate,
  timezone,
  disabled,
}: TaskEditorReminderProps) {
  const id = useId();

  const preview = useMemo(() => {
    if (!value.enabled) return null;
    const computed = computeTaskRemindAt({
      dueDate: dueDate || null,
      timing: value.timing,
      dueTime: value.dueTime || "09:00",
      customLocal: value.customLocal,
      timezone,
    });
    if (!computed) return null;
    return formatDateTimeInZone(computed, timezone, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [value, dueDate, timezone]);

  function handleToggle(enabled: boolean) {
    let nextTiming = value.timing;
    let nextCustom = value.customLocal;
    if (enabled && !dueDate && nextTiming !== "custom") {
      nextTiming = "custom";
      if (!nextCustom) {
        nextCustom = formatUtcToCustomLocal(
          new Date(Date.now() + 60 * 60_000),
          timezone,
        );
      }
    }
    onChange({
      ...value,
      enabled,
      timing: nextTiming,
      customLocal: nextCustom,
    });
  }

  function handleTimingChange(timing: ReminderTiming) {
    let nextCustom = value.customLocal;
    if (timing === "custom" && !nextCustom) {
      const base = dueDate
        ? `${dueDate}T${value.dueTime || "09:00"}`
        : formatUtcToCustomLocal(new Date(Date.now() + 60 * 60_000), timezone);
      nextCustom = base;
    }
    onChange({
      ...value,
      enabled: true,
      timing,
      customLocal: nextCustom,
    });
  }

  return (
    <div className="pe-field nf-rem-editor">
      <div className="nf-rem-editor-top">
        <label htmlFor={`${id}-toggle`} className="nf-rem-label">
          <Bell size={13} aria-hidden="true" />
          Reminder <em>Optional</em>
        </label>
        <label className="tk-inline-toggle nf-rem-switch">
          <input
            id={`${id}-toggle`}
            type="checkbox"
            checked={value.enabled}
            disabled={disabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          <span className="pe-switch" aria-hidden="true" />
          <span>{value.enabled ? "Enabled" : "Off"}</span>
        </label>
      </div>

      {value.enabled && (
        <div className="nf-rem-controls">
          <div className="nf-rem-grid">
            <div className="nf-rem-col">
              <label htmlFor={`${id}-timing`}>When to remind</label>
              <select
                id={`${id}-timing`}
                className="tk-select-input"
                value={value.timing}
                disabled={disabled}
                onChange={(e) => handleTimingChange(e.target.value as ReminderTiming)}
              >
                {REMINDER_TIMINGS.map((t) => (
                  <option key={t} value={t}>
                    {REMINDER_TIMING_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {value.timing === "custom" ? (
              <div className="nf-rem-col">
                <label htmlFor={`${id}-custom`}>Date & time</label>
                <input
                  id={`${id}-custom`}
                  type="datetime-local"
                  value={value.customLocal ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ ...value, customLocal: e.target.value || null })
                  }
                />
              </div>
            ) : (
              <div className="nf-rem-col is-narrow">
                <label htmlFor={`${id}-duetime`}>Due time</label>
                <input
                  id={`${id}-duetime`}
                  type="time"
                  value={value.dueTime || "09:00"}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ ...value, dueTime: e.target.value || "09:00" })
                  }
                />
              </div>
            )}
          </div>

          <p className="nf-rem-hint">
            <Clock3 size={12} aria-hidden="true" />
            {preview ? (
              <span>
                Will notify on <strong>{preview}</strong> ({timezone})
              </span>
            ) : !dueDate && value.timing !== "custom" ? (
              <span>
                Select a due date above, or switch to{" "}
                <button
                  type="button"
                  className="nf-inline-link"
                  onClick={() => handleTimingChange("custom")}
                >
                  Custom date & time
                </button>
                .
              </span>
            ) : (
              <span>Choose a valid date and time for this reminder.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

interface TaskDetailsReminderProps {
  task: Task;
  controller: NotificationsController;
  notify: (message: string, tone?: "success" | "error") => void;
}

export function TaskDetailsReminderSection({
  task,
  controller,
  notify,
}: TaskDetailsReminderProps) {
  const id = useId();
  const existing = controller.remindersByTask.get(task.id);
  const { preferences } = controller;

  const defaultTiming: ReminderTiming =
    preferences.defaultReminderTiming !== "none"
      ? preferences.defaultReminderTiming
      : "1h_before";

  const [timing, setTiming] = useState<ReminderTiming>(existing?.timing ?? defaultTiming);
  const [dueTime, setDueTime] = useState<string>(
    existing?.dueTime ?? preferences.defaultDueTime ?? "09:00",
  );
  const [customLocal, setCustomLocal] = useState<string>(
    existing?.customLocal ??
      formatUtcToCustomLocal(new Date(Date.now() + 60 * 60_000), preferences.timezone),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setTiming(existing.timing);
      setDueTime(existing.dueTime || "09:00");
      if (existing.customLocal) setCustomLocal(existing.customLocal);
    }
  }, [existing]);

  const isEnabled = Boolean(existing?.enabled);

  async function persist(next: {
    enabled: boolean;
    timing: ReminderTiming;
    dueTime: string;
    customLocal: string | null;
  }) {
    setSaving(true);
    try {
      await controller.saveTaskReminder({
        taskId: task.id,
        enabled: next.enabled,
        timing: next.timing,
        dueTime: next.dueTime,
        customLocal: next.timing === "custom" ? next.customLocal : null,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t update reminder.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnableToggle(checked: boolean) {
    let nextTiming = timing;
    let nextCustom = customLocal;
    if (checked && !task.dueDate && nextTiming !== "custom") {
      nextTiming = "custom";
      setTiming("custom");
      if (!nextCustom) {
        nextCustom = formatUtcToCustomLocal(
          new Date(Date.now() + 60 * 60_000),
          preferences.timezone,
        );
        setCustomLocal(nextCustom);
      }
    }
    await persist({
      enabled: checked,
      timing: nextTiming,
      dueTime,
      customLocal: nextCustom,
    });
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await controller.deleteTaskReminder(task.id);
      notify("Reminder removed.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn’t remove reminder.", "error");
    } finally {
      setSaving(false);
    }
  }

  const scheduledText = useMemo(() => {
    if (!existing || !existing.enabled) return null;
    if (task.completed) return "Paused (task completed)";
    if (existing.status === "delivered" && existing.deliveredAt) {
      return `Delivered ${formatDateTimeInZone(existing.deliveredAt, preferences.timezone)}`;
    }
    if (!existing.remindAt) {
      return existing.timing !== "custom" && !task.dueDate
        ? "Waiting for a task due date"
        : "Not scheduled";
    }
    return `Scheduled for ${formatDateTimeInZone(existing.remindAt, preferences.timezone, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }, [existing, task.completed, task.dueDate, preferences.timezone]);

  return (
    <section className="tk-section nf-task-rem-section" aria-label="Task reminder">
      <header className="tk-section-head">
        <h3>
          {isEnabled ? (
            <BellRing size={15} aria-hidden="true" />
          ) : (
            <BellOff size={15} aria-hidden="true" />
          )}
          Reminder
        </h3>
        <div className="nf-task-rem-head-right">
          {saving && (
            <span className="nf-rem-saving">
              <Spinner size={12} />
              Saving…
            </span>
          )}
          <label className="tk-inline-toggle nf-rem-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={saving}
              aria-label="Enable reminder for this task"
              onChange={(e) => {
                void handleEnableToggle(e.target.checked);
              }}
            />
            <span className="pe-switch" aria-hidden="true" />
            <span>{isEnabled ? "On" : "Off"}</span>
          </label>
        </div>
      </header>

      {isEnabled ? (
        <div className="nf-rem-controls is-drawer">
          <div className="nf-rem-grid">
            <div className="nf-rem-col">
              <label htmlFor={`${id}-timing`}>Timing</label>
              <select
                id={`${id}-timing`}
                className="tk-prop-input nf-bordered-input"
                value={timing}
                disabled={saving}
                onChange={(e) => {
                  const next = e.target.value as ReminderTiming;
                  setTiming(next);
                  const fallbackCustom =
                    customLocal ||
                    (task.dueDate
                      ? `${task.dueDate}T${dueTime}`
                      : formatUtcToCustomLocal(
                          new Date(Date.now() + 60 * 60_000),
                          preferences.timezone,
                        ));
                  if (next === "custom" && !customLocal) setCustomLocal(fallbackCustom);
                  void persist({
                    enabled: true,
                    timing: next,
                    dueTime,
                    customLocal: next === "custom" ? fallbackCustom : null,
                  });
                }}
              >
                {REMINDER_TIMINGS.map((t) => (
                  <option key={t} value={t}>
                    {REMINDER_TIMING_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            {timing === "custom" ? (
              <div className="nf-rem-col">
                <label htmlFor={`${id}-custom`}>Custom date & time</label>
                <div className="nf-custom-dt-row">
                  <input
                    id={`${id}-custom`}
                    type="datetime-local"
                    className="tk-prop-input nf-bordered-input"
                    value={customLocal}
                    disabled={saving}
                    onChange={(e) => setCustomLocal(e.target.value)}
                    onBlur={() => {
                      if (customLocal && customLocal !== existing?.customLocal) {
                        void persist({
                          enabled: true,
                          timing: "custom",
                          dueTime,
                          customLocal,
                        });
                      }
                    }}
                  />
                  {customLocal && customLocal !== existing?.customLocal && (
                    <button
                      type="button"
                      className="pj-btn is-secondary is-sm"
                      disabled={saving}
                      onClick={() => {
                        void persist({
                          enabled: true,
                          timing: "custom",
                          dueTime,
                          customLocal,
                        });
                      }}
                    >
                      <Check size={13} aria-hidden="true" />
                      Set
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="nf-rem-col is-narrow">
                <label htmlFor={`${id}-duetime`}>Due time</label>
                <input
                  id={`${id}-duetime`}
                  type="time"
                  className="tk-prop-input nf-bordered-input"
                  value={dueTime}
                  disabled={saving}
                  onChange={(e) => {
                    const nextTime = e.target.value || "09:00";
                    setDueTime(nextTime);
                    void persist({
                      enabled: true,
                      timing,
                      dueTime: nextTime,
                      customLocal: null,
                    });
                  }}
                />
              </div>
            )}
          </div>

          <div className="nf-rem-status-bar">
            <span
              className={`nf-rem-status-chip is-${existing?.status ?? "pending"} ${task.completed ? "is-paused" : ""}`}
            >
              <Clock3 size={12} aria-hidden="true" />
              {scheduledText ?? "Pending"}
            </span>
            {existing && (
              <button
                type="button"
                className="nf-inline-remove"
                disabled={saving}
                onClick={() => {
                  void handleRemove();
                }}
              >
                <Trash2 size={12} aria-hidden="true" />
                Remove
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="tk-feed-empty nf-rem-off-copy">
          Turn on a reminder to get notified before this task is due — or pick any
          custom date and time.
        </p>
      )}
    </section>
  );
}
