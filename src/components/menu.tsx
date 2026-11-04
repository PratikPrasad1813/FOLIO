"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

type Position = { left: number; top?: number; bottom?: number };

interface MenuButtonProps {
  /** Accessible name for the trigger and the menu. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  width?: number;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}

/**
 * A small accessible menu: rendered in a portal so cards, tables and sticky
 * headers never clip it; arrow keys / Home / End move focus, Escape closes and
 * returns focus to the trigger, Tab closes and moves on naturally.
 */
export function MenuButton({ label, trigger, triggerClassName = "", width = 236, disabled, children }: MenuButtonProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  const [returnFocus, setReturnFocus] = useState(false);

  // Kept ref-free so it can be handed to render props safely; focus returns in an effect.
  const close = useCallback((focusTrigger = true) => {
    setReturnFocus(focusTrigger);
    setPosition(null);
  }, []);

  useEffect(() => {
    if (!open && returnFocus) triggerRef.current?.focus();
  }, [open, returnFocus]);

  function toggle() {
    if (open) { close(); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const spaceBelow = window.innerHeight - rect.bottom;
    setPosition(spaceBelow < 360 && rect.top > spaceBelow ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
  }

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? []);
    const frame = requestAnimationFrame(() => items()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === "Tab") { close(false); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const list = items();
      if (!list.length) return;
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : event.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    const onViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, close]);

  const style: CSSProperties | undefined = position ? { left: position.left, top: position.top, bottom: position.bottom, width } : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        {trigger}
      </button>
      {open && createPortal(
        <>
          {/* Events from portals bubble through React parents, so stop them reaching clickable cards/rows. */}
          <div className="fm-scrim" aria-hidden="true" onClick={(event) => { event.stopPropagation(); close(false); }} />
          <div ref={menuRef} id={menuId} role="menu" aria-label={label} className={`fm-menu ${position?.bottom !== undefined ? "is-above" : ""}`} style={style} onClick={(event) => event.stopPropagation()}>
            {children(() => close())}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon, children, onSelect, danger = false, checked, hint }: { icon?: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean; checked?: boolean; hint?: string }) {
  const radio = typeof checked === "boolean";
  return (
    <button type="button" role={radio ? "menuitemradio" : "menuitem"} aria-checked={radio ? checked : undefined} className={`fm-item ${danger ? "is-danger" : ""} ${checked ? "is-checked" : ""}`} onClick={onSelect}>
      {icon && <span className="fm-icon">{icon}</span>}
      <span className="fm-text">{children}</span>
      {hint && <kbd className="fm-hint">{hint}</kbd>}
      {radio && checked && <Check size={14} className="fm-check" aria-hidden="true" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="fm-label" role="presentation">{children}</div>;
}

export function MenuSeparator() {
  return <div className="fm-sep" role="separator" />;
}
