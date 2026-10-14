// The one way a popup is drawn on top: the browser's top layer (the Popover
// API, popover="manual"). An element in the top layer is painted above
// everything else in the window and is never clipped or re-anchored by its
// ancestors (a Section body's overflow and containment, the drawer, the
// panel's blur, a card's stacking), while it stays where it is in the DOM:
// theme tokens, events and `contains()` work as before. No z-index.
//
// useTopLayer(ref, open): the element joins the top layer while `open` (it
// must render with the class `top-layer`, whose reset is in desktop.css).
// With `anchor`, it is placed next to that element (fixed, under it, or above
// it when there's no room below; its start or end edge lined up with the
// anchor's, kept inside the window), and placed again on scroll and resize
// while open. Without, the element's own CSS places it (a dialog's backdrop).
// Idle cost: none (listeners live only while open).
import { useLayoutEffect, type RefObject } from "react";

export interface TopLayerPlace {
  anchor: RefObject<Element | null>;
  align?: "start" | "end"; // line up the left (start) or right (end) edges; default start
  gap?: number; // px between the anchor and the popup; default 6
  dx?: number; // px added to the horizontal position (start only)
}

// Shown in the top layer now (false where the browser has no Popover API: tests' jsdom).
function inTopLayer(el: HTMLElement): boolean {
  try {
    return el.matches(":popover-open");
  } catch {
    // error: NOT-WORTH — no Popover API (jsdom): the popup stays in the page flow, nothing to hide
    return false;
  }
}

const MARGIN = 8; // px kept free at the window's edges

export function placeNear(el: HTMLElement, a: Element, { align = "start", gap = 6, dx = 0 }: Omit<TopLayerPlace, "anchor">): void {
  const r = a.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const below = r.bottom + gap + h <= window.innerHeight - MARGIN;
  const top = below ? r.bottom + gap : Math.max(MARGIN, r.top - gap - h);
  const want = align === "end" ? r.right - w : r.left + dx;
  const left = Math.min(Math.max(MARGIN, want), Math.max(MARGIN, window.innerWidth - w - MARGIN));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

export function useTopLayer(ref: RefObject<HTMLElement | null>, open: boolean, place?: TopLayerPlace): void {
  const anchor = place?.anchor;
  const align = place?.align;
  const gap = place?.gap;
  const dx = place?.dx;
  // lifetime: OK — cleanup removes the scroll/resize listeners and leaves the top layer (closed / unmount)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    // (React 18 doesn't know the popover attribute yet.)
    el.setAttribute("popover", "manual");
    if (!inTopLayer(el)) el.showPopover?.();
    const a = anchor?.current;
    if (!a) {
      return () => {
        if (el.isConnected && inTopLayer(el)) el.hidePopover?.();
      };
    }
    const again = () => placeNear(el, a, { align, gap, dx });
    again();
    // lifetime: OK — removed in the layout effect cleanup (closed / unmount)
    window.addEventListener("resize", again);
    // lifetime: OK — removed in the layout effect cleanup (closed / unmount)
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
      if (el.isConnected && inTopLayer(el)) el.hidePopover?.();
    };
  }, [ref, open, anchor, align, gap, dx]);
}
