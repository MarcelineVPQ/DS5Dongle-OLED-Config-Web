// Gives an element the liquid glass backdrop while `on`. Returns a callback
// ref, so it attaches whenever the element appears (an element that mounts
// later, like the save bar once the dongle connects, still gets it) and
// rebuilds the filter when the size changes (debounced; the map is per size).
//
// Two filters per element, as CSS variables the stylesheet chooses from:
// --glass-clear (Apple's clear variant) and --glass-regular (more frost, for
// when the element sits over text, e.g. the rail while it's open).
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GLASS, glassFilter, nextGlassId, removeGlassFilter, type GlassOptions } from "./liquidGlass";

export function useLiquidGlass(on: boolean, clear: Partial<GlassOptions>, regular?: Partial<GlassOptions>): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  const c = JSON.stringify(clear);
  const r = JSON.stringify(regular ?? null);
  // lifetime: OK — cleanup disconnects the observer, clears the timer, removes the SVG filters
  useEffect(() => {
    if (!el || !on) return;
    const clearOpts = { ...DEFAULT_GLASS, ...(JSON.parse(c) as Partial<GlassOptions>) };
    const regularOpts = r === "null" ? null : { ...DEFAULT_GLASS, ...(JSON.parse(r) as Partial<GlassOptions>) };
    const ids = [nextGlassId(), nextGlassId()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const build = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 4 || height < 4) return;
      const w = Math.round(width);
      const h = Math.round(height);
      el.style.setProperty("--glass-clear", glassFilter(ids[0], w, h, clearOpts));
      el.style.setProperty("--glass-regular", regularOpts ? glassFilter(ids[1], w, h, regularOpts) : "var(--glass-clear)");
    };
    build();
    // lifetime: OK — disconnected in the effect cleanup (unmount, glass off)
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      // lifetime: OK — one-shot debounce, cleared on the next resize and in the cleanup
      timer = setTimeout(build, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
      el.style.removeProperty("--glass-clear");
      el.style.removeProperty("--glass-regular");
      ids.forEach(removeGlassFilter);
    };
  }, [el, on, c, r]);
  return ref;
}
