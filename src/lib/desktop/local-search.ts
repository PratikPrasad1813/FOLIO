/**
 * Offline / desktop global search & local search history.
 *
 * Pure workspace search logic mirroring `src/lib/search-service.ts` so the
 * Tauri desktop shell searches its local SQLite workspace snapshot in 0ms
 * with zero network requests (online or offline).
 */

import type {
  RecentSearch,
  SearchGroup,
  SearchKind,
  SearchResponse,
  SearchResult,
  SearchScope,
} from "../search-types";
import type { Item, WorkspaceData } from "../types";

const RECENT_STORAGE_KEY = "folio.desktop.recentSearches";
const MAX_RECENT_SEARCHES = 20;

export function buildSearchSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.replace(/^#/, ""))
    .filter(Boolean);
  const found = words
    .map((word) => flat.toLowerCase().indexOf(word))
    .filter((index) => index >= 0);
  const start = found.length ? Math.max(0, Math.min(...found) - 35) : 0;
  return `${start ? "…" : ""}${flat.slice(start, start + 160)}${flat.length > start + 160 ? "…" : ""}`;
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function matchesTokens(tokens: string[], documentText: string): boolean {
  if (!tokens.length) return false;
  const haystack = documentText.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function rankTitle(title: string, query: string, documentText: string): number {
  const lowerTitle = title.trim().toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  let score = 0;
  if (lowerTitle === lowerQuery) score += 100;
  else if (lowerTitle.startsWith(lowerQuery)) score += 60;
  else if (lowerTitle.includes(lowerQuery)) score += 30;

  const tokens = tokenizeQuery(query);
  const lowerDoc = documentText.toLowerCase();
  for (const token of tokens) {
    if (lowerTitle.includes(token)) score += 4;
    else if (lowerDoc.includes(token)) score += 1;
  }
  return score;
}

export function searchLocalWorkspace(
  data: WorkspaceData,
  rawQuery: string,
  scope: SearchScope = "all",
  limit = 8,
): SearchResponse {
  const query = rawQuery.trim();
  if (!query) return { query: "", groups: [] };

  const tokens = tokenizeQuery(query);
  if (!tokens.length) return { query, groups: [] };

  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const kinds: SearchKind[] = scope === "all" ? ["projects", "tasks", "ideas"] : [scope];
  const cappedLimit = Math.max(1, Math.min(50, limit));

  const groups: SearchGroup[] = kinds.map((kind) => {
    if (kind === "projects") {
      const matched = data.projects
        .map((p) => {
          const doc = `${p.name} ${p.description} ${p.category}`;
          return { p, doc, ok: matchesTokens(tokens, doc) };
        })
        .filter((entry) => entry.ok)
        .sort((a, b) => {
          const scoreDiff =
            rankTitle(b.p.name, query, b.doc) - rankTitle(a.p.name, query, a.doc);
          if (scoreDiff !== 0) return scoreDiff;
          const timeDiff = Date.parse(b.p.updatedAt || b.p.createdAt) - Date.parse(a.p.updatedAt || a.p.createdAt);
          if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
          return a.p.id.localeCompare(b.p.id);
        });

      const items: SearchResult[] = matched.slice(0, cappedLimit).map(({ p }) => ({
        id: p.id,
        kind: "projects",
        title: p.name,
        description: buildSearchSnippet(p.description || p.category, query),
        status: p.status,
        priority: p.priority,
        projectId: null,
        projectName: null,
        color: p.color,
        icon: p.icon,
        archived: p.archived,
        labels: [],
      }));
      return { kind, items, hasMore: matched.length > cappedLimit };
    }

    if (kind === "tasks") {
      const matched = data.tasks
        .map((t) => {
          const parent = t.projectId ? projectById.get(t.projectId) ?? null : null;
          const labelDoc = t.labels.map((l) => `#${l} ${l}`).join(" ");
          const doc = `${t.title} ${t.description} ${t.notes} ${parent?.name ?? ""} ${labelDoc}`;
          return { t, parent, doc, ok: matchesTokens(tokens, doc) };
        })
        .filter((entry) => entry.ok)
        .sort((a, b) => {
          const scoreDiff =
            rankTitle(b.t.title, query, b.doc) - rankTitle(a.t.title, query, a.doc);
          if (scoreDiff !== 0) return scoreDiff;
          const timeDiff = Date.parse(b.t.updatedAt || b.t.createdAt) - Date.parse(a.t.updatedAt || a.t.createdAt);
          if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
          return a.t.id.localeCompare(b.t.id);
        });

      const items: SearchResult[] = matched.slice(0, cappedLimit).map(({ t, parent }) => ({
        id: t.id,
        kind: "tasks",
        title: t.title,
        description: buildSearchSnippet(
          [t.description, t.notes, ...t.labels.map((l) => `#${l}`)].filter(Boolean).join(" · "),
          query,
        ),
        status: t.status,
        priority: t.priority,
        projectId: t.projectId,
        projectName: parent?.name ?? null,
        color: parent?.color ?? "violet",
        icon: "task",
        archived: false,
        labels: t.labels,
      }));
      return { kind, items, hasMore: matched.length > cappedLimit };
    }

    const matched = data.ideas
      .map((idea) => {
        const doc = `${idea.title} ${idea.description} ${idea.category}`;
        return { idea, doc, ok: matchesTokens(tokens, doc) };
      })
      .filter((entry) => entry.ok)
      .sort((a, b) => {
        const scoreDiff =
          rankTitle(b.idea.title, query, b.doc) - rankTitle(a.idea.title, query, b.doc);
        if (scoreDiff !== 0) return scoreDiff;
        const timeDiff = Date.parse(b.idea.createdAt) - Date.parse(a.idea.createdAt);
        if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
        return a.idea.id.localeCompare(b.idea.id);
      });

    const items: SearchResult[] = matched.slice(0, cappedLimit).map(({ idea }) => ({
      id: idea.id,
      kind: "ideas",
      title: idea.title,
      description: buildSearchSnippet(idea.description || idea.category, query),
      status: idea.status,
      priority: null,
      projectId: null,
      projectName: null,
      color: idea.color,
      icon: "idea",
      archived: false,
      labels: [],
    }));
    return { kind, items, hasMore: matched.length > cappedLimit };
  });

  return { query, groups };
}

export function getLocalSearchItem(data: WorkspaceData, kind: SearchKind, id: string): Item | null {
  const list = data[kind] as Item[];
  return list.find((item) => item.id === id) ?? null;
}

export function loadLocalRecentSearches(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentSearch =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as RecentSearch).id === "string" &&
          typeof (entry as RecentSearch).query === "string" &&
          typeof (entry as RecentSearch).scope === "string",
      )
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveLocalRecentSearch(query: string, scope: SearchScope): RecentSearch[] {
  const cleaned = query.trim().replace(/\s+/g, " ");
  if (!cleaned || typeof window === "undefined") return loadLocalRecentSearches();
  const key = `${scope}:${cleaned.toLowerCase()}`;
  const current = loadLocalRecentSearches().filter(
    (entry) => `${entry.scope}:${entry.query.toLowerCase()}` !== key,
  );
  const nextEntry: RecentSearch = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `recent-${Date.now()}`,
    query: cleaned,
    scope,
    lastUsedAt: new Date().toISOString(),
  };
  const next = [nextEntry, ...current].slice(0, MAX_RECENT_SEARCHES);
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be read-only in restricted environments
  }
  return next;
}

export function deleteLocalRecentSearch(id?: string): RecentSearch[] {
  if (typeof window === "undefined") return [];
  const next = id ? loadLocalRecentSearches().filter((entry) => entry.id !== id) : [];
  try {
    if (next.length) window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
  return next;
}
