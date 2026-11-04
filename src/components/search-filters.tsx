"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bookmark, BookmarkPlus, Check, ChevronDown, FilterX, Plus, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { MenuButton, MenuItem, MenuLabel, MenuSeparator } from "@/components/menu";
import { Modal, Spinner } from "@/components/ui";
import { jsonRequest, searchRequest } from "@/lib/search-client";
import { DATE_PRESETS, DATE_PRESET_LABELS, parseFilters, type FilterConfig, type FilterKind, type SavedFilter } from "@/lib/search-types";
import { PRIORITIES, PROJECT_STATUSES, statusLabel } from "@/lib/types";

export function FilterPopover({ children, count, onClear, label = "Filters" }: { children: ReactNode; count: number; onClear: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus(); };
    const click = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close(false); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } };
    const frame = requestAnimationFrame(() => panel.current?.focus());
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", click); document.removeEventListener("keydown", key, true); };
  }, [open]);
  function toggle() {
    if (!open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(515, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 18;
      const above = rect.top - 18;
      const useBelow = below >= 370 || below >= above;
      const maxHeight = Math.max(240, Math.min(590, useBelow ? below : above));
      setPosition(window.innerWidth <= 600
        ? { position: "fixed", left: 12, right: 12, top: 80, width: "auto", maxHeight: window.innerHeight - 96 }
        : { position: "fixed", left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), right: "auto", top: useBelow ? rect.bottom + 8 : Math.max(12, rect.top - maxHeight - 8), width, maxHeight });
    }
    setOpen(value => !value);
  }
  return <div ref={root} className="sf-filter-anchor" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !panel.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" className={`pj-btn is-secondary sf-filter-button ${count ? "is-set" : ""}`} aria-haspopup="dialog" aria-controls={open ? id : undefined} aria-expanded={open} onClick={toggle}><SlidersHorizontal size={15} />{label}{count > 0 && <span className="pj-btn-count">{count}</span>}<ChevronDown size={12} /></button>
    {open && createPortal(<div className="sf-popover" style={position} role="dialog" aria-label="Advanced filters" id={id} ref={panel} tabIndex={-1}>
      <header><span className="sf-pop-icon"><SlidersHorizontal size={17} /></span><div><h3>A little more focus.</h3><p>Combine filters to find exactly what you need.</p></div><button className="pj-icon-btn" aria-label="Close filters" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      <div className="sf-popover-scroll">{children}</div>
      <footer><button className="pj-link" type="button" onClick={onClear}><FilterX size={13} />Clear all</button><span>Changes apply instantly</span><button className="pj-btn is-primary is-sm" type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done<Check size={13} /></button></footer>
    </div>, document.body)}
  </div>;
}

