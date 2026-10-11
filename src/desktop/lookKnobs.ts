// The look's knobs (App settings -> Appearance): one table, each knob a
// stored number that becomes a CSS variable on <html> (desktop.css and the
// backdrop read them). Add a knob here and it gets a slider automatically.
import { useEffect } from "react";
import { usePref } from "./storage";

export interface Knob {
  key: string; // i18n key under desktop.knobs, and the stored preference
  min: number;
  max: number;
  step: number;
  fallback: number;
  unit: string;
  cssVar: string;
  css: (v: number) => string;
}

export const KNOBS: Knob[] = [
  { key: "cardOpacity", min: 40, max: 100, step: 5, fallback: 100, unit: "%", cssVar: "--card-opacity", css: (v) => `${v}%` },
  { key: "backdropDim", min: 0, max: 90, step: 5, fallback: 55, unit: "%", cssVar: "--backdrop-dim", css: (v) => `${v}%` },
  { key: "backdropBlur", min: 0, max: 100, step: 10, fallback: 60, unit: "%", cssVar: "--backdrop-blur", css: (v) => String(v) },
  { key: "depth", min: 0, max: 100, step: 10, fallback: 60, unit: "%", cssVar: "--depth", css: (v) => String(v / 100) },
];

const values = (k: Knob) => Array.from({ length: Math.round((k.max - k.min) / k.step) + 1 }, (_, i) => String(k.min + i * k.step));

export function useKnob(k: Knob): [number, (v: number) => void] {
  const [v, set] = usePref<string>(`ds5.knob.${k.key}`, String(k.fallback), values(k));
  return [Number(v), (n) => set(String(Math.min(k.max, Math.max(k.min, Math.round(n / k.step) * k.step))))];
}

export const knob = (key: string) => KNOBS.find((k) => k.key === key)!;

// App root: keeps the CSS variables in step with the knobs. (KNOBS is a
// constant list, so calling the hook per knob is a fixed number of hooks.)
export function useLookKnobs(): void {
  const vals = KNOBS.map((k) => useKnob(k)[0]); // eslint-disable-line react-hooks/rules-of-hooks
  const key = vals.join(",");
  useEffect(() => {
    const root = document.documentElement;
    KNOBS.forEach((k, i) => root.style.setProperty(k.cssVar, k.css(vals[i])));
    root.toggleAttribute("data-cards-translucent", vals[0] < 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key carries the values
  }, [key]);
}
