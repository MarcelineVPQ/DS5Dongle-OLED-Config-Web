// Color vision: palettes that stay distinguishable with the common kinds of
// colour blindness, from the Okabe–Ito set used for scientific figures.
// "standard" keeps the app's own colours (and its light/dark/desktop themes);
// the others replace the meaning-carrying colours inside the app window:
// status (good, warning, bad) and the gyro/accelerometer X/Y/Z lines.
// Desktop elements (the tray icon, the desktop theme's colours) are left
// alone.
// Colour never carries meaning alone anyway (line patterns, ⚠ markers,
// shapes), so this is an extra, not the only safeguard. Kept per computer.
import { useSyncExternalStore } from "react";
import { readPref, writePref } from "./storage";
import { contrast, hexToRgb, type Rgb } from "./theme/desktopPalette";

// Named like games name them. Protanopia and deuteranopia (both red-green)
// share one palette: Okabe–Ito is designed for both.
export type ColorVision = "standard" | "protanopia" | "deuteranopia" | "tritanopia";
export const COLOR_VISIONS: readonly ColorVision[] = ["standard", "protanopia", "deuteranopia", "tritanopia"];

interface Palette {
  // A pressed button on the controller drawing (the drawing itself keeps the
  // controller's real colours: that's how the player sees it in real life).
  press: string;
  good: string;
  warn: string;
  bad: string;
  muted: string;
  axis: [string, string, string]; // X, Y, Z
}

export const PALETTES: Record<ColorVision, Palette> = {
  standard: { press: "#22c55e", good: "#22c55e", warn: "#f59e0b", bad: "#ef4444", muted: "#64748b", axis: ["#f43f5e", "#22c55e", "#3b82f6"] },
  // Red-green: no red against green; blue vs vermilion.
  protanopia: { press: "#56b4e9", good: "#0072b2", warn: "#e69f00", bad: "#d55e00", muted: "#64748b", axis: ["#d55e00", "#56b4e9", "#cc79a7"] },
  deuteranopia: { press: "#56b4e9", good: "#0072b2", warn: "#e69f00", bad: "#d55e00", muted: "#64748b", axis: ["#d55e00", "#56b4e9", "#cc79a7"] },
  // Blue-yellow: no blue against green or yellow against violet.
  tritanopia: { press: "#ffffff", good: "#009e73", warn: "#cc79a7", bad: "#d55e00", muted: "#64748b", axis: ["#d55e00", "#009e73", "#cc79a7"] },
};

// Line patterns for X, Y, Z (solid, dashed, dotted), in every mode.
export const AXIS_DASH: ReadonlyArray<number[]> = [[], [6, 4], [1.5, 3]];

const KEY = "ds5.colorVision";
const stored = readPref(KEY);
let current: ColorVision = stored && (COLOR_VISIONS as readonly string[]).includes(stored) ? (stored as ColorVision) : "standard";
const listeners = new Set<() => void>();

// Standard sets nothing: the theme's own colours apply (CSS falls back).
function apply(): void {
  const root = document.documentElement;
  root.dataset.cv = current;
  const p = PALETTES[current];
  for (const [name, value] of [
    ["press", p.press],
    ["good", p.good],
    ["warn", p.warn],
    ["bad", p.bad],
  ] as const) {
    if (current === "standard") root.style.removeProperty(`--cv-${name}`);
    else root.style.setProperty(`--cv-${name}`, value);
  }
  // Text on these status colors: the ink that reads on all three.
  if (current === "standard") root.style.removeProperty("--cv-on-status");
  else {
    const worst = (ink: Rgb) => Math.min(...[p.good, p.warn, p.bad].map((c) => contrast(ink, hexToRgb(c))));
    root.style.setProperty("--cv-on-status", worst([255, 255, 255]) >= worst([0, 0, 0]) ? "#ffffff" : "#000000");
  }
  p.axis.forEach((c, i) => root.style.setProperty(`--cv-axis-${i}`, c));
}
apply();

export function setColorVision(next: ColorVision): void {
  current = next;
  writePref(KEY, next);
  apply();
  listeners.forEach((l) => l());
}

export function colorVision(): ColorVision {
  return current;
}

export function useColorVision(): ColorVision {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
