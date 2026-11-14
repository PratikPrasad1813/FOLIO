"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { DEFAULT_PERSONAL, type ThemePreference } from "@/lib/personalization";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { getCachedProfile, markLocalProfilePending, setCachedProfile } from "@/lib/desktop/local-db";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "folio-theme";
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-preference"] });
  return () => observer.disconnect();
}
const snapshot = (): Theme => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
function paint(next: ThemePreference) {
  const resolved = next === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : next;
  const root = document.documentElement;
  root.dataset.theme = resolved; root.dataset.themePreference = next; root.style.colorScheme = resolved;
}
export function applyTheme(next: ThemePreference, persistAccount = true) {
  const root = document.documentElement;
  root.classList.add("theme-transition"); paint(next);
  setTimeout(() => root.classList.remove("theme-transition"), 300);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private storage */ }
  if (persistAccount && root.dataset.folioAccount) {
    if (isDesktopRuntime()) {
      void (async () => {
        await markLocalProfilePending({ personal: { theme: next } }).catch(() => {});
        const cached = await getCachedProfile().catch(() => null);
        if (cached) {
          await setCachedProfile({
            ...cached,
            personal: { ...DEFAULT_PERSONAL, ...(cached.personal ?? {}), theme: next },
          }).catch(() => {});
        }
      })();
      return;
    }
    void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personal: { theme: next } }) }).catch(() => {});
  }
}
export function ThemeRuntime() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => { if (document.documentElement.dataset.themePreference === "system") paint("system"); };
    const syncStorage = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY) paint(event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system"); };
    media.addEventListener("change", syncSystem); window.addEventListener("storage", syncStorage);
    return () => { media.removeEventListener("change", syncSystem); window.removeEventListener("storage", syncStorage); };
  }, []);
  return null;
}
export function useTheme() { return { theme: useSyncExternalStore(subscribe, snapshot, () => "light" as Theme), setTheme: applyTheme }; }
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button theme-toggle glass-theme-toggle"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      <span className="glass-theme-track" aria-hidden="true">
        <span className="glass-theme-symbol is-light"><Sun size={13} strokeWidth={1.8} /></span>
        <span className="glass-theme-symbol is-dark"><Moon size={12} strokeWidth={1.8} /></span>
        <span className="glass-theme-thumb">
          <span className="glass-theme-thumb-light"><Sun size={13} strokeWidth={1.8} /></span>
          <span className="glass-theme-thumb-dark"><Moon size={12} strokeWidth={1.8} /></span>
        </span>
      </span>
    </button>
  );
}
