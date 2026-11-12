"use client";
import { regionalTimezone, regionalTime } from "@/lib/personalization";
import { parseCustomLocalToUtc, formatUtcToCustomLocal } from "@/lib/timezone";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Calendar, CalendarCheck2, CalendarClock, CalendarOff, Check, ChevronDown, Clock3, ExternalLink, Loader2, Lock, RefreshCw ,ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { dateKey, formatDate, timeAgo } from "@/lib/types";
import { Modal } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* types + hook                                                        */
/* ------------------------------------------------------------------ */

export interface GoogleCalendarInfo { calendarId: string; summary: string; backgroundColor: string | null; primary: boolean; selected: boolean; visible: boolean; lastError: string | null }
export interface GoogleEventInfo {
  id: string; calendarId: string; googleEventId: string; title: string; description: string; location: string;
  startAt: string | null; endAt: string | null; startDate: string | null; endDate: string | null;
  allDay: boolean; status: string; htmlLink: string | null; organizer: string | null; attendees: number;
  timezone: string | null; localDirty: boolean; taskId: string | null; summary: string | null; color: string | null;
}
export interface SyncDetail { message?: string; conflicts?: { eventId: string; title: string; taskId: string | null; reason: string }[]; calendars?: { summary: string; added: number; updated: number; removed: number; error?: string }[] }

export interface GoogleStatus {
  connected: boolean; needsReauth?: boolean;
  account?: { email: string; name: string; picture: string | null };
  scopes?: string[]; writeEnabled?: boolean; canWrite?: boolean;
  calendars?: GoogleCalendarInfo[];
  lastSync?: { at: string | null; status: string; detail: SyncDetail | null };
  connectionError?: string | null;
  notConfigured?: boolean; redirectUri?: string; error?: string; hint?: string;
}

