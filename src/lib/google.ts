import { createHash, randomBytes } from "node:crypto";
import { sealToken, openToken } from "@/lib/crypto";

/**
 * Google Calendar integration: OAuth 2.0 + Calendar API v3 over plain fetch.
 * No SDK dependency — the surface we need is small and this keeps the bundle lean.
 */

const API = `${tokenAudience()}/calendar/v3`;

/**
 * Google's endpoints. Overridable so a proxy, a sovereign-cloud deployment or a
 * test double can be substituted without code changes. Never set in production.
 */
function tokenAudience() {
  const base = process.env.GOOGLE_API_BASE_URL;
  return base ? base.replace(/\/$/, "") : "https://www.googleapis.com";
}
const AUTH_ENDPOINT = process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = process.env.GOOGLE_REVOKE_URL ?? "https://oauth2.googleapis.com/revoke";

/** Read-only: see every calendar the user can read. Requested on first connect. */
export const SCOPE_READ = "https://www.googleapis.com/auth/calendar.readonly";
/** Event write access, granted separately (incremental authorization) when the user opts in. */
export const SCOPE_WRITE = "https://www.googleapis.com/auth/calendar.events";
export const READ_SCOPES = [SCOPE_READ];
export const WRITE_SCOPES = [SCOPE_WRITE];

export interface GoogleConfig { clientId: string; clientSecret: string; configured: boolean }

export function googleConfig(): GoogleConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

/** Where Google must send the user back. Override with GOOGLE_REDIRECT_URI behind a proxy. */
export function redirectUri(request: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const origin = process.env.NEXT_PUBLIC_APP_URL || (forwardedHost ? `${forwardedProto ?? "https"}://${forwardedHost}` : new URL(request.url).origin);
  return `${origin.replace(/\/$/, "")}/api/integrations/google/callback`;
}

export function isWriteGranted(scopes: string[] | null | undefined): boolean {
  if (!scopes?.length) return false;
  return scopes.includes(SCOPE_WRITE) || scopes.includes("https://www.googleapis.com/auth/calendar");
}

export function authorizationUrl(options: { clientId: string; redirect: string; scopes: string[]; state: string; verifier: string; upgrade?: boolean }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirect,
    response_type: "code",
    scope: options.scopes.join(" "),
    // Offline access is what lets Folio sync in the background with a refresh token.
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: options.upgrade ? "consent" : "consent",
    state: options.state,
    code_challenge: pkceChallenge(options.verifier),
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

function pkceChallenge(verifier: string) {
  // RFC 7636 S256: BASE64URL(SHA256(verifier))
  return createHash("sha256").update(verifier).digest("base64url");
}

/** High-entropy PKCE verifier (RFC 7636 §4.1). */
export function newVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export class GoogleError extends Error {
  status: number;
  reason: string;
  /** True when the user revoked access or the refresh token is no longer valid. */
  needsReauth: boolean;
  constructor(message: string, status = 500, reason = "", needsReauth = false) {
    super(message);
    this.name = "GoogleError";
    this.status = status;
    this.reason = reason;
    this.needsReauth = needsReauth;
  }
}

interface TokenResponse { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string; id_token?: string; error?: string; error_description?: string }

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    const reason = data.error ?? "";
    const invalid = reason === "invalid_grant" || reason === "invalid_client";
    throw new GoogleError(data.error_description || data.error || "Google rejected the request.", response.status, reason, invalid);
  }
  return data;
}

export async function exchangeCode(options: { code: string; clientId: string; clientSecret: string; redirect: string; verifier: string }) {
  const body = new URLSearchParams({ code: options.code, client_id: options.clientId, client_secret: options.clientSecret, redirect_uri: options.redirect, grant_type: "authorization_code", code_verifier: options.verifier });
  const data = await tokenRequest(body);
  if (!data.access_token) throw new GoogleError("Google did not return an access token.", 502);
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresIn: data.expires_in ?? 3600, scopes: (data.scope ?? "").split(" ").filter(Boolean), idToken: data.id_token ?? null };
}

export async function refreshAccessToken(refreshToken: string, config: GoogleConfig): Promise<{ accessToken: string; expiresIn: number; scopes: string[] }> {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const data = await tokenRequest(body);
  if (!data.access_token) throw new GoogleError("Could not refresh the Google access token.", 502, "no_access_token", true);
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600, scopes: (data.scope ?? "").split(" ").filter(Boolean) };
}

