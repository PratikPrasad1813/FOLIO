"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Clock3, CornerDownLeft, FolderKanban, Lightbulb, Search, SearchX, ShieldCheck, SlidersHorizontal, SquareCheckBig, X } from "lucide-react";
import { Modal, ProjectIcon, Spinner } from "@/components/ui";
import { jsonRequest, searchRequest } from "@/lib/search-client";
import { SEARCH_LABELS, SEARCH_SCOPES, type RecentSearch, type SearchResponse, type SearchResult, type SearchScope } from "@/lib/search-types";
import { TASK_STATUS_LABELS, statusLabel, type TaskStatus } from "@/lib/types";

/** Plain React text nodes, never HTML from the server or the search input. */
export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const words = [...new Set(query.trim().split(/\s+/).map(s => s.replace(/^#/, "")).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!words.length) return <>{text}</>;
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "ig"));
  return <>{parts.map((part, i) => words.some(word => word.toLowerCase() === part.toLowerCase()) ? <mark key={i}>{part}</mark> : part)}</>;
}

const TYPE_ICON = { projects: FolderKanban, tasks: SquareCheckBig, ideas: Lightbulb };

export function GlobalSearch({ onClose, onSelect }: { onClose: () => void; onSelect: (result: SearchResult) => Promise<void> }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const lastCompleted = useRef<{ query: string; scope: SearchScope } | null>(null);
  const lastRemembered = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [response, setResponse] = useState<{ key: string; data: SearchResponse } | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const q = query.trim();
  const key = `${scope}:${q}`;
  const ready = response?.key === key;
  const loading = Boolean(q && !ready && !error);
  const groups = ready ? response.data.groups : [];
  const results = groups.flatMap(group => group.items);
  const entries = q ? results : recent;
  const selectedIndex = Math.min(active, Math.max(0, entries.length - 1));
  const scopeIcons = useMemo(() => ({ all: Search, ...TYPE_ICON }), []);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    searchRequest<{ searches: RecentSearch[] }>("/api/search/recent", { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { setRecent(body.searches); setHistoryError(""); } })
      .catch(err => { if (!controller.signal.aborted) setHistoryError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setActive(0);
    if (!q) { lastCompleted.current = null; return () => controller.abort(); }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q, scope });
      searchRequest<SearchResponse>(`/api/search?${params}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) { lastCompleted.current = { query: q, scope }; setResponse({ key, data }); } })
        .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t search your workspace."); });
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q, scope, key, attempt]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-search-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // The parent can close the palette via Ctrl/Cmd+K without invoking Modal's
  // onClose. Persist only the last completed query on unmount, once.
  useEffect(() => () => {
    const completed = lastCompleted.current;
    if (!completed) return;
    const signature = `${completed.scope}:${completed.query.toLowerCase()}`;
    if (lastRemembered.current === signature) return;
    lastRemembered.current = signature;
    void searchRequest("/api/search/recent", { ...jsonRequest("POST", completed), keepalive: true }).catch(() => {});
  }, []);

  async function remember() {
    if (!q) return;
    const signature = `${scope}:${q.toLowerCase()}`;
    if (lastRemembered.current === signature) return;
    lastRemembered.current = signature;
    try { await searchRequest("/api/search/recent", jsonRequest("POST", { query: q, scope })); }
    catch { /* A failed history write must not block opening a workspace item. */ }
  }
  async function choose(index: number) {
    if (opening) return;
    if (!q) {
      const item = recent[index];
      if (item) { setQuery(item.query); setScope(item.scope); input.current?.focus(); }
      return;
    }
    const item = results[index];
    if (!item) { if (ready) await remember(); return; }
    setOpening(item.id);
    try { await remember(); await onSelect(item); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "This item could not be opened."); }
    finally { setOpening(null); }
  }
  async function forget(searchId?: string) {
    setForgetting(true);
    try {
      await searchRequest(`/api/search/recent${searchId ? `?id=${searchId}` : ""}`, { method: "DELETE" });
      setRecent(rows => searchId ? rows.filter(row => row.id !== searchId) : []);
      setHistoryError("");
      input.current?.focus();
    } catch (err) { setHistoryError(err instanceof Error ? err.message : "Couldn’t remove search history."); }
    finally { setForgetting(false); }
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const n = entries.length;
      if (n) setActive((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + n) % n);
    }
    if (event.key === "Enter") { event.preventDefault(); void choose(selectedIndex); }
  }

  function closeSearch() {
    if (ready && q && !error) void remember();
    onClose();
  }
  function clearSearch() {
    if (ready && q && !error) void remember().then(() => setAttempt(value => value + 1));
    setQuery(""); setResponse(null); input.current?.focus();
  }

  return <Modal title="Find your next step" subtitle="A little less looking. A little more doing." className="gs-palette" onClose={closeSearch}>
    <div className={`gs-input-wrap ${loading ? "is-loading" : ""}`}>
      <Search size={21} strokeWidth={1.7} aria-hidden="true" />
      <input ref={input} autoFocus role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={entries.length ? `${id}-option-${selectedIndex}` : undefined} aria-label="Search your workspace" value={query} maxLength={200} placeholder="Search projects, tasks, and ideas…" onChange={e => setQuery(e.target.value)} onKeyDown={onKey} />
      {loading ? <Spinner size={17} /> : query ? <button type="button" className="gs-icon-button" aria-label="Clear global search" onClick={clearSearch}><X size={16} /></button> : <kbd>⌘ K</kbd>}
    </div>
    <div className="gs-scope-bar" role="group" aria-label="Search in">
      {SEARCH_SCOPES.map(value => {
        const Icon = scopeIcons[value];
        return <button key={value} type="button" className={scope === value ? "is-active" : ""} aria-pressed={scope === value} onClick={() => { setScope(value); input.current?.focus(); }}><Icon size={13} />{SEARCH_LABELS[value]}</button>;
      })}
      <span className="gs-scope-hint"><ShieldCheck size={12} />Your workspace</span>
    </div>
    <div className="gs-scroll" ref={list}>
      {!q && <div className="gs-section-heading"><span><Clock3 size={13} />Recent searches</span>{recent.length > 0 && <button type="button" disabled={forgetting} onClick={() => { void forget(); }}>Clear history</button>}</div>}
      <div className="sr-only" role="status" aria-live="polite">{loading ? "Searching your workspace" : q && ready ? `${results.length}${groups.some(g => g.hasMore) ? " or more" : ""} results` : `${recent.length} recent searches`}</div>
      {(error || (!q && historyError)) && <div className="gs-error" role="alert"><SearchX size={17} /><span>{error || historyError}</span><button className="pj-link" onClick={() => setAttempt(a => a + 1)}>Try again</button></div>}
      {(loading || (!q && historyLoading)) && <div className="gs-skeletons" aria-hidden="true">{[0, 1, 2].map(i => <div key={i}><i className="pj-sk" /><span><b className="pj-sk" /><small className="pj-sk" /></span></div>)}</div>}
      <div id={`${id}-list`} role="listbox" aria-label={q ? "Search results" : "Recent searches"}>
        {!q && !historyLoading && recent.map((item, index) => <div className="gs-recent" key={item.id}>
          <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} data-search-index={index} aria-selected={index === selectedIndex} className={`gs-recent-option ${index === selectedIndex ? "is-active" : ""}`} onMouseMove={() => setActive(index)} onClick={() => { void choose(index); }}><Clock3 size={16} /><span>{item.query}</span><small>{SEARCH_LABELS[item.scope]}</small><CornerDownLeft size={13} /></button>
          <button type="button" disabled={forgetting} className="gs-forget gs-icon-button" aria-label={`Forget search ${item.query}`} onClick={() => { void forget(item.id); }}><X size={13} /></button>
        </div>)}
        {q && !loading && !error && groups.map(group => {
          const Icon = TYPE_ICON[group.kind];
          if (!group.items.length) return null;
          return <div key={group.kind} role="group" aria-labelledby={`${id}-${group.kind}`} className="gs-group">
            <div className="gs-section-heading" id={`${id}-${group.kind}`}><span><Icon size={13} />{SEARCH_LABELS[group.kind]}<b>{group.items.length}{group.hasMore ? "+" : ""}</b></span>{group.hasMore && scope === "all" && <button tabIndex={-1} onClick={() => setScope(group.kind)}>See more <ArrowRight size={12} /></button>}</div>
            {group.items.map(item => {
              const index = results.indexOf(item);
              const status = item.kind === "tasks" ? TASK_STATUS_LABELS[item.status as TaskStatus] : item.kind === "projects" ? statusLabel(item.status) : item.status;
              return <button key={item.id} type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} data-search-index={index} aria-selected={index === selectedIndex} className={`gs-result ${index === selectedIndex ? "is-active" : ""}`} onMouseMove={() => setActive(index)} onClick={() => { void choose(index); }} disabled={Boolean(opening)}>
                {item.kind === "projects" ? <ProjectIcon icon={item.icon} color={item.color} small /> : <span className={`gs-result-icon is-${item.kind}`}><Icon size={17} strokeWidth={1.7} /></span>}
                <span className="gs-result-copy"><strong><SearchHighlight text={item.title} query={q} /></strong><span className="gs-result-meta">{item.projectName && <span><FolderKanban size={11} /><SearchHighlight text={item.projectName} query={q} /></span>}<span className={`gs-state ${item.status === "done" || item.status === "Completed" ? "is-done" : ""}`}>{status}</span>{item.priority && item.priority !== "None" && <span className={`gs-priority is-${item.priority.toLowerCase()}`}>{item.priority}</span>}{item.archived && <span>Archived</span>}</span>{item.description && <small><SearchHighlight text={item.description} query={q} /></small>}</span>
                <span className="gs-result-enter">{opening === item.id ? <Spinner size={15} /> : <CornerDownLeft size={15} />}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
      {!q && !historyLoading && !recent.length && !historyError && <div className="gs-empty"><span className="gs-empty-art"><Search size={27} strokeWidth={1.4} /><i /><i /></span><h3>Everything, a few keystrokes away.</h3><p>Find the project, task, or idea you have in mind.<br />The searches you use will stay close, right here.</p><div className="gs-empty-types"><span><FolderKanban size={13} />Projects</span><span><SquareCheckBig size={13} />Tasks</span><span><Lightbulb size={13} />Ideas</span></div></div>}
      {q && ready && !loading && !error && !results.length && <div className="gs-empty"><span className="gs-empty-art"><SearchX size={27} strokeWidth={1.4} /></span><h3>No matches for “{q}”</h3><p>Try a shorter phrase, a project name, or a task label.<br />{scope === "all" ? "We looked through projects, task details, and ideas." : `You're searching in ${SEARCH_LABELS[scope].toLowerCase()}.`}</p>{scope !== "all" && <button className="pj-btn is-secondary is-sm" onClick={() => setScope("all")}>Search everything</button>}</div>}
      {q && ready && groups.some(g => g.hasMore) && scope !== "all" && <p className="gs-limit-note">Showing the 20 best matches. Add another word to narrow your search.</p>}
      {!q && <div className="gs-tip"><SlidersHorizontal size={14} /><span>Need a little more focus? Use <strong>Filters</strong> in Projects or My tasks.</span></div>}
    </div>
    <footer className="gs-footer"><span><kbd><ArrowUp size={10} /></kbd><kbd><ArrowDown size={10} /></kbd>to navigate</span><span><kbd><CornerDownLeft size={11} /></kbd>to open</span><span className="gs-escape"><kbd>esc</kbd>to close</span></footer>
  </Modal>;
}
