"use client";

import { useCallback, useState } from "react";

type StorageKind = "local" | "session";
const store = (kind: StorageKind) => (kind === "local" ? window.localStorage : window.sessionStorage);

/** String UI preference that survives navigation (localStorage) or the session (sessionStorage). */
export function usePersistentState<T extends string>(key: string, fallback: T, storage: StorageKind, allowed?: readonly string[]) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = store(storage).getItem(key);
      if (raw !== null && (!allowed || allowed.includes(raw))) return raw as T;
    } catch { /* storage unavailable */ }
    return fallback;
  });
  const update = useCallback((next: T) => {
    setValue(next);
    try { store(storage).setItem(key, next); } catch { /* storage unavailable */ }
  }, [key, storage]);
  return [value, update] as const;
}

/** Structured preference (arrays, objects). `sanitize` validates whatever was stored. */
export function usePersistentJson<T>(key: string, fallback: T, storage: StorageKind, sanitize: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = store(storage).getItem(key);
      if (raw !== null) return sanitize(JSON.parse(raw));
    } catch { /* corrupted or unavailable */ }
    return fallback;
  });
  const update = useCallback((next: T) => {
    setValue(next);
    try { store(storage).setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key, storage]);
  return [value, update] as const;
}
