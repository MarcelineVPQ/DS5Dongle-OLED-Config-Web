// The app's own reduce-motion preference: sets data-reduce-motion on <html>,
// which the stylesheet treats like the system's prefers-reduced-motion.
import { useEffect } from "react";
import { useFlagPref } from "./storage";

export const REDUCE_MOTION_KEY = "ds5.reduceMotion";

export function useReduceMotion(): void {
  const [on] = useFlagPref(REDUCE_MOTION_KEY);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-motion", on);
  }, [on]);
}