export function ProjectFilterFields({ value, onChange }: { value: FilterConfig; onChange: (value: FilterConfig) => void }) {
  const patch = (next: Partial<FilterConfig>) => onChange({ ...value, ...next });
  return <div className="sf-project-fields">
    <div className="sf-two-fields">
      <label>Status<select aria-label="Project status" value={value.statuses[0] ?? "all"} onChange={e => patch({ statuses: e.target.value === "all" ? [] : [e.target.value] })}><option value="all">All statuses</option>{PROJECT_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <label>Priority<select aria-label="Project priority" value={value.priorities[0] ?? "all"} onChange={e => patch({ priorities: e.target.value === "all" ? [] : [e.target.value] })}><option value="all">All priorities</option>{PRIORITIES.map(priority => <option key={priority}>{priority}</option>)}</select></label>
    </div>
    <fieldset><legend>Deadline</legend><div className="sf-choice-row">{DATE_PRESETS.map(preset => <button type="button" className={`tk-fchip ${value.deadline === preset ? "is-on" : ""}`} key={preset} aria-pressed={value.deadline === preset} onClick={() => patch({ deadline: preset })}>{DATE_PRESET_LABELS[preset]}</button>)}</div></fieldset>
    <fieldset><legend>Progress <span>Completed tasks ÷ total tasks</span></legend>
      <div className="sf-choice-row">{[[null, null, "Any progress"], [0, 0, "Not started"], [1, 99, "In motion"], [100, 100, "Complete"]].map(([min, max, label]) => <button key={String(label)} type="button" className={`tk-fchip ${value.progressMin === min && value.progressMax === max ? "is-on" : ""}`} aria-pressed={value.progressMin === min && value.progressMax === max} onClick={() => patch({ progressMin: min as number | null, progressMax: max as number | null })}>{label}</button>)}</div>
      <div className="sf-percent-range"><label>Min %<input type="number" min={0} max={100} placeholder="0" aria-label="Minimum progress" value={value.progressMin ?? ""} onChange={e => patch({ progressMin: e.target.value === "" ? null : Number(e.target.value) })} /></label><span>—</span><label>Max %<input type="number" min={0} max={100} placeholder="100" aria-label="Maximum progress" value={value.progressMax ?? ""} onChange={e => patch({ progressMax: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
    </fieldset>
    <fieldset><legend>Start date</legend><div className="sf-two-fields"><label>From<input type="date" aria-label="Project starts on or after" value={value.startFrom} max={value.startTo || undefined} onChange={e => patch({ startFrom: e.target.value })} /></label><label>To<input type="date" aria-label="Project starts on or before" value={value.startTo} min={value.startFrom || undefined} onChange={e => patch({ startTo: e.target.value })} /></label></div></fieldset>
    <fieldset><legend>Deadline range</legend><div className="sf-two-fields"><label>From<input type="date" aria-label="Project deadline on or after" value={value.from} max={value.to || undefined} onChange={e => patch({ from: e.target.value })} /></label><label>To<input type="date" aria-label="Project deadline on or before" value={value.to} min={value.from || undefined} onChange={e => patch({ to: e.target.value })} /></label></div></fieldset>
  </div>;
}

export function SavedFilters({ kind, config, onApply }: { kind: FilterKind; config: FilterConfig; onApply: (config: FilterConfig) => void }) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<SavedFilter | null>(null);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    searchRequest<{ filters: SavedFilter[] }>(`/api/filters?kind=${kind}`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { setFilters(body.filters); setError(""); } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, attempt]);
  async function save() {
    setBusy(true); setFormError("");
    try {
      const valid = parseFilters(kind, config);
      const { filter } = await searchRequest<{ filter: SavedFilter }>("/api/filters", jsonRequest("POST", { kind, name, config: valid }));
      if (!alive.current) return;
      setFilters(rows => [filter, ...rows]); setSaveOpen(false); setName(""); setMessage(`Saved “${filter.name}”.`);
    } catch (err) { if (alive.current) setFormError(err instanceof Error ? err.message : "Couldn’t save filter."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true); setFormError("");
    try {
      await searchRequest(`/api/filters?id=${deleting.id}`, { method: "DELETE" });
      if (!alive.current) return;
      setFilters(rows => rows.filter(f => f.id !== deleting.id)); setDeleting(null); setMessage("Saved filter removed.");
    } catch (err) { if (alive.current) setFormError(err instanceof Error ? err.message : "Couldn’t delete filter."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <>
    <MenuButton label="Saved filters" triggerClassName="pj-btn is-secondary sf-saved-trigger" width={310} trigger={<><Bookmark size={14} />Saved{filters.length > 0 && <span className="pj-btn-count">{filters.length}</span>}<ChevronDown size={12} /></>}>
      {close => <><MenuLabel>YOUR SAVED FILTERS · {kind}</MenuLabel>
        {loading ? <div className="sf-menu-note" role="status"><Spinner size={14} />Loading saved filters…</div> : error ? <><p className="sf-menu-note" role="alert">{error}</p><MenuItem icon={<RefreshCw size={14} />} onSelect={() => setAttempt(n => n + 1)}>Try again</MenuItem></> : !filters.length ? <p className="sf-menu-note">Your go-to views, one click away.<br />Save a filter combination to keep it here.</p> : <div className="sf-saved-list">{filters.map(filter => <div key={filter.id} className="sf-saved-row"><button type="button" role="menuitem" className="fm-item" onClick={() => { try { onApply(parseFilters(kind, filter.config)); setMessage(`Applied “${filter.name}”.`); close(); } catch (err) { setError(err instanceof Error ? err.message : "Invalid saved filter."); } }}><Bookmark size={13} /><span className="fm-text">{filter.name}</span></button><button type="button" role="menuitem" className="sf-delete-saved" aria-label={`Delete saved filter ${filter.name}`} onClick={() => { close(); setFormError(""); setDeleting(filter); }}><Trash2 size={13} /></button></div>)}</div>}
        <MenuSeparator /><MenuItem icon={<BookmarkPlus size={14} />} onSelect={() => { close(); setName(""); setFormError(""); setSaveOpen(true); }}>Save this filter combination</MenuItem>
      </>}
    </MenuButton>
    <span className="sr-only" role="status" aria-live="polite">{message}</span>
    {saveOpen && <Modal title="Keep this view close." subtitle={`Save your current ${kind} filters and sort order.`} onClose={() => { if (!busy) setSaveOpen(false); }} className="sf-save-modal">
      <form onSubmit={e => { e.preventDefault(); void save(); }}><div className="sf-save-body"><span className="sf-save-icon"><BookmarkPlus size={24} /></span><label>Filter name<input autoFocus required maxLength={50} value={name} placeholder={kind === "tasks" ? "e.g. This week’s priorities" : "e.g. Projects close to the finish line"} onChange={e => setName(e.target.value)} /></label><p>Filters are saved to your account. Reuse them from the Saved menu, in any view.</p>{formError && <p className="form-error" role="alert">{formError}</p>}</div><div className="modal-footer"><button type="button" className="pj-btn is-secondary" disabled={busy} onClick={() => setSaveOpen(false)}>Cancel</button><button className="pj-btn is-primary" disabled={busy || !name.trim()}>{busy ? <Spinner size={14} /> : <Plus size={14} />}Save filter</button></div></form>
    </Modal>}
    {deleting && <Modal title="Delete saved filter?" onClose={() => { if (!busy) setDeleting(null); }} className="sf-save-modal"><div className="sf-save-body"><p>Remove <strong>“{deleting.name}”</strong> from your saved filters? Your projects and tasks won’t be changed.</p>{formError && <p className="form-error" role="alert">{formError}</p>}</div><div className="modal-footer"><button className="pj-btn is-secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep it</button><button className="button danger" disabled={busy} onClick={() => { void remove(); }}>{busy ? <Spinner size={14} /> : <Trash2 size={14} />}Delete filter</button></div></Modal>}
  </>;
}

export function CollectionNotice({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (error) return <div className="sf-feedback is-error" role="alert"><span>{error}</span><button className="pj-link" onClick={onRetry}><RefreshCw size={13} />Try again</button></div>;
  if (loading) return <div className="sf-feedback" role="status"><Spinner size={14} /><span>Finding your focus…</span></div>;
  return null;
}
export function MoreResults({ hasMore, loading, count, total, onMore }: { hasMore: boolean; loading: boolean; count: number; total: number; onMore: () => void }) {
  if (!hasMore) return null;
  return <div className="sf-more"><span>{count} of {total} matches loaded</span><button className="pj-btn is-secondary" disabled={loading} onClick={onMore}>{loading ? <Spinner size={14} /> : <Plus size={14} />}Load more results</button></div>;
}
