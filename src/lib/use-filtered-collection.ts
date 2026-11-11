"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchRequest } from "@/lib/search-client";
import type { BrowseResponse, FilterConfig, FilterKind } from "@/lib/search-types";
import type { WorkspaceData } from "@/lib/types";
import { isDesktopRuntime } from "@/lib/desktop/runtime";
import { browseLocal } from "@/lib/desktop/local-browse";

/**
 * Bounded collection results for the Projects and Tasks views.
 *
 * Web: paged queries against /api/workspace/browse (independent of Folio's
 * legacy dashboard cache).
 *
 * Desktop shell: the same filter/sort/pagination contract is evaluated against
 * the local SQLite mirror (see local-browse.ts), so the views keep working —
 * with identical semantics — at 0ms latency and fully offline. This is the
 * fix for the previous mismatch where the overview counted N projects but the
 * list rendered "0 matching projects".
 */
export function useFilteredCollection<T extends { id: string }>(
  kind: FilterKind,
  config: FilterConfig,
  revision: unknown,
  pendingCount: number,
  localSource?: WorkspaceData | null,
) {
  const serialized = JSON.stringify(config);
  const key = `${kind}:${serialized}`;
  const [page, setPage] = useState<BrowseResponse<T> & { key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  const previousQuery = useRef("");
  // `config` is rebuilt every render by the views; `serialized` (its JSON) is
  // the semantic dependency. The ref lets the effect read the freshest
  // object whenever the serialized content actually changed.
  const configRef = useRef(config);
  configRef.current = config;
  // The local mode flag is only trusted inside effects (post-mount), never
  // during render, so SSR and the first client render stay identical.
  const localMode = Boolean(localSource) && isDesktopRuntime();

  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort();
    const current = ++generation.current;
    const delay = previousQuery.current !== config.q ? 220 : 0;
    previousQuery.current = config.q;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    // Wait for optimistic mutations to commit before querying their new state.
    if (pendingCount) return () => controller.abort();

    if (localMode && localSource) {
      const source = localSource;
      const timer = window.setTimeout(() => {
        try {
          const result = browseLocal<T>(kind, source, configRef.current, 0, 60);
          if (generation.current === current) setPage({ ...result, key });
        } catch (err) {
          if (generation.current === current) setError(err instanceof Error ? err.message : "Couldn’t load results.");
        } finally {
          if (generation.current === current) setLoading(false);
        }
      }, delay);
      return () => { controller.abort(); moreRequest.current?.abort(); window.clearTimeout(timer); };
    }

    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ kind, filters: serialized, limit: "60" });
      searchRequest<BrowseResponse<T>>(`/api/workspace/browse?${params}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted && generation.current === current) setPage({ ...result, key }); })
        .catch(err => { if (!controller.signal.aborted && generation.current === current) setError(err instanceof Error ? err.message : "Couldn’t load results."); })
        .finally(() => { if (!controller.signal.aborted && generation.current === current) setLoading(false); });
    }, delay);
    return () => { controller.abort(); moreRequest.current?.abort(); window.clearTimeout(timer); };
  }, [key, kind, serialized, config.q, revision, pendingCount, attempt, localMode, localSource]);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || page.key !== key || loading || loadingMore) return;
    if (localMode && localSource) {
      const current = generation.current;
      setLoadingMore(true);
      try {
        const result = browseLocal<T>(kind, localSource, configRef.current, page.items.length, 60);
        if (current === generation.current) {
          setPage(old => {
            if (!old || old.key !== key) return old;
            const known = new Set(old.items.map(i => i.id));
            return { ...result, key, items: [...old.items, ...result.items.filter(i => !known.has(i.id))] };
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t load more results.");
      } finally {
        if (current === generation.current) setLoadingMore(false);
      }
      return;
    }
    const current = generation.current;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ kind, filters: serialized, limit: "60", offset: String(page.items.length) });
      const result = await searchRequest<BrowseResponse<T>>(`/api/workspace/browse?${params}`, { signal: controller.signal });
      if (current !== generation.current || controller.signal.aborted) return;
      setPage(old => {
        if (!old || old.key !== key) return old;
        const known = new Set(old.items.map(i => i.id));
        return { ...result, key, items: [...old.items, ...result.items.filter(i => !known.has(i.id))] };
      });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t load more results.");
    } finally {
      if (current === generation.current && !controller.signal.aborted) setLoadingMore(false);
    }
  }, [page, key, kind, serialized, loading, loadingMore, localMode, localSource]);

  return { items: page?.items ?? [], total: page?.key === key ? page.total : 0, today: page?.today, hasMore: page?.key === key && page.hasMore, loading: loading || (page?.key !== key && !error), loadingMore, error, retry: () => setAttempt(a => a + 1), loadMore };
}