export function useGoogleIntegration() {
  const [status, setStatus] = useState<GoogleStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [events, setEvents] = useState<GoogleEventInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/google", { cache: "no-store" });
      const data = (await response.json()) as GoogleStatus;
      setStatus(data);
      return data;
    } catch {
      setStatus({ connected: false, error: "Couldn’t check your Google Calendar connection." });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadEvents = useCallback(async (from: string, to: string) => {
    try {
      const response = await fetch(`/api/integrations/google/events?from=${from}&to=${to}`, { cache: "no-store" });
      const data = (await response.json()) as { connected?: boolean; events?: GoogleEventInfo[] };
      setEvents(data.events ?? []);
      return data.events ?? [];
    } catch {
      setEvents([]);
      return [];
    }
  }, []);

  const sync = useCallback(async (full = false) => {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/google/sync${full ? "?full=1" : ""}`, { method: "POST" });
      const data = (await response.json()) as { summary?: SyncDetail & { status: string; added: number; updated: number; removed: number; syncedAt: string }; error?: string; needsReauth?: boolean };
      if (!response.ok) { setMessage({ tone: "error", text: data.error ?? "Google Calendar sync failed." }); await refresh(); return null; }
      setMessage({ tone: data.summary?.status === "ok" ? "success" : "info", text: data.summary?.message ?? "Sync finished." });
      await refresh();
      return data.summary ?? null;
    } catch {
      setMessage({ tone: "error", text: "Couldn’t reach Google Calendar. Check your connection and try again." });
      return null;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const updateCalendar = useCallback(async (calendarId: string, visible: boolean) => {
    const response = await fetch("/api/integrations/google/calendars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calendarId, visible }) });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) { setMessage({ tone: "error", text: data.error ?? "Couldn’t update that calendar." }); return false; }
    setStatus((current) => ({ ...current, calendars: current.calendars?.map((calendar) => calendar.calendarId === calendarId ? { ...calendar, visible, selected: visible } : calendar) }));
    return true;
  }, []);

  const setWriteEnabled = useCallback(async (writeEnabled: boolean) => {
    const response = await fetch("/api/integrations/google/calendars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ writeEnabled }) });
    const data = (await response.json()) as { error?: string; upgradeRequired?: boolean };
    if (!response.ok) { setMessage({ tone: "error", text: data.error ?? "Couldn’t change event access." }); return { ok: false, upgradeRequired: data.upgradeRequired }; }
    setStatus((current) => ({ ...current, writeEnabled, canWrite: writeEnabled }));
    setMessage({ tone: "success", text: writeEnabled ? "Folio can now create and edit Google Calendar events." : "Google Calendar is read-only again." });
    return { ok: true, upgradeRequired: false };
  }, []);

  const disconnect = useCallback(async () => {
    const response = await fetch("/api/integrations/google", { method: "DELETE" });
    if (!response.ok) { setMessage({ tone: "error", text: "Couldn’t disconnect Google Calendar. Please try again." }); return false; }
    setStatus({ connected: false });
    setEvents([]);
    setMessage({ tone: "info", text: "Google Calendar disconnected. Your Folio tasks and projects are untouched, and nothing was deleted in Google Calendar." });
    return true;
  }, []);

  return { status, loading, syncing, message, setMessage, events, refresh, loadEvents, sync, updateCalendar, setWriteEnabled, disconnect };
}

export function connectUrl(write: boolean, upgrade = false) {
  return `/api/integrations/google/connect?${new URLSearchParams({ ...(write ? { write: "1" } : {}), ...(upgrade ? { upgrade: "1" } : {}) })}`;
}

/* ------------------------------------------------------------------ */
/* connection card (Settings → Integrations, and the Calendar page)    */
/* ------------------------------------------------------------------ */

export function GoogleCalendarCard({ integration, compact = false }: { integration: ReturnType<typeof useGoogleIntegration>; compact?: boolean }) {
  const { status, loading, syncing, message, setMessage, sync, updateCalendar, setWriteEnabled, disconnect, refresh } = integration;
  const [panel, setPanel] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const calendars = status.calendars ?? [];
  const readScopes = (status.scopes ?? []).filter((scope) => scope.includes("calendar"));
  const conflicts = status.lastSync?.detail?.conflicts ?? [];

  if (loading) {
    return <div className="gcal-card is-loading" role="status" aria-label="Checking your Google Calendar connection"><span className="pj-sk" style={{ height: 44 }} /><span className="pj-sk" style={{ height: 20, width: "60%" }} /></div>;
  }

  // Not configured on this server: be honest about it and show what's needed.
  if (status.notConfigured) {
    return (
      <div className="gcal-card">
        <header><GoogleLogo /><div><h3>Google Calendar</h3><p>Not configured on this server</p></div></header>
        <p className="gcal-note">To enable this integration, add a Google OAuth client and set the environment variables below, then register the redirect URI in Google Cloud Console.</p>
        <code className="gcal-code">GOOGLE_CLIENT_ID=…<br />GOOGLE_CLIENT_SECRET=…</code>
        {status.redirectUri && <><span className="gcal-label">Redirect URI</span><code className="gcal-code">{status.redirectUri}</code></>}
      </div>
    );
  }

  return (
    <div className={`gcal-card ${compact ? "is-compact" : ""}`}>
      <header>
        <GoogleLogo />
        <div>
          <h3>Google Calendar</h3>
          {status.connected ? (
            <p className="gcal-account">
              <span className="gcal-dot is-on" aria-hidden="true" />
              {status.account?.email}
              {status.needsReauth && <span className="gcal-flag">Re-authentication needed</span>}
            </p>
          ) : <p className="gcal-account"><span className="gcal-dot" aria-hidden="true" />Not connected</p>}
        </div>
        {status.connected && <span className={`gcal-badge ${status.needsReauth ? "is-warn" : "is-ok"}`}>{status.needsReauth ? "Action needed" : "Connected"}</span>}
      </header>

      {status.needsReauth && (
        <div className="gcal-alert" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <div><strong>Access needs renewing.</strong><span>{status.connectionError ?? "Google revoked access or the permission expired."}</span></div>
          <a className="pj-btn is-primary is-sm" href={connectUrl(Boolean(status.writeEnabled), true)}>Reconnect</a>
        </div>
      )}

      {message && (
        <div className={`gcal-note is-${message.tone}`} role="status">
          {message.tone === "success" ? <Check size={14} aria-hidden="true" /> : message.tone === "error" ? <AlertTriangle size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          <span>{message.text}</span>
          <button type="button" className="gcal-dismiss" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={13} aria-hidden="true" /></button>
        </div>
      )}

      {!status.connected ? (
        <>
          <p className="gcal-note">Bring your Google schedule into Folio so tasks, deadlines and calendar events live in one place. Folio asks for <strong>read-only</strong> access first; event creation is a separate, optional permission.</p>
          <ul className="gcal-perms">
            <li><ShieldCheck size={14} aria-hidden="true" /><span><strong>See your calendars and events</strong> — read-only, so Folio can display them.</span></li>
            <li><Lock size={14} aria-hidden="true" /><span><strong>Create and edit events</strong> — only if you turn it on later, and only for events you choose.</span></li>
          </ul>
          <div className="gcal-actions">
            <a className="pj-btn is-primary" href={connectUrl(false)}><Calendar size={15} aria-hidden="true" />Connect Google Calendar</a>
          </div>
        </>
      ) : (
        <>
          <dl className="gcal-facts">
            <div><dt><CalendarClock size={13} aria-hidden="true" />Last sync</dt><dd>{status.lastSync?.at ? <>{timeAgo(status.lastSync.at)} <em className="gcal-sync-status is-{status.lastSync.status}">{status.lastSync.status}</em></> : "Never"}</dd></div>
            <div><dt><Calendar size={13} aria-hidden="true" />Calendars</dt><dd>{calendars.filter((calendar) => calendar.visible).length} shown of {calendars.length}</dd></div>
            <div><dt><Lock size={13} aria-hidden="true" />Event access</dt><dd>{status.canWrite ? "Read and write" : "Read only"}</dd></div>
          </dl>

          {conflicts.length > 0 && (
            <div className="gcal-conflicts" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <strong>{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} detected</strong>
                <span>{conflicts[0].reason} Folio kept Google’s version. Re-push a Folio task to update the event.</span>
              </div>
            </div>
          )}

          <div className="gcal-actions">
            <button type="button" className="pj-btn is-secondary" disabled={syncing} onClick={() => { void sync(false); }}>
              {syncing ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}{syncing ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="pj-btn is-ghost" aria-expanded={panel} onClick={() => setPanel(!panel)}><ChevronDown size={15} aria-hidden="true" className={panel ? "is-open" : ""} />Manage connection</button>
          </div>
          {syncing && <p className="gcal-progress" role="status" aria-live="polite"><Loader2 size={13} className="spin" aria-hidden="true" />Reading changes from Google Calendar…</p>}

          {panel && (
            <div className="gcal-panel">
              <section>
                <h4><Calendar size={14} aria-hidden="true" />Calendars</h4>
                <p className="gcal-hint">Choose which calendars appear in Folio and get synced.</p>
                {calendars.length ? (
                  <ul className="gcal-calendars">
                    {calendars.map((calendar) => (
                      <li key={calendar.calendarId}>
                        <i className="gcal-swatch" style={{ background: calendar.backgroundColor ?? "var(--accent)" }} aria-hidden="true" />
                        <span>{calendar.summary}{calendar.primary && <em> · default</em>}</span>
                        <label className="gcal-switch">
                          <input type="checkbox" checked={calendar.visible} disabled={busy} onChange={(event) => { void updateCalendar(calendar.calendarId, event.target.checked).then((ok) => { if (ok) void sync(false); }).catch(() => setMessage({ tone: "error", text: "Couldn’t reach Google Calendar. Check your connection and try again." })); }} />
                          <span className="pe-switch" aria-hidden="true" />
                          <span className="sr-only">Show {calendar.summary} in Folio</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <p className="gcal-hint">No calendars yet — run a sync to load them.</p>}
                <button type="button" className="pj-link" onClick={() => { void fetch("/api/integrations/google/calendars", { method: "POST" }).then(() => refresh()).catch(() => setMessage({ tone: "error", text: "Couldn’t refresh your calendar list right now." })); }}><RefreshCw size={13} aria-hidden="true" />Refresh calendar list</button>
              </section>

              <section>
                <h4><CalendarCheck2 size={14} aria-hidden="true" />Event access</h4>
                <label className="gcal-toggle">
                  <input type="checkbox" checked={Boolean(status.canWrite)} onChange={(event) => { void (async () => { try { const result = await setWriteEnabled(event.target.checked); if (result.upgradeRequired) window.location.href = connectUrl(true, true); } catch { setMessage({ tone: "error", text: "Couldn’t reach Google Calendar. Check your connection and try again." }); void refresh(); } })(); }} />
                  <span className="pe-switch" aria-hidden="true" />
                  <span><strong>Let Folio create and edit events</strong><small>Requests Google’s event-write permission. Folio never creates events automatically — you pick which tasks become events.</small></span>
                </label>
                <p className="gcal-hint">Granted scopes: {readScopes.length ? readScopes.map((scope) => scope.replace("https://www.googleapis.com/auth/", "")).join(", ") : "none"}.</p>
              </section>

              <section>
                <h4><Trash2 size={14} aria-hidden="true" />Disconnect</h4>
                <p className="gcal-hint">Stops syncing and deletes Folio’s stored Google credentials and event copy. Nothing is deleted in Google Calendar, and your Folio tasks stay as they are.</p>
                {!confirmDisconnect ? (
                  <button type="button" className="pj-btn is-danger-ghost is-sm" onClick={() => setConfirmDisconnect(true)}><CalendarOff size={14} aria-hidden="true" />Disconnect Google Calendar</button>
                ) : (
                  <div className="gcal-confirm">
                    <span>Also revoke Folio’s access at Google, so it can’t reconnect without you?</span>
                    <button type="button" className="pj-btn is-secondary is-sm" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
                    <button type="button" className="pj-btn is-danger is-sm" disabled={busy} onClick={() => { setBusy(true); void disconnect().then(() => { setBusy(false); setConfirmDisconnect(false); void refresh(); }).catch(() => { setBusy(false); setMessage({ tone: "error", text: "Couldn’t disconnect right now. Check your connection and try again." }); }); }}>Disconnect</button>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function GoogleLogo() {
  return (
    <span className="gcal-logo" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 48 48">
        <rect x="4" y="4" width="40" height="40" rx="7" fill="#fff" />
        <path fill="#1a73e8" d="M34 15H14v18h20z" opacity=".04" />
        <path fill="#4285f4" d="M34 34H14V15l-6 6v19h20z" opacity="0" />
        <path fill="#1967d2" d="M8 14a6 6 0 0 1 6-6h20v7H8z" />
        <path fill="#4285f4" d="M8 14h32v20a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" opacity=".12" />
        <path fill="#1a73e8" d="M8 14h7v27H14a6 6 0 0 1-6-6z" opacity=".85" />
        <path fill="#188038" d="M33 41h1a6 6 0 0 0 6-6v-7h-7z" />
        <path fill="#fbbc04" d="M40 14v-1a5 5 0 0 0-5-5h-2v7z" />
        <path fill="#ea4335" d="M14 8h5v7h-7v-2a5 5 0 0 1 2-5" opacity=".9" />
        <path fill="#fff" d="M17 19h14v3.2H17zm0 6.4h14v3.2H17zm0 6.4h9V35H17z" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* event dialog: create or edit a real Google Calendar event           */
/* ------------------------------------------------------------------ */

export interface EventDialogState { mode: "create" | "edit"; event?: GoogleEventInfo; taskId?: string; defaults?: { title?: string; description?: string; date?: string; allDay?: boolean } }

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  return formatUtcToCustomLocal(new Date(iso), regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function addMinutes(value: string, minutes: number) {
  if (!value) return "";
  const date = parseCustomLocalToUtc(value, regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone);
  return date ? toLocalInput(new Date(date.getTime() + minutes * 60_000).toISOString()) : "";
}

function dayPlus(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function GoogleEventDialog({ state, integration, onClose }: { state: EventDialogState; integration: ReturnType<typeof useGoogleIntegration>; onClose: () => void }) {
  const { status } = integration;
  const calendars = useMemo(() => (status.calendars ?? []).filter((calendar) => calendar.visible), [status.calendars]);
  const editing = state.mode === "edit" ? state.event : undefined;
  const defaultDate = state.defaults?.date ?? dateKey();
  const [title, setTitle] = useState(editing?.title ?? state.defaults?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? state.defaults?.description ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [calendarId, setCalendarId] = useState(editing?.calendarId ?? calendars.find((calendar) => calendar.primary)?.calendarId ?? calendars[0]?.calendarId ?? "primary");
  const [allDay, setAllDay] = useState(editing?.allDay ?? state.defaults?.allDay ?? false);
  const [start, setStart] = useState(editing ? toLocalInput(editing.startAt) : `${defaultDate}T09:00`);
  const [end, setEnd] = useState(editing ? toLocalInput(editing.endAt) : addMinutes(`${defaultDate}T09:00`, 60));
  const [dayStart, setDayStart] = useState(editing?.startDate ?? defaultDate);
  const [dayEnd, setDayEnd] = useState(editing?.endDate ?? dayPlus(defaultDate, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const canWrite = Boolean(status.canWrite) && !status.needsReauth;

  useEffect(() => {
    if (!allDay && !editing) setEnd(addMinutes(start, 60));
  }, [start, allDay, editing]);

  const duration = useMemo(() => {
    if (!start || !end) return 60;
    return Math.max(5, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  }, [start, end]);

  function setDuration(minutes: number) {
    setEnd(addMinutes(start, minutes));
  }

  async function submit() {
    setError("");
    if (!title.trim()) { setError("Give the event a title."); return; }
    setBusy(true);
    const payload = allDay
      ? { title: title.trim(), description, location, calendarId, allDay: true, start: dayStart, end: dayEnd }
      : { title: title.trim(), description, location, calendarId, allDay: false, start: (parseCustomLocalToUtc(start, regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone) || new Date(start)).toISOString(), end: (parseCustomLocalToUtc(end, regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone) || new Date(end)).toISOString(), timeZone: regionalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone };
    try {
      if (editing) {
        const response = await fetch(`/api/integrations/google/events/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Google Calendar couldn’t update that event.");
      } else {
        const response = await fetch("/api/integrations/google/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, taskId: state.taskId ?? null }) });
        const data = (await response.json()) as { error?: string; upgradeRequired?: boolean };
        if (!response.ok) throw new Error(data.error ?? "Google Calendar couldn’t create that event.");
      }
      setDone(true);
      await integration.sync(false).catch(() => null);
      window.setTimeout(onClose, 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/integrations/google/events/${editing.id}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Google Calendar couldn’t delete that event.");
      setDone(true);
      await integration.sync(false).catch(() => null);
      window.setTimeout(onClose, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const readOnlyView = Boolean(editing && !canWrite);

  return (
    <Modal title={editing ? (canWrite ? "Edit Google Calendar event" : "Google Calendar event") : "New Google Calendar event"} subtitle={editing ? (editing.summary || editing.calendarId) : "Created in your Google Calendar and shown in Folio."} onClose={() => { if (!busy) onClose(); }} className="editor-modal pe-modal gcal-dialog">
      <form className="editor-form pe-form" onSubmit={(event) => { event.preventDefault(); if (canWrite) void submit(); }} noValidate onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canWrite) { event.preventDefault(); void submit(); } }}>
        <fieldset className="pe-fields" disabled={busy || done || readOnlyView}>
          {!canWrite && (
            <div className="gcal-alert is-inline" role="status">
              <Lock size={15} aria-hidden="true" />
              <div><strong>{editing ? "Read-only Google Calendar view." : "Folio can’t write events yet."}</strong><span>Turn on event access in Settings → Integrations to edit or create events from Folio.</span></div>
            </div>
          )}
          <div className="pe-field">
            <label htmlFor="gcal-title">Title <b aria-hidden="true">*</b></label>
            <input id="gcal-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder="Team sync, dentist, review…" required />
          </div>
          <div className="pe-field">
            <label htmlFor="gcal-desc">Description <em>Optional</em></label>
            <textarea id="gcal-desc" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={8000} placeholder="Agenda, links, notes…" />
          </div>
          <div className="pe-field">
            <label htmlFor="gcal-location">Location <em>Optional</em></label>
            <input id="gcal-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={500} placeholder="Meeting room or video link" />
          </div>
          <div className="pe-field">
            <span className="pe-label" id="gcal-when">When</span>
            <div className="gcal-when">
              <label className="gcal-allday"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /><span className="pe-switch" aria-hidden="true" />All day</label>
              {allDay ? (
                <div className="gcal-dates">
                  <label>Starts<input type="date" value={dayStart} onChange={(event) => { setDayStart(event.target.value); if (dayEnd <= event.target.value) setDayEnd(dayPlus(event.target.value, 1)); }} aria-label="Event start date" /></label>
                  <label>Ends<input type="date" value={dayEnd} min={dayStart} onChange={(event) => setDayEnd(event.target.value)} aria-label="Event end date" /></label>
                </div>
              ) : (
                <div className="gcal-dates">
                  <label>Starts<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} aria-label="Event start" /></label>
                  <label>Ends<input type="datetime-local" value={end} min={start} onChange={(event) => setEnd(event.target.value)} aria-label="Event end" /></label>
                </div>
              )}
              {!allDay && (
                <div className="tk-quick-dates" role="group" aria-label="Event duration">
                  {DURATIONS.map((minutes) => <button key={minutes} type="button" aria-pressed={duration === minutes} className={duration === minutes ? "is-on" : ""} onClick={() => setDuration(minutes)}>{minutes < 60 ? `${minutes}m` : `${Math.round((minutes / 60) * 10) / 10}h`}</button>)}
                </div>
              )}
            </div>
          </div>
          <div className="pe-field">
            <label htmlFor="gcal-calendar">Calendar</label>
            <select id="gcal-calendar" value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={calendars.length <= 1}>
              {calendars.length ? calendars.map((calendar) => <option key={calendar.calendarId} value={calendar.calendarId}>{calendar.summary}</option>) : <option value="primary">Primary</option>}
            </select>
            <span className="pe-hint"><Clock3 size={12} aria-hidden="true" />{allDay ? "All-day events have no start time." : `Duration: ${duration < 60 ? `${duration} minutes` : `${Math.floor(duration / 60)}h ${duration % 60 ? `${duration % 60}m` : ""}`}`}</span>
          </div>
        </fieldset>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-footer pe-footer">
          {editing && canWrite && <button type="button" className="pj-btn is-danger-ghost" disabled={busy || done} onClick={() => { void remove(); }}><Trash2 size={15} aria-hidden="true" />Delete event</button>}
          <div className="footer-spacer" />
          <button type="button" className="pj-btn is-secondary" onClick={onClose} disabled={busy}>{readOnlyView ? "Close" : "Cancel"}</button>
          {editing?.htmlLink && <a className="pj-btn is-ghost" href={editing.htmlLink} target="_blank" rel="noreferrer">Open in Google<ExternalLink size={14} aria-hidden="true" /></a>}
          {!readOnlyView && (
            <button type="submit" className={`pj-btn is-primary pe-submit ${done ? "is-success" : ""}`} disabled={busy || done || !canWrite}>
              {busy ? <><Loader2 size={15} className="spin" aria-hidden="true" />Saving…</> : done ? <><Check size={15} aria-hidden="true" />Saved</> : editing ? "Save event" : "Create event"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Small inline helper for "add this task to Google Calendar" from a task. */
export function TaskToCalendarButton({ task, integration, className = "pj-btn is-ghost is-sm" }: { task: { id: string; title: string; description: string; dueDate: string | null; completed: boolean }; integration: ReturnType<typeof useGoogleIntegration>; className?: string }) {
  const linked = integration.events.find((event) => event.taskId === task.id);
  const [open, setOpen] = useState(false);
  const canWrite = Boolean(integration.status.canWrite) && integration.status.connected && !integration.status.needsReauth;
  if (!integration.status.connected) return null;
  if (linked) {
    return (
      <a className={className} href={linked.htmlLink ?? `https://calendar.google.com/calendar/r/eventedit/${linked.googleEventId}`} target="_blank" rel="noreferrer">
        <ExternalLink size={14} aria-hidden="true" />Open in Google Calendar
      </a>
    );
  }
  return (
    <>
      <button type="button" className={className} disabled={!canWrite} title={canWrite ? "Create a Google Calendar event from this task" : "Turn on event access in Settings → Integrations"} onClick={() => setOpen(true)}>
        <CalendarPlusIcon />Add to Google Calendar
      </button>
      {open && (
        <GoogleEventDialog
          state={{ mode: "create", taskId: task.id, defaults: { title: task.title, description: task.description, date: task.dueDate ?? dateKey(), allDay: true } }}
          integration={integration}
          onClose={() => { setOpen(false); void integration.loadEvents(dateKey(new Date(Date.now() - 60 * 86_400_000)), dateKey(new Date(Date.now() + 400 * 86_400_000))); }}
        />
      )}
    </>
  );
}

function CalendarPlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4" /></svg>;
}

export function formatEventRange(event: GoogleEventInfo) {
  if (event.allDay) {
    const start = event.startDate ?? "";
    const end = event.endDate ?? "";
    if (!start) return "All day";
    if (end && end !== start) return `${formatDate(start)} – ${formatDate(new Date(`${end}T12:00:00`).getTime() - 86_400_000 ? new Date(new Date(`${end}T12:00:00`).getTime() - 86_400_000).toISOString().slice(0, 10) : end)}`;
    return `${formatDate(start)} · All day`;
  }
  const start = event.startAt ? new Date(event.startAt) : null;
  const end = event.endAt ? new Date(event.endAt) : null;
  if (!start) return "";
  const time = (date: Date) => regionalTime(date);
  if (end && end.toDateString() === start.toDateString()) return `${formatDate(dateKey(start))} · ${time(start)} – ${time(end ?? start)}`;
  return `${formatDate(dateKey(start))} · ${time(start)}`;
}

export { ArrowUpRight };
