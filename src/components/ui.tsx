"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { BookOpen, Check, Code2, Coffee, FolderKanban, Heart, LayoutTemplate, Lightbulb, LoaderCircle, Megaphone, PenTool, Smartphone, X } from "lucide-react";
import { initials, statusLabel } from "@/lib/types";

export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><svg width="33" height="35" viewBox="0 0 33 35" fill="none" aria-hidden="true"><path d="M6 6.5C6 3.46 8.46 1 11.5 1H27v9H15v7H6V6.5Z" fill="currentColor"/><path d="M6 17h9v11.5a5.5 5.5 0 0 1-5.5 5.5H6V17Z" fill="currentColor"/><path d="M18 13h9v4.5a5.5 5.5 0 0 1-5.5 5.5H18V13Z" fill="#A89AE9"/></svg>{!compact && <span>folio<span className="brand-dot">.</span></span>}</span>;
}

export const PROJECT_ICONS = { layout: LayoutTemplate, smartphone: Smartphone, pen: PenTool, code: Code2, book: BookOpen, megaphone: Megaphone, heart: Heart, coffee: Coffee };
export function ProjectIcon({ icon = "layout", color = "violet", small = false }: { icon?: string; color?: string; small?: boolean }) {
  const Icon = PROJECT_ICONS[icon as keyof typeof PROJECT_ICONS] || FolderKanban;
  return <span className={`project-icon color-${color} ${small ? "small" : ""}`}><Icon size={small ? 17 : 22} strokeWidth={1.75}/></span>;
}
export function Avatar({ name = "You", small = false }: { name?: string; small?: boolean }) { return <span className={`avatar ${small ? "avatar-sm" : ""}`} aria-label={name}>{initials(name)}</span>; }
export function Spinner({ size = 18 }: { size?: number }) { return <LoaderCircle size={size} className="spin" aria-label="Loading"/>; }
export function Status({ status }: { status: string }) { return <span className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}><span/>{statusLabel(status)}</span>; }
export function EmptyState({ title, description, action, onAction, icon = "project" }: { title: string; description: string; action?: string; onAction?: () => void; icon?: "project" | "idea" | "task" }) {
  const Icon = icon === "idea" ? Lightbulb : icon === "task" ? Check : FolderKanban;
  return <div className="empty-state"><div className="empty-icon"><Icon size={27} strokeWidth={1.5}/></div><h3>{title}</h3><p>{description}</p>{action && <button className="button primary" onClick={onAction}>{action}</button>}</div>;
}
export function Modal({ title, children, onClose, className = "", subtitle, initialFocus = "field" }: { title: string; children: ReactNode; onClose: () => void; className?: string; subtitle?: string; initialFocus?: "field" | "panel" }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Parents pass a fresh onClose on every render; keep the latest in a ref so the
  // effect below runs once per open (re-running it used to steal focus mid-typing).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = requestAnimationFrame(() => { const auto = initialFocus === "panel" ? null : panel.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), textarea"); (auto || panel.current)?.focus(); });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === "Tab") {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(el => el.offsetParent !== null);
        if (!elements.length) { event.preventDefault(); return; }
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { cancelAnimationFrame(timer); document.removeEventListener("keydown", handleKey); document.body.style.overflow = previousOverflow; previous?.focus(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open; initialFocus is read on mount only
  }, []);
  return <div className={`modal-backdrop ${className.includes("drawer") ? "drawer-backdrop" : ""}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}><div className="modal-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button close-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}</div></div>;
}

export function MomentumArt() {
  return <svg className="momentum-art" width="340" height="180" viewBox="0 0 340 180" fill="none" aria-hidden="true">
    <path d="M251 12c33 9 61 41 60 78-1 28-17 49-41 65" stroke="#D9D2ED" strokeWidth="1.3" strokeDasharray="4 5"/>
    <circle cx="114" cy="83" r="61" fill="#E2DDF2"/>
    <path d="m73 60 18-5 15 12 76-21c6-2 11 1 12 6l23 82c2 6-1 11-7 13l-108 29c-6 2-10-1-12-7L65 75c-2-6 1-12 8-15Z" fill="#B4A4E5"/>
    <path d="m68 80 126-34 28 98c1 5-1 9-7 11l-109 29c-5 1-9-1-11-6L68 80Z" fill="#A08BD9"/>
    <rect x="111" y="27" width="108" height="132" rx="8" transform="rotate(8 111 27)" fill="#D8D0EB"/>
    <rect x="116" y="20" width="108" height="132" rx="8" transform="rotate(8 116 20)" fill="#fff" stroke="#E6E1EE"/>
    <path d="m133 45 37 5" stroke="#514567" strokeWidth="4" strokeLinecap="round"/>
    <path d="m133 56 62 9" stroke="#E2DFE8" strokeWidth="3" strokeLinecap="round"/>
    <rect x="130" y="73" width="11" height="11" rx="3" transform="rotate(8 130 73)" fill="#DACFF3"/>
    <path d="m133 78 2 3 5-5" stroke="#8570BA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m149 81 43 6" stroke="#D7D1E0" strokeWidth="3" strokeLinecap="round"/>
    <rect x="127" y="94" width="11" height="11" rx="3" transform="rotate(8 127 94)" fill="#DACFF3"/>
    <path d="m130 99 2 3 5-5" stroke="#8570BA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m146 102 35 5" stroke="#D7D1E0" strokeWidth="3" strokeLinecap="round"/>
    <rect x="124" y="115" width="11" height="11" rx="3" transform="rotate(8 124 115)" stroke="#DAD4E3" strokeWidth="1.5"/>
    <path d="m143 123 43 6" stroke="#E5E0EB" strokeWidth="3" strokeLinecap="round"/>
    <g transform="rotate(-12 237 119)"><rect x="203" y="88" width="72" height="71" rx="5" fill="#F4DB80"/><path d="M222 108h32m-32 9h23m-23 9h29" stroke="#B49643" strokeWidth="2" strokeLinecap="round"/><path d="m239 139 4 4 9-10" stroke="#8F7534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></g>
    <path d="m242 28 6 13 14 1-11 9 3 14-12-8-13 7 4-14-10-10 14 1 5-13Z" fill="#C2D8A8" stroke="#ABC38F" strokeLinejoin="round"/>
    <path d="m72 20 1 11m-6-5 11-1m205 47 1 9m-5-4 9-1" stroke="#9A88BD" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="53" cy="124" r="4" fill="#C4B5E0"/><circle cx="288" cy="127" r="3" fill="#C4B5E0"/>
  </svg>;
}
