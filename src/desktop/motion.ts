// The app's own reduce-motion preference: sets data-reduce-motion on <html>,
// which the stylesheet treats like the system's prefers-reduced-motion.
import { useEffect, useState } from "react";
import { useFlagPref } from "./storage";

export const REDUCE_MOTION_KEY = "ds5.reduceMotion";

export function useReduceMotion(): void {
  const [on] = useFlagPref(REDUCE_MOTION_KEY);
  // lifetime: OK — acquires nothing (toggles data-reduce-motion)
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-motion", on);
  }, [on]);
}

// Whether motion should stop (the app's preference or the system's),
// followed live: for animations drawn in script, which the stylesheet can't
// stop (the swirl background).
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

// The same, right now, outside a component (the toast queue: skip the fade).
export function reducedMotionNow(): boolean {
  if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduce-motion")) return true;
  return typeof matchMedia === "function" && matchMedia(REDUCED_QUERY).matches;
}
export function useReducedMotion(): boolean {
  const [pref] = useFlagPref(REDUCE_MOTION_KEY);
  const [system, setSystem] = useState(() => matchMedia(REDUCED_QUERY).matches);
  // lifetime: OK — cleanup: removes the media query listener
  useEffect(() => {
    const media = matchMedia(REDUCED_QUERY);
    const update = () => setSystem(media.matches);
    // lifetime: OK — removed in the effect cleanup
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return pref || system;
}
