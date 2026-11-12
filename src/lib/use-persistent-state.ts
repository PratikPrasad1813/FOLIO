"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type StorageKind = "local" | "session";
const store = (kind: StorageKind) => (kind === "local" ? window.localStorage : window.sessionStorage);

/**
 * Hydration-safe persisted UI preferences.
 *
 * THE CONTRACT (this is the class of bug the audit hunts):
 * the server render and the React hydration pass MUST produce identical
 * markup. Reading localStorage/sessionStorage inside a `useState` initializer
 * breaks that contract — the server always renders the fallback while the
 * client may have a stored value, so React aborts hydration with a mismatch
 * the moment a preference differs.
 *
 * These hooks therefore ALWAYS initialise with `fallback` and adopt the
 * stored value in a post-mount effect (`useEffect` never runs during
 * hydration). The one-frame flash of the default view is the standard,
 * correct trade-off — the same pattern next-themes uses.
 */

function readStored<T extends string>(key: string, storage: StorageKind, fallback: T, allowed?: readonly string[]): T {
  try {
    const raw = store(storage).getItem(key);
    if (raw !== null && (!allowed || allowed.includes(raw))) return raw as T;
  } catch { /* storage unavailable */ }
  return fallback;
}

/** String UI preference that survives navigation (localStorage) or the session (sessionStorage). */
export function usePersistentState<T extends string>(key: string, fallback: T, storage: StorageKind, allowed?: readonly string[]) {
  const [value, setValue] = useState<T>(fallback);
  // Stable dep for the inline `allowed` arrays most call sites pass in.
  const allowedKey = allowed ? allowed.join("\u0000") : "";

  useEffect(() => {
    // Post-mount only: adopt whatever was persisted for this key.
    setValue(readStored<T>(key, storage, fallback, allowedKey ? allowed : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `allowed` is captured through its stable serialisation.
  }, [key, storage, fallback, allowedKey]);

  const update = useCallback((next: T) => {
    setValue(next);
    try { store(storage).setItem(key, next); } catch { /* storage unavailable */ }
  }, [key, storage]);
  return [value, update] as const;
}

/** Structured preference (arrays, objects). `sanitize` validates whatever was stored. */
export function usePersistentJson<T>(key: string, fallback: T, storage: StorageKind, sanitize: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(fallback);
  // Keep the latest validators in refs so the adopt-effect runs once per key.
  const sanitizeRef = useRef(sanitize);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    sanitizeRef.current = sanitize;
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    try {
      const raw = store(storage).getItem(key);
      if (raw !== null) {
        setValue(sanitizeRef.current(JSON.parse(raw)));
        return;
      }
    } catch { /* corrupted or unavailable */ }
    setValue(fallbackRef.current);
  }, [key, storage]);

  const update = useCallback((next: T) => {
    setValue(next);
    try { store(storage).setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key, storage]);
  return [value, update] as const;
}
