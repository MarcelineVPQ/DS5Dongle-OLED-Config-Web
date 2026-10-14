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
// ACCENT_OVERRIDES fixes any colorway the formula gets wrong. The player's own
// colors (customColors.ts) count as the controller's: their body color gives
// the accent, the shade and the Controller theme's surfaces.
import { useEffect, useSyncExternalStore } from "react";
import { colorway, type ColorwayColors } from "./colorways";
import { mergeColors, type CustomColors } from "./customColors";
import { accentVars, contrast, ensureContrast, hexToRgb as hex, legibleOnAll, mix, parseColor as parse, wantsLightInk, type Rgb } from "../theme/desktopPalette";

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

const chroma = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

function panelOf(el: Element): { panel: Rgb; isDark: boolean } {
  const panel = parse(getComputedStyle(el).getPropertyValue("--bg-panel")) ?? [27, 35, 54];
  return { panel, isDark: wantsLightInk(panel) };
}

// A game page's own look: its cards in the artwork's color (blended into the
// panel), text and accent made legible; the rest of the app keeps the
// controller's. Inline style object; null for grey art.
export function scopedAccent(color: string | null, el: Element | null): Record<string, string> | null {
  if (!color || !el) return null;
  // The panel color from outside the page: the page's own style holds the
  // previous result, which would be mixed in again on a recompute.
  const { panel } = panelOf(el.parentElement ?? el);
  const c = hex(color);
  if (chroma(c) < 40) return null; // grey art: keep the controller's look
  // The page's cards take the art's color, blended into the panel so it
  // isn't overpowering; text and accent follow the same rules as the theme.
  return surfacesFor(mix(panel, c, 0.45), c);
}

// The app-wide accent source: the controller's colorway (null = the theme's).
let controllerColor: string | null = null;
let controllerCode: string | null = null;
// The player's own colors while on (else null).
let customColors: CustomColors | null = null;

// The controller's colors: its colorway with the player's on top.
const colorsOf = (code: string | null, custom: CustomColors | null = customColors): ColorwayColors | null => mergeColors(colorway(code)?.colors ?? null, custom);

// The shown controller's colorway code, for the settings (null while unknown).
const codeListeners = new Set<() => void>();
const onCode = (l: () => void) => {
  codeListeners.add(l);
  return () => codeListeners.delete(l);
};
export const useControllerCode = (): string | null => useSyncExternalStore(onCode, () => controllerCode);

// The controller's shade, for the "Controller" theme: a light colorway (White,
// Pearl, Silver, Starlight Blue) gives a light app, any other a dark one;
// null while no colorway is known (the theme then follows the system).
let shade: "light" | "dark" | null = null;
const shadeListeners = new Set<() => void>();
export const controllerShade = () => shade;
export function onControllerShade(l: () => void): () => void {
  shadeListeners.add(l);
  return () => shadeListeners.delete(l);
}
function setShade(code: string | null): void {
  const body = colorsOf(code)?.body;
  // Same rule as the ink on its surfaces (surfacesFor), so a mid-tone
  // colorway never gets a dark theme with black text.
  const next = body ? (wantsLightInk(hex(body)) ? "dark" : "light") : null;
  if (next === shade) return;
  shade = next;
  shadeListeners.forEach((l) => l());
}

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

// Whether a colorway has a color of its own to give (not white/black/grey).
export function hasColorwayColor(code: string | null): boolean {
  const c = colorwayAccent(code);
  return !!c && (ACCENT_OVERRIDES[code ?? ""] !== undefined || chroma(hex(c)) >= 40);
}

// The controller's accent color (#rrggbb) for a colorway code, or null.
export function colorwayAccent(code: string | null, custom: CustomColors | null = customColors): string | null {
  // The player's own body color: the accent unless it's a neutral.
  if (custom?.body) return chroma(hex(custom.body)) >= 40 ? custom.body : null;
  if (!code) return null;
  const override = ACCENT_OVERRIDES[code];
  if (override === null) return null;
  return override ?? colorway(code)?.colors?.body ?? null;
}

// Surfaces tinted toward the controller's color: a little on the page and
// panels, a bit more on borders. Text tokens are left alone, so their
// contrast holds (the tint is too small to matter for it), except the
// warning text (WARN_TEXT): the light theme's amber has little to spare (the
// filled rating star fell to 4.47:1 on a panel tinted dark blue, dev.7 gate).
const SURFACES: Array<[string, number]> = [
  ["--bg-page", 0.07],
  ["--bg-panel", 0.06],
  ["--bg-elevated", 0.06],
  ["--bg-inset", 0.05],
  ["--bg-segment", 0.06],
  ["--border-default", 0.12],
  ["--border-subtle", 0.1],
];
const WARN_TEXT = "--text-warn";

