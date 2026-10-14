// The look's knobs (App settings -> Appearance): one table, each knob a
// stored number that becomes a CSS variable on <html> (desktop.css and the
// backdrop read them). Add a knob here and it gets a slider automatically.
import { useCallback, useEffect, useState } from "react";
import { PREF_EVENT, readPref, usePref } from "./storage";

export interface Knob {
  key: string; // i18n key under desktop.knobs, and the stored preference
  min: number;
  max: number;
  step: number;
  fallback: number;
  unit: string;
  cssVar: string;
  css: (v: number) => string;
  hidden?: boolean; // not in the generic Appearance list
}

export const KNOBS: Knob[] = [
  { key: "cardOpacity", min: 40, max: 100, step: 5, fallback: 100, unit: "%", cssVar: "--card-opacity", css: (v) => `${v}%` },
  { key: "backdropDim", min: 0, max: 90, step: 5, fallback: 55, unit: "%", cssVar: "--backdrop-dim", css: (v) => `${v}%` },
  { key: "backdropBlur", min: 0, max: 100, step: 10, fallback: 60, unit: "%", cssVar: "--backdrop-blur", css: (v) => String(v) },
  { key: "depth", min: 0, max: 100, step: 10, fallback: 60, unit: "%", cssVar: "--depth", css: (v) => String(v / 100) },
  // HDR lighting's peak (your display's peak brightness); shown with that switch.
  { key: "hdrNits", min: 200, max: 2000, step: 50, fallback: 500, unit: "nits", cssVar: "--hdr-nits", css: (v) => String(v), hidden: true },
];

// Each knob's allowed stored values, built once (a fresh array per render
// would re-subscribe usePref's listener every time).
const ALLOWED = new Map(KNOBS.map((k) => [k.key, Array.from({ length: Math.round((k.max - k.min) / k.step) + 1 }, (_, i) => String(k.min + i * k.step))]));
const prefKey = (k: Knob) => `ds5.knob.${k.key}`;
const readKnob = (k: Knob) => {
  const v = readPref(prefKey(k));
  return v !== null && ALLOWED.get(k.key)!.includes(v) ? Number(v) : k.fallback;
};

export function useKnob(k: Knob): [number, (v: number) => void] {
  const [v, set] = usePref<string>(prefKey(k), String(k.fallback), ALLOWED.get(k.key)!);
  const setNumber = useCallback((n: number) => set(String(Math.min(k.max, Math.max(k.min, Math.round(n / k.step) * k.step)))), [k, set]);
  return [Number(v), setNumber];
}

// loop: NOT-WORTH — N ≈ 4 look knobs; on a settings control render
export const knob = (key: string) => KNOBS.find((k) => k.key === key)!;

// App root: keeps the CSS variables in step with the knobs (one listener
// for all of them).
export function useLookKnobs(): void {
  const [vals, setVals] = useState(() => KNOBS.map(readKnob));
  // lifetime: OK — cleanup: removes the pref listener (app root, mounts once)
  useEffect(() => {
    const on = (e: Event) => {
      const { key } = (e as CustomEvent<{ key: string }>).detail;
      if (key.startsWith("ds5.knob.")) setVals(KNOBS.map(readKnob));
    };
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener(PREF_EVENT, on);
    return () => window.removeEventListener(PREF_EVENT, on);
  }, []);
  // lifetime: OK — acquires nothing (writes CSS variables on <html>)
  useEffect(() => {
    const root = document.documentElement;
    // loop: NOT-WORTH — N ≈ 4 CSS variables; only when a knob changes
    KNOBS.forEach((k, i) => root.style.setProperty(k.cssVar, k.css(vals[i])));
    root.toggleAttribute("data-cards-translucent", vals[0] < 100);
  }, [vals]);
}
