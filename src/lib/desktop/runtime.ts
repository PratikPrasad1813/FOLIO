/**
 * Hydration-safe Tauri desktop runtime detection.
 *
 * Next.js server-renders client components, so any Tauri probe must happen
 * after mount. Every function here is safe to call during render (it only
 * reads flags that are identical on the server and on the first client
 * render), while the actual probe result is only trusted from inside
 * effects or event handlers — never during render.
 */

let desktopRuntime: boolean | null = null;

function probeDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  // The Tauri v2 webview injects this global before any app JS runs. Probing
  // it directly (instead of importing isTauri()) keeps this module free of
  // Tauri API access during server rendering.
  return Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/**
 * True when running inside the Folio Tauri desktop shell. The probe result is
 * memoised on first call, which by construction happens after mount in every
 * legitimate call site (effects, promise callbacks, event handlers).
 */
export function isDesktopRuntime(): boolean {
  if (desktopRuntime === null) desktopRuntime = probeDesktopRuntime();
  return desktopRuntime;
}

/**
 * Render-time hint only: whether the desktop probe has already resolved.
 * Components use this to keep the server and first client render identical.
 */
export function desktopRuntimeKnown(): boolean {
  return desktopRuntime !== null;
}

/** Reset the memoised probe (used by tests and hot module reloads). */
export function resetDesktopRuntimeProbe(): void {
  desktopRuntime = null;
}
