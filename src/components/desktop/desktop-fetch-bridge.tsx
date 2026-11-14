"use client";

import { installDesktopFetchBridge } from "@/lib/desktop/fetch-bridge";

// Installed at MODULE scope: `__TAURI_INTERNALS__` exists before any app
// script runs, so the bridge wraps `window.fetch` before every component
// effect — including the first workspace load. A component effect would
// race sibling effects that fetch on mount.
installDesktopFetchBridge();

/**
 * Renders nothing. Its only job is to be imported by the root layout so the
 * module-scope install above executes in the desktop shell (and nowhere
 * else — the install is a no-op on the web runtime).
 */
export function DesktopFetchBridge() {
  return null;
}
