/**
 * Remote API origin resolution for the Folio desktop shell.
 *
 * The desktop webview loads the BUNDLED static frontend (`out/index.html`
 * served over the Tauri custom protocol), so it has no same-origin Next.js
 * server to call. Every network operation the desktop performs — sign-in,
 * the background sync engine, best-effort profile pushes — must therefore
 * target the DEPLOYED Folio API with an absolute URL.
 *
 * Resolution order (first match wins):
 *   1. `localStorage["folio.desktop.apiBase"]` — per-device override, e.g. for
 *      self-hosted or staging deployments (also usable from devtools).
 *   2. `NEXT_PUBLIC_FOLIO_API_URL` — baked in at desktop-bundle build time.
 *   3. The production deployment.
 *
 * On the web runtime this module returns "" so every existing relative
 * `fetch("/api/...")` call keeps behaving exactly as before.
 */

import { isDesktopRuntime } from "@/lib/desktop/runtime";

export const DEFAULT_DESKTOP_API_BASE = "https://folio-management-studio.onrender.com";

const API_BASE_STORAGE_KEY = "folio.desktop.apiBase";

/** Origin strings the desktop shell may be switched to, with scheme normalised. */
export function normaliseApiBase(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

let cachedBase: string | null = null;

/**
 * The absolute origin of the deployed Folio API for this desktop shell.
 * Returns "" outside the desktop runtime (the web app is same-origin).
 */
export function desktopApiBase(): string {
  if (!isDesktopRuntime()) return "";
  if (cachedBase !== null) return cachedBase;

  let resolved = "";
  try {
    const stored = window.localStorage.getItem(API_BASE_STORAGE_KEY);
    resolved = normaliseApiBase(stored ?? "") ?? "";
  } catch {
    // localStorage can be unavailable (privacy mode); fall through.
  }
  if (!resolved && typeof process.env.NEXT_PUBLIC_FOLIO_API_URL === "string") {
    resolved = normaliseApiBase(process.env.NEXT_PUBLIC_FOLIO_API_URL) ?? "";
  }
  if (!resolved && typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    resolved = window.location.origin;
  }
  cachedBase = resolved || DEFAULT_DESKTOP_API_BASE;
  return cachedBase;
}

/** Permanently override the API origin (Settings → advanced, or devtools). */
export function setDesktopApiBase(value: string): boolean {
  const normalised = normaliseApiBase(value);
  try {
    if (normalised) window.localStorage.setItem(API_BASE_STORAGE_KEY, normalised);
    else window.localStorage.removeItem(API_BASE_STORAGE_KEY);
  } catch {
    return false;
  }
  cachedBase = null;
  return true;
}

/**
 * Build an absolute URL for a desktop network call.
 *   desktopApiUrl("/api/sync/pull") → "https://host/api/sync/pull"  (desktop)
 *   desktopApiUrl("/api/sync/pull") → "/api/sync/pull"               (web)
 */
export function desktopApiUrl(path: string): string {
  const base = desktopApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
