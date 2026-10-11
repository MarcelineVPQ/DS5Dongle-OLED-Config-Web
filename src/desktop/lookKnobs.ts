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
];

const values = (k: Knob) => Array.from({ length: Math.round((k.max - k.min) / k.step) + 1 }, (_, i) => String(k.min + i * k.step));

export function useKnob(k: Knob): [number, (v: number) => void] {
  const [v, set] = usePref<string>(`ds5.knob.${k.key}`, String(k.fallback), values(k));
  return [Number(v), (n) => set(String(Math.min(k.max, Math.max(k.min, Math.round(n / k.step) * k.step))))];
}

export const knob = (key: string) => KNOBS.find((k) => k.key === key)!;

// App root: keeps the CSS variables in step with the knobs.
export function useLookKnobs(): void {
  const [cards] = useKnob(KNOBS[0]);
  const [dim] = useKnob(KNOBS[1]);
  const [blur] = useKnob(KNOBS[2]);
  useEffect(() => {
    const root = document.documentElement;
    [cards, dim, blur].forEach((v, i) => root.style.setProperty(KNOBS[i].cssVar, KNOBS[i].css(v)));
    root.toggleAttribute("data-cards-translucent", cards < 100);
  }, [cards, dim, blur]);
}
