"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchRequest } from "@/lib/search-client";
import type { BrowseResponse, FilterConfig, FilterKind } from "@/lib/search-types";

/** Bounded server results, independent of Folio's legacy dashboard cache. */
export function useFilteredCollection<T extends { id: string }>(kind: FilterKind, config: FilterConfig, revision: unknown, pendingCount: number) {
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
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ kind, filters: serialized, limit: "60" });
      searchRequest<BrowseResponse<T>>(`/api/workspace/browse?${params}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted && generation.current === current) setPage({ ...result, key }); })
        .catch(err => { if (!controller.signal.aborted && generation.current === current) setError(err instanceof Error ? err.message : "Couldn’t load results."); })
        .finally(() => { if (!controller.signal.aborted && generation.current === current) setLoading(false); });
    }, delay);
    return () => { controller.abort(); moreRequest.current?.abort(); window.clearTimeout(timer); };
  }, [key, kind, serialized, config.q, revision, pendingCount, attempt]);

  const loadMore = useCallback(async () => {
    if (!page?.hasMore || page.key !== key || loading || loadingMore) return;
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
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t load more results."); }
    finally { if (current === generation.current && !controller.signal.aborted) setLoadingMore(false); }
  }, [page, key, kind, serialized, loading, loadingMore]);

  return { items: page?.items ?? [], total: page?.key === key ? page.total : 0, today: page?.today, hasMore: page?.key === key && page.hasMore, loading: loading || (page?.key !== key && !error), loadingMore, error, retry: () => setAttempt(a => a + 1), loadMore };
}
