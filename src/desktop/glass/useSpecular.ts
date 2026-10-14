// The specular rim of a glass element: a thin bright edge whose highlight
// sits where the light would catch it, following the pointer anywhere in the
// window (CSS variables --lx / --ly, in % of the element, read by the rim
// gradient in desktop.css). One shared listener, updated at most once a frame.
import { useEffect } from "react";

// cache: OK — key=element; invalidated=removed on unmount; bound=mounted glass elements
const elements = new Set<HTMLElement>();
// cache: OK — key=none (the pending rAF id); invalidated=cleared when the frame runs; bound=1 entry
let frame = 0;
let pointer = { x: window.innerWidth * 0.3, y: 0 };

function update(): void {
  frame = 0;
  // loop: HOT-PATH-OK — N ≤ 3 glass elements; at most once a frame while the pointer moves
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    el.style.setProperty("--lx", `${(((pointer.x - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--ly", `${(((pointer.y - r.top) / r.height) * 100).toFixed(1)}%`);
  }
}

function onMove(e: PointerEvent): void {
  pointer = { x: e.clientX, y: e.clientY };
  // lifetime: OK — one-shot, at most one pending; only pointer moves arm it (none while hidden)
  if (!frame) frame = requestAnimationFrame(update);
}

export function useSpecular(el: HTMLElement | null, on: boolean): void {
  // lifetime: OK — cleanup drops the element; the last one removes the shared listener
  useEffect(() => {
    if (!el || !on) return;
    // lifetime: OK — one shared listener, removed when the last glass element unmounts
    if (elements.size === 0) window.addEventListener("pointermove", onMove, { passive: true });
    elements.add(el);
    update();
    return () => {
      elements.delete(el);
      if (elements.size === 0) window.removeEventListener("pointermove", onMove);
    };
  }, [el, on]);
}
