"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Flame,
  Lock,
  Mail,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { User } from "@/lib/types";
import { Modal, Spinner } from "@/components/ui";

interface DangerZoneProps {
  user: User;
  notify?: (message: string, tone?: "success" | "error") => void;
}

export function DangerZoneSection({ user, notify }: DangerZoneProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section className="panel settings-card danger-zone-card" id="danger-zone">
      <div className="danger-zone-header">
        <div className="danger-zone-title-wrap">
          <span className="danger-zone-badge">
            <Flame size={12} />
            DANGER ZONE
          </span>
          <h2>Delete account</h2>
          <p>
            Permanently delete your Folio account, all projects, tasks, milestones, calendar sync, ideas, and AI conversations. This action cannot be reversed.
          </p>
        </div>
      </div>

      <div className="danger-zone-body">
        <div className="danger-zone-desc">
          <strong>There is no recovery or undo.</strong>
          <span>
            Once deleted, your workspace and all associated records are permanently erased from PostgreSQL. You will be signed out immediately.
          </span>
        </div>
        <button
          type="button"
          className="button danger danger-zone-btn"
          onClick={() => setModalOpen(true)}
          id="delete-account-button"
        >
          <Trash2 size={15} />
          Delete account…
        </button>
      </div>

      {modalOpen && (
        <DeleteAccountModal
          user={user}
          onClose={() => setModalOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}

interface DeleteAccountModalProps {
  user: User;
  onClose: () => void;
  notify?: (message: string, tone?: "success" | "error") => void;
}

export function DeleteAccountModal({ user, onClose, notify }: DeleteAccountModalProps) {
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requiresPassword = Boolean(user.hasPassword ?? user.provider === "email");
  const normalizedConf = confirmation.trim().toLowerCase();
  const normalizedEmail = user.email.trim().toLowerCase();
  const isConfirmationMatched =
    normalizedConf === normalizedEmail || normalizedConf === "delete my account";
  const isFormValid =
    isConfirmationMatched && (!requiresPassword || password.length >= 1) && !busy;

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (!isFormValid || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: confirmation.trim(),
          ...(requiresPassword ? { password } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not delete your account. Please try again.");
      }

      // Invalidate frontend state and redirect to the landing page
      delete document.documentElement.dataset.folioAccount;
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("folio-session");
          sessionStorage.clear();
        } catch {
          // ignore storage clearing
        }
        window.location.assign("/?deleted=account_deleted");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete your account.";
      setError(message);
      notify?.(message, "error");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Delete your Folio account"
      subtitle="This action is immediate and cannot be undone."
      onClose={() => {
        if (!busy) onClose();
      }}
      className="delete-account-modal"
    >
      <div className="delete-modal-content">
        <div className="delete-warning-banner" role="alert">
          <ShieldAlert size={20} className="warning-icon" />
          <div>
            <strong>Irreversible account erasure</strong>
            <p>
              Your account, workspaces, and all owned data will be permanently wiped from the database.
            </p>
          </div>
        </div>

        <div className="delete-data-categories">
          <h4>Categories of data that will be permanently destroyed:</h4>
          <ul>
            <li>
              <span>📁 Projects &amp; Milestones:</span> All boards, descriptions, checkpoints, and progress metrics.
            </li>
            <li>
              <span>✅ Tasks &amp; Subtasks:</span> All tasks, checklists, notes, tags, estimates, and reminder timers.
            </li>
            <li>
              <span>💡 Idea Board:</span> All captured sparks, notes, categories, and exploration stages.
            </li>
            <li>
              <span>📅 Calendar &amp; Integrations:</span> Connected Google Calendar accounts, synced mirrors, and tokens.
            </li>
            <li>
              <span>🧠 Folio AI:</span> Assistant conversation history, saved plans, and customized assistant personas.
            </li>
            <li>
              <span>⚙️ Account &amp; Security:</span> Passwords, linked OAuth identities, active sessions, and personal preferences.
            </li>
          </ul>
        </div>

        <form onSubmit={handleDelete} className="delete-modal-form" noValidate>
          {requiresPassword && (
            <div className="form-field">
              <label htmlFor="delete-current-password">
                <Lock size={13} />
                <span>Current password</span>
                <em>Required for re-authentication</em>
              </label>
              <div className="password-input-wrap">
                <input
                  id="delete-current-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your current password"
                  autoComplete="current-password"
                  disabled={busy}
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="delete-confirm-email">
              <Mail size={13} />
              <span>Confirm by typing your email address</span>
              <em>Type <strong>{user.email}</strong></em>
            </label>
            <input
              id="delete-confirm-email"
              name="confirmation"
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={user.email}
              autoComplete="off"
              disabled={busy}
              required
            />
            {confirmation.length > 0 && (
              <small className={`confirm-match-hint ${isConfirmationMatched ? "is-matched" : ""}`}>
                {isConfirmationMatched ? "✓ Confirmation matches" : "Does not match yet"}
              </small>
            )}
          </div>

          {error && (
            <div className="form-error delete-error-banner" role="alert">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="modal-footer delete-modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Keep my account
            </button>
            <button
              type="submit"
              className="button danger delete-confirm-btn"
              disabled={!isFormValid || busy}
            >
              {busy ? (
                <>
                  <Spinner size={14} />
                  <span>Deleting account…</span>
                </>
              ) : (
                <>
                  <Trash2 size={15} />
                  <span>Permanently delete account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