/** Tells Google to forget the grant. Best-effort: Folio clears its own copy regardless. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(REVOKE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Decodes the JWT payload Google returns (no signature check needed — it came over TLS from Google's token endpoint). */
export function decodeIdToken(idToken: string | null): { sub?: string; email?: string; name?: string; picture?: string } {
  if (!idToken) return {};
  try {
    const payload = idToken.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; email?: string; name?: string; picture?: string };
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* authorised Calendar API client                                       */
/* ------------------------------------------------------------------ */

export interface AuthedClient { accessToken: string; fetchJson: <T>(path: string, init?: RequestInit) => Promise<T> }

export async function authorisedClient(args: { accessToken: string }): Promise<AuthedClient> {
  const auth = { Authorization: `Bearer ${args.accessToken}` };
  async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    } catch {
      throw new GoogleError("Couldn’t reach Google Calendar. Check your connection and try again.", 503, "network");
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const error = (data.error ?? {}) as { message?: string; errors?: { reason?: string }[] };
      const reason = error.errors?.[0]?.reason ?? "";
      const needsReauth = response.status === 401 || response.status === 403 && /insufficientPermissions|forbidden/i.test(reason);
      throw new GoogleError(error.message || `Google Calendar request failed (${response.status}).`, response.status, reason, needsReauth);
    }
    return data as T;
  }
  return { accessToken: args.accessToken, fetchJson };
}

/* --- wire types (only the fields Folio uses) --- */
export interface GoogleCalendarListItem {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  timeZone?: string;
}
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  etag?: string;
  recurringEventId?: string;
  creator?: { email?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string }[];
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}

export interface ListEventsPage { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }

export function listCalendars(client: AuthedClient) {
  return client.fetchJson<{ items: GoogleCalendarListItem[] }>("/users/me/calendarList?maxResults=250&showDeleted=false&showHidden=false");
}

export function listEvents(client: AuthedClient, options: { calendarId: string; syncToken?: string | null; timeMin?: string; timeMax?: string; pageToken?: string }) {
  const params = new URLSearchParams({ maxResults: "2500", singleEvents: "true", orderBy: "startTime", showDeleted: "true" });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  else if (options.syncToken) params.set("syncToken", options.syncToken);
  else if (options.timeMin) params.set("timeMin", options.timeMin);
  if (options.timeMax) params.set("timeMax", options.timeMax);
  const encoded = encodeURIComponent(options.calendarId);
  return client.fetchJson<ListEventsPage>(`/calendars/${encoded}/events?${params}`);
}

export interface EventDraft {
  summary: string;
  description?: string | null;
  location?: string | null;
  calendarId: string;
  start: string;      // RFC3339 for timed events, YYYY-MM-DD for all-day
  end: string;
  timeZone?: string | null;
  allDay: boolean;
}

export function createEvent(client: AuthedClient, draft: EventDraft) {
  const body = buildEventBody(draft);
  return client.fetchJson<GoogleEvent>(`/calendars/${encodeURIComponent(draft.calendarId)}/events?sendUpdates=none&conferenceDataVersion=0`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function updateEvent(client: AuthedClient, options: { calendarId: string; eventId: string } & Omit<EventDraft, "calendarId">) {
  const body = buildEventBody(options);
  return client.fetchJson<GoogleEvent>(`/calendars/${encodeURIComponent(options.calendarId)}/events/${encodeURIComponent(options.eventId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function deleteEvent(client: AuthedClient, options: { calendarId: string; eventId: string }) {
  await client.fetchJson<undefined>(`/calendars/${encodeURIComponent(options.calendarId)}/events/${encodeURIComponent(options.eventId)}?sendUpdates=none`, { method: "DELETE" });
}

function buildEventBody(draft: { summary: string; description?: string | null; location?: string | null; start: string; end: string; timeZone?: string | null; allDay: boolean }) {
  const start = draft.allDay ? { date: draft.start } : { dateTime: draft.start, timeZone: draft.timeZone ?? undefined };
  const end = draft.allDay ? { date: draft.end } : { dateTime: draft.end, timeZone: draft.timeZone ?? undefined };
  return { summary: draft.summary, description: draft.description || undefined, location: draft.location || undefined, start, end };
}

export { sealToken, openToken };