// The other themes' tokens for the controller's color (not the Controller
// theme): the surfaces tinted toward it, the accent made legible on the
// theme's panel, accent and selection text on every tinted surface. `base`:
// the theme's own tokens, without our layer. Pure, so the UI checker
// (tools/colorway_contrast.mjs) computes colorways with it.
export function accentTokens(color: string, base: Record<string, Rgb | null | undefined>): Record<string, string> {
  const panel = base["--bg-panel"] ?? [27, 35, 54];
  const isDark = wantsLightInk(panel);
  const accent = legibleAccent(color, panel, isDark, true) ?? hex(color); // allowNeutral: never null
  const tint = hex(color);
  const tinted = SURFACES.flatMap(([name, t]) => (base[name] ? [[name, mix(base[name], tint, t)] as const] : []));
  const grounds = tinted.filter(([name]) => name.startsWith("--bg-")).map(([, c]) => c);
  const on = grounds.length ? grounds : [panel];
  return { ...Object.fromEntries(tinted.map(([name, c]) => [name, `rgb(${c.join(", ")})`])), ...warnText(base, on), ...accentVars(accent, panel, isDark, on) };
}

// The theme's warning text, made legible on every surface it sits on (pushed
// toward the theme's ink). Also without a colorway accent: Color vision's
// warning colors (e.g. #e69f00) are only ~2:1 on the Light theme's panels.
export function warnText(base: Record<string, Rgb | null | undefined>, grounds?: Rgb[]): Record<string, string> {
  const warn = base[WARN_TEXT];
  if (!warn) return {};
  const panel = base["--bg-panel"] ?? [27, 35, 54];
  const on = grounds ?? SURFACES.flatMap(([name]) => (name.startsWith("--bg-") && base[name] ? [base[name]] : []));
  const ink: Rgb = wantsLightInk(panel) ? [255, 255, 255] : [0, 0, 0];
  return { [WARN_TEXT]: `rgb(${legibleOnAll(warn, on.length ? on : [panel], 4.5, ink).join(", ")})` };
}

// The "Controller" theme's surfaces: cards and panels in the controller's
// own body color, text black or white (whichever reads), the accent the
// colorway's line color made legible on that body.
export function controllerSurfaces(code: string | null, custom: CustomColors | null = customColors): Record<string, string> | null {
  const c = colorsOf(code, custom);
  return c ? surfacesFor(hex(c.body), hex(c.line)) : null;
}

// Card and panel surfaces in one color, text black or white (whichever
// reads), the accent `trim` made legible on it. Shared by the controller
// theme and game pages.
function surfacesFor(body: Rgb, trim: Rgb): Record<string, string> {
  const dark = wantsLightInk(body); // light text on it
  const ink: Rgb = dark ? [255, 255, 255] : [0, 0, 0];
  const css = (x: Rgb) => `rgb(${x.join(", ")})`;
  // Insets (tiles, inputs, segments, buttons) step AWAY from the ink, so text
  // on them reads at least as well as on the body (stepping toward it made
  // white text on a mid-tone game color fall to ~3.9:1). Borders step toward
  // the ink, to show.
  const away: Rgb = dark ? [0, 0, 0] : [255, 255, 255];
  const inset = mix(body, away, 0.12);
  const segment = mix(body, away, 0.18);
  const input = mix(body, away, 0.15);
  const grounds = [body, inset, segment, input];
  // Always pushed toward the ink: at worst the ink itself (the best this body allows).
  const legible = (c: Rgb, target: number) => grounds.reduce((acc, g) => ensureContrast(acc, g, target, ink), c);
  const text = (target: number, soften: number) => css(legible(mix(ink, body, soften), target));
  const accent = ensureContrast(trim, body, 3);
  // Errors and danger buttons: red, made legible on these surfaces too.
  const error = legible(dark ? [253, 164, 175] : [159, 18, 57], 4.5);
  // Warning-colored text (dashboard counters): amber, made legible the same way.
  const warn = legible(dark ? [252, 211, 77] : [146, 64, 14], 4.5);
  return {
    "--bg-panel": css(body),
    "--bg-elevated": css(body),
    "--bg-inset": css(inset),
    "--bg-segment": css(segment),
    "--bg-input": css(input),
    "--border-default": css(mix(body, ink, 0.22)),
    "--border-subtle": css(mix(body, ink, 0.14)),
    "--border-soft": css(mix(body, ink, 0.3)),
    "--border-input": css(mix(body, ink, 0.3)),
    "--switch-off-bg": css(mix(body, ink, 0.3)),
    "--text-strong": text(7, 0),
    "--text-body": text(7, 0.05),
    "--text-soft": text(5.5, 0.15),
    "--text-muted": text(4.5, 0.3),
    "--text-eyebrow": text(4.5, 0.3),
    "--text-error": css(error),
    "--text-warn": css(warn),
    ...accentVars(accent, body, dark, grounds),
  };
}

