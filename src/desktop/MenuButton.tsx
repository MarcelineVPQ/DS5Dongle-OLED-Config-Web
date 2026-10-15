// The one popup menu: a button that opens a menu (role menu) in the top
// layer under it (useTopLayer). Every menu of the app is built on it: the
// settings panel's ⋮ (Section.tsx PanelMenu) and Games' Show menu
// (GameLibrary.tsx). An item is a button with role menuitem (runs, then the
// menu closes and the focus goes back to the button) or menuitemcheckbox
// (toggles, the menu stays open).
//
// Keyboard: Enter / Space / ↓ on the button opens it on the first item; ↑ ↓
// Home End move between items, Escape closes it and puts the focus back on
// the button, Tab closes it. A click outside closes it.
// Idle cost: none (its listeners live only while it's open; no animation).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTopLayer } from "./topLayer";

interface Props {
  label: string; // the button's and the menu's name
  title?: string; // the button's tooltip (default: the label)
  className?: string; // the button's classes
  align?: "start" | "end";
  content: ReactNode; // what the button shows
  iconOnly?: boolean; // the button shows only an icon: the label is its name (else its visible text is)
  children: ReactNode; // the items
}

const ITEMS = '[role^="menuitem"]:not(:disabled)';

export function MenuButton({ label, title, className = "dk-btn dk-icon-btn", align, content, iconOnly = true, children }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useTopLayer(menu, open, { anchor: button, align, gap: 4 });
  // lifetime: OK — cleanup: removes the outside-click listener (menu closes / unmount)
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const onDown = (e: PointerEvent) => {
      const at = e.target as Node;
      if (!menu.current?.contains(at) && !button.current?.contains(at)) setOpen(false);
    };
    // lifetime: OK — removed in the effect cleanup (menu closes / unmount)
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  const onMenuKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the drawer's Escape too
      close(true);
      return;
    }
    if (e.key === "Tab") return close(false);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        aria-label={iconOnly ? label : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {content}
      </button>
      {open && (
        <div
          ref={menu}
          className="dk-menu top-layer"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeys}
          // A menuitem ran (its own click first, this bubbles after): the menu closes.
          onClick={(e) => (e.target as HTMLElement).closest('[role="menuitem"]') && close(true)}
        >
          {children}
        </div>
      )}
    </>
  );
}
