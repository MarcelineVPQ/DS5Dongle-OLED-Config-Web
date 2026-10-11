// The app's look from the connected controller (App settings -> Look ->
// Accent): its colorway tints the surfaces and gives the accent, else the
// theme's own. One set of tokens (--dk-accent,
// --dk-sel-*...), so everything that uses the accent follows: buttons,
// selection, toggles, focus rings, the active rail item. A game page scopes
// the same tokens to itself with its artwork's color (scopedAccent). Legible first: the colorway's body color is lightened (dark theme) or
// darkened (light theme) until it reaches 3:1 against the panels (UI
// outlines), selection text gets 4.5:1 (accentVars), and button text is
// black or white, whichever reads better. Neutral colorways (white, black,
// grey, silver, pearl) have no color to give, so the theme's accent stays.
// ACCENT_OVERRIDES fixes any colorway the formula gets wrong.
import { useEffect } from "react";
import { colorway } from "./colorways";
import { accentVars, contrast, ensureContrast, mix, type Rgb } from "../theme/desktopPalette";

// Per-colorway accent, by the colorway code from the controller's serial.
// null = keep the theme accent.
export const ACCENT_OVERRIDES: Record<string, string | null> = {
  "00": null, // White
  "01": null, // Midnight Black
  "06": null, // Grey Camouflage
  "08": null, // Sterling Silver
  "12": null, // Chroma Pearl
};

const STYLE_ID = "ds5-controller-accent";

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const chroma = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

function panelOf(el: Element): { panel: Rgb; isDark: boolean } {
  const panel = parse(getComputedStyle(el).getPropertyValue("--bg-panel")) ?? [27, 35, 54];
  return { panel, isDark: contrast(panel, [0, 0, 0]) < contrast(panel, [255, 255, 255]) };
}

// The same accent tokens for one part of the page only (a game page takes its
// artwork's color; the rest of the app keeps the controller's), as an inline
// style object. null: not colorful enough, keep the inherited accent.
export function scopedAccent(color: string | null, el: Element | null): Record<string, string> | null {
  if (!color || !el) return null;
  const { panel, isDark } = panelOf(el);
  const accent = legibleAccent(color, panel, isDark);
  return accent ? accentVars(accent, panel, isDark) : null;
}

function parse(value: string): Rgb | null {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? hex(value.trim()) : null;
}

// The app-wide accent source: the controller's colorway (null = the theme's).
let controllerColor: string | null = null;

// A color made legible on this panel: lightened (dark theme) or darkened
// (light theme) to 3:1 against it; neutral colors (little chroma) give none.
export function legibleAccent(color: string, panel: Rgb, isDark: boolean, allowNeutral = false): Rgb | null {
  const base = hex(color);
  if (!allowNeutral && chroma(base) < 40) return null;
  const toward: Rgb = isDark ? [255, 255, 255] : [0, 0, 0];
  let c = base;
  for (let i = 0; i < 20 && contrast(c, panel) < 3; i++) c = mix(c, toward, 0.08);
  return ensureContrast(c, panel, 3);
}

// The controller's accent color (#rrggbb) for a colorway code, or null.
export function colorwayAccent(code: string | null): string | null {
  if (!code) return null;
  const override = ACCENT_OVERRIDES[code];
  if (override === null) return null;
  return override ?? colorway(code)?.colors?.body ?? null;
}

// Sets (or clears) the accent tokens from the highest source that's legible.
// Wins over the desktop palette's !important tokens by specificity.
// Surfaces tinted toward the controller's color: a little on the page and
// panels, a bit more on borders. Text tokens are left alone, so their
// contrast holds (the tint is too small to matter for it).
const SURFACES: Array<[string, number]> = [
  ["--bg-page", 0.07],
  ["--bg-panel", 0.06],
  ["--bg-elevated", 0.06],
  ["--bg-inset", 0.05],
  ["--bg-segment", 0.06],
  ["--border-default", 0.12],
  ["--border-subtle", 0.1],
];

export function applyAccent(): void {
  const old = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  // Read the theme's own tokens, without our tint (else it compounds).
  if (old) old.disabled = true;
  const root = document.querySelector(".dk") ?? document.documentElement;
  const { panel, isDark } = panelOf(root);
  const base = getComputedStyle(root);
  const surfaces = SURFACES.map(([name, t]) => [name, parse(base.getPropertyValue(name)), t] as const);
  if (old) old.disabled = false;
  const accent = controllerColor ? legibleAccent(controllerColor, panel, isDark, true) : null;
  if (!accent || !controllerColor) {
    old?.remove();
    return;
  }
  const tint = hex(controllerColor);
  const tinted = Object.fromEntries(surfaces.filter(([, v]) => v).map(([name, v, t]) => [name, `rgb(${mix(v!, tint, t).join(", ")})`]));
  const body = Object.entries({ ...tinted, ...accentVars(accent, panel, isDark) })
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(" ");
  const text = `html:root, html:root .dk { ${body} }`;
  if (old?.textContent === text) return; // unchanged: don't touch the DOM (the theme observer would loop)
  const el = old ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  el.textContent = text;
}

export const ACCENT_KEY = "ds5.accent";
export const ACCENTS = ["controller", "desktop"] as const;

// App root: the controller layer, and reapplying when the theme changes.
export function useControllerAccent(code: string | null, choice: (typeof ACCENTS)[number]): void {
  useEffect(() => {
    controllerColor = choice === "controller" ? colorwayAccent(code) : null;
    applyAccent();
  }, [code, choice]);
  useEffect(() => {
    const mo = new MutationObserver(applyAccent);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);
}