// Told whenever the app's surfaces change (a game page re-mixes its own).
const accentListeners = new Set<() => void>();
export function onAccentChange(l: () => void): () => void {
  accentListeners.add(l);
  return () => accentListeners.delete(l);
}
const changed = () => accentListeners.forEach((l) => l());

// The one theme watcher for canvases and other readers of the tokens (spark
// lines, the swirl, a game page's accent): calls `l` whenever any theme input
// may have changed. The theme, the controller theme and Color vision set
// attributes and inline tokens on <html>, Match desktop and the accent set
// <style> elements in <head>, and System follows the OS's light/dark.
const THEME_ATTRS = ["style", "class", "data-theme", "data-controller-theme", "data-cv", "data-glass"];
export function onThemeChange(l: () => void): () => void {
  // lifetime: OK — disconnected by the unsubscribe onThemeChange returns
  const mo = new MutationObserver(() => l());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
  mo.observe(document.head, { childList: true, subtree: true, characterData: true });
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  // lifetime: OK — removed by the unsubscribe onThemeChange returns
  scheme.addEventListener("change", l);
  const off = onAccentChange(l);
  return () => {
    mo.disconnect();
    scheme.removeEventListener("change", l);
    off();
  };
}

export function applyAccent(): void {
  const old = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  // Read the theme's own tokens, without our tint (else it compounds).
  if (old) old.disabled = true;
  const root = document.querySelector(".dk") ?? document.documentElement;
  const cs = getComputedStyle(root);
  const base = Object.fromEntries([...SURFACES.map(([name]) => name), WARN_TEXT].map((name) => [name, parse(cs.getPropertyValue(name))]));
  if (old) old.disabled = false;
  const full = document.documentElement.hasAttribute("data-controller-theme") ? controllerSurfaces(controllerCode) : null;
  if (full) {
    const text = `html:root, html:root .dk { ${Object.entries(full)
      .map(([k, v]) => `${k}: ${v} !important;`)
      .join(" ")} }`;
    if (old?.textContent === text) return;
    const el = old ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
    el.textContent = text;
    changed();
    return;
  }
  // Sets the accent tokens (or, without a colorway accent, only the legible
  // warning text). Wins over the desktop palette's !important tokens by
  // specificity.
  const body = Object.entries(controllerColor ? accentTokens(controllerColor, base) : warnText(base))
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(" ");
  const text = `html:root, html:root .dk { ${body} }`;
  if (old?.textContent === text) return; // unchanged: don't touch the DOM (the theme observer would loop)
  const el = old ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  el.textContent = text;
  changed();
}

export const ACCENT_KEY = "ds5.accent";
export const ACCENTS = ["controller", "desktop"] as const;

// App root: the controller layer, and reapplying when the theme changes.
export function useControllerAccent(code: string | null, choice: (typeof ACCENTS)[number], custom: CustomColors | null = null): void {
  // lifetime: OK — acquires nothing (sets the accent tokens)
  useEffect(() => {
    customColors = custom;
    setShade(code);
    if (controllerCode !== code) {
      controllerCode = code;
      codeListeners.forEach((l) => l());
    }
    controllerColor = choice === "controller" ? colorwayAccent(code) : null;
    applyAccent();
  }, [code, choice, custom]);
  // lifetime: OK — cleanup: disconnects the observer and removes the scheme listener
  useEffect(() => {
    // lifetime: OK — disconnected in the effect cleanup (one, at the app root)
    const mo = new MutationObserver(applyAccent);
    // data-cv: Color vision swaps the warning amber the warning text is made from.
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-controller-theme", "data-cv"] });
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    // System follows the OS's light/dark: the tokens change with no DOM change.
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    // lifetime: OK — removed in the effect cleanup
    scheme.addEventListener("change", applyAccent);
    return () => {
      mo.disconnect();
      scheme.removeEventListener("change", applyAccent);
    };
  }, []);
}
