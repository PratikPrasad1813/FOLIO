"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  Check,
  FolderKanban,
  Lightbulb,
  ListTodo,
  MailCheck,
  Plus,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { dateKey } from "@/lib/types";
import { personalAddress } from "@/lib/personalization";
import { Spinner } from "@/components/ui";
import { EMAIL_FEATURES_ENABLED, EMAIL_FEATURES_NOTICE } from "@/lib/feature-flags";
import type { WorkspaceActions } from "@/components/workspace-views";

export function WorkspaceConcierge({
  actions,
  onReload,
}: {
  actions: WorkspaceActions;
  onReload?: () => void;
}) {
  const { user, projects, tasks, ideas } = actions.data;
  const [dismissedLocal, setDismissedLocal] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Never show on automated demo screenshot profiles or once dismissed by the user.
  if (user.provider === "demo" || user.guideDismissed || dismissedLocal) {
    return null;
  }

  const greetingName = user.greetingName || personalAddress(user.name, user.personal);
  const workUses = user.personal?.workUses ?? [];
  const hasProject = projects.length > 0;
  const hasTask = tasks.length > 0;
  const hasIdea = ideas.length > 0;

  const checklist = [
    {
      id: "profile",
      done: Boolean(user.onboardingCompleted),
      title: "Shape your workspace rhythm",
      detail: `Set to ${user.timezone || "UTC"} · ${user.weeklyGoal} tasks/week focus.`,
      ctaLabel: "Tune preferences",
      href: "/preferences",
    },
    {
      id: "project",
      done: hasProject,
      title: "Create your first project",
      detail: hasProject
        ? `Started with “${projects[0].name}”.`
        : "Give an important goal a dedicated home and clear milestones.",
      ctaLabel: hasProject ? "View projects" : "Create project",
      primary: !hasProject,
      onClick: () =>
        hasProject ? actions.navigate("projects") : actions.openEditor({ kind: "projects" }),
    },
    {
      id: "task",
      done: hasTask,
      title: "Add one actionable next step",
      detail: hasTask
        ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} in your workspace.`
        : "Capture a concrete task you can move forward today.",
      ctaLabel: hasTask ? "Open tasks" : "Add task",
      primary: hasProject && !hasTask,
      onClick: () =>
        hasTask
          ? actions.navigate("tasks")
          : actions.openEditor({
              kind: "tasks",
              defaults: {
                dueDate: dateKey(),
                ...(projects[0] ? { projectId: projects[0].id } : {}),
              },
            }),
    },
    {
      id: "idea",
      done: hasIdea,
      title: "Park an idea for later",
      detail: hasIdea
        ? `${ideas.length} ${ideas.length === 1 ? "idea" : "ideas"} saved on your board.`
        : "Keep early sparks on your Idea Board until they are ready.",
      ctaLabel: hasIdea ? "Open ideas" : "Capture idea",
      primary: hasProject && hasTask && !hasIdea,
      onClick: () =>
        hasIdea ? actions.navigate("ideas") : actions.openEditor({ kind: "ideas" }),
    },
  ];

  const completedCount = checklist.filter((step) => step.done).length;
  const progressPercent = Math.round((completedCount / checklist.length) * 100);
  const allCompleted = completedCount === checklist.length;

  const personalizedContext =
    workUses.length > 0
      ? `Configured around ${workUses.slice(0, 2).join(" & ").toLowerCase()} — everything starts calm, private, and free of sample clutter.`
      : "Your workspace starts intentionally clear and free of sample clutter—so every project, task, and idea belongs genuinely to you.";

  async function dismissGuide() {
    if (dismissing) return;
    setDismissing(true);
    setDismissedLocal(true);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guideDismissed: true }),
      });
      onReload?.();
    } catch {
      // Optimistic hide stays active for this view; next load reflects server state.
    } finally {
      setDismissing(false);
    }
  }

  async function requestVerification() {
    if (verifyBusy) return;
    setVerifyBusy(true);
    setVerifyNotice(null);
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok) {
        setVerifyNotice({
          tone: "err",
          text: result.error || "Verification email could not be sent right now.",
        });
      } else {
        setVerifyNotice({
          tone: "ok",
          text: result.message || `Verification link sent to ${user.email}.`,
        });
      }
    } catch {
      setVerifyNotice({
        tone: "err",
        text: "We couldn’t reach the verification service. Please try again.",
      });
    } finally {
      setVerifyBusy(false);
    }
  }

  return (
    <section className="vip-concierge dash-rise" aria-label="Getting started with Folio">
      <div className="vip-concierge-top">
        <div className="vip-concierge-intro">
          <div className="vip-concierge-badges">
            <span className="vip-eyebrow-pill">
              <Sparkles size={12} />
              {allCompleted ? "WORKSPACE READY" : "FIRST-LOGIN GUIDE"}
            </span>
            <span className="vip-progress-pill">
              {completedCount} of {checklist.length} completed
            </span>
          </div>
          <h2>
            {allCompleted
              ? `Beautiful momentum, ${greetingName}.`
              : `Welcome to your Folio workspace, ${greetingName}.`}
          </h2>
          <p>{personalizedContext}</p>
        </div>

        <div className="vip-concierge-controls">
          <div className="vip-progress-track" role="progressbar" aria-label="Onboarding checklist progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <i style={{ width: `${Math.max(8, progressPercent)}%` }} />
          </div>
          <button
            type="button"
            className={`vip-dismiss-btn ${allCompleted ? "is-complete" : ""}`}
            disabled={dismissing}
            onClick={() => void dismissGuide()}
          >
            {allCompleted ? <Check size={13} /> : <X size={13} />}
            <span>{allCompleted ? "Complete guide" : "Dismiss guide"}</span>
          </button>
        </div>
      </div>

      <div className="vip-checklist-grid">
        {checklist.map((item, idx) => (
          <article
            key={item.id}
            className={`vip-step-card ${item.done ? "is-done" : ""} ${item.primary ? "is-featured" : ""}`}
          >
            <div className="vip-step-head">
              <span className="vip-step-num" aria-hidden="true">
                {item.done ? <Check size={13} strokeWidth={2.4} /> : `0${idx + 1}`}
              </span>
              <strong>{item.title}</strong>
            </div>
            <p>{item.detail}</p>
            <div className="vip-step-foot">
              {item.href ? (
                <Link href={item.href} className="vip-step-action">
                  <SlidersHorizontal size={12} />
                  {item.ctaLabel}
                  <ArrowRight size={12} />
                </Link>
              ) : (
                <button
                  type="button"
                  className={`vip-step-action ${item.primary ? "is-primary" : ""}`}
                  onClick={item.onClick}
                >
                  {item.primary && <Plus size={13} />}
                  {item.ctaLabel}
                  {!item.primary && <ArrowRight size={12} />}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="vip-pillars" aria-label="Core workspace capabilities">
        <button type="button" className="vip-pillar" onClick={() => actions.navigate("projects")}>
          <span className="vip-pillar-icon tone-violet">
            <FolderKanban size={15} />
          </span>
          <span>
            <strong>Projects &amp; Milestones</strong>
            <small>Structure big ambitions into trackable checkpoints.</small>
          </span>
        </button>
        <button type="button" className="vip-pillar" onClick={() => actions.navigate("tasks")}>
          <span className="vip-pillar-icon tone-blue">
            <ListTodo size={15} />
          </span>
          <span>
            <strong>Board, List &amp; Insights</strong>
            <small>Work in Kanban, sorted lists, or timeline views.</small>
          </span>
        </button>
        <button type="button" className="vip-pillar" onClick={() => actions.navigate("calendar")}>
          <span className="vip-pillar-icon tone-green">
            <CalendarDays size={15} />
          </span>
          <span>
            <strong>Unified Schedule</strong>
            <small>View deadlines beside optional Google Calendar sync.</small>
          </span>
        </button>
        <button type="button" className="vip-pillar" onClick={() => actions.navigate("ai")}>
          <span className="vip-pillar-icon tone-amber">
            <BrainCircuit size={15} />
          </span>
          <span>
            <strong>Local-First Folio AI</strong>
            <small>On-device WebGPU assistant with reviewed actions.</small>
          </span>
        </button>
      </div>

      {!EMAIL_FEATURES_ENABLED && user.provider === "email" && !user.emailVerified && (
        <p className="folio-notice" role="note">
          <Sparkles size={13} />
          <span>{EMAIL_FEATURES_NOTICE}</span>
        </p>
      )}
      {EMAIL_FEATURES_ENABLED && user.provider === "email" && !user.emailVerified && (
        <div className="vip-verify-strip">
          <div className="vip-verify-copy">
            <MailCheck size={15} />
            <span>
              <strong>Protect account recovery:</strong> confirm <em>{user.email}</em> so password resets and provider linking stay active.
            </span>
          </div>
          <button
            type="button"
            className="vip-verify-btn"
            disabled={verifyBusy}
            onClick={() => void requestVerification()}
          >
            {verifyBusy ? <Spinner size={13} /> : <Lightbulb size={13} />}
            Send verification link
          </button>
          {verifyNotice && (
            <p className={`vip-verify-feedback is-${verifyNotice.tone}`} role="status">
              {verifyNotice.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
