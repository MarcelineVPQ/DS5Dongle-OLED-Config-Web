// Colorway contrast, computed instead of rendered (tools/check_layout.mjs).
//
// A colorway only changes colors, never layout, and every color it changes
// is a theme token the app computes from it (controllerAccent.ts: the
// Controller theme's surfaces, text and accent; in the other themes the
// accent and a tint of the surfaces). So instead of re-rendering every view
// for every colorway, the checker:
//   1. learns which token pairs the UI really draws (text token on ground
//      token, with the WCAG target), from the contrast renders it does
//      anyway: each judged text element is fingerprinted by setting every
//      color token to a unique sentinel for a moment (fingerprintProbe);
//   2. computes every colorway's tokens in every theme with the app's own
//      functions (bundled from src/ with esbuild) on the theme's own base
//      tokens (read from the app, harvestExpr), and checks those pairs;
//   3. checks the computed ratios against the rendered ones wherever a
//      render showed a colorway (the simulated dongle's Cosmic Red in every
//      theme, plus a few sanity renders per model): a disagreement means the
//      computed path no longer matches the app, and fails the run.
// The drawing's outlines (on the body, caps, black parts, sticks) are checked
// per model too; the drawing itself is never judged by the rendered probe.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;

// The app's color functions, bundled from src/ (react etc. stay external and
// resolve from node_modules).
export async function loadColorwayMath() {
  const entry = `
    export { COLORWAYS, EDGE_COLORWAYS, colorway, drawingColors, lineOnDark } from "./src/desktop/live/colorways";
    export { accentTokens, controllerSurfaces, legibleAccent, colorwayAccent } from "./src/desktop/live/controllerAccent";
    export { mergeColors } from "./src/desktop/live/customColors";
    export { accentVars, contrast, mix, parseColor, hexToRgb, wantsLightInk } from "./src/desktop/theme/desktopPalette";
  `;
  const out = await build({ stdin: { contents: entry, resolveDir: ROOT, loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", write: false, logLevel: "silent" });
  const dir = join(ROOT, "tmp/check");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "colorway-math.mjs");
  writeFileSync(file, out.outputFiles[0].text);
  return import(`${pathToFileURL(file).href}?${Date.now()}`);
}

// Every custom property the app's styles or color code define: the
// candidates for fingerprinting (the page keeps the ones holding a color).
export function tokenNames() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.css$/.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/(--[a-z][\w-]*)\s*:/g)) names.add(m[1]);
      else if (/\.tsx?$/.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/"(--[a-z][\w-]*)"/g)) names.add(m[1]);
    }
  };
  walk(join(ROOT, "src"));
  return [...names].sort();
}

// In the page: the theme's own token values (without the controller layer),
// and the theme's shade (data-theme).
export const harvestExpr = (names) => `(() => {
  const layer = document.getElementById("ds5-controller-accent");
  if (layer) layer.disabled = true;
  const root = document.querySelector(".dk") ?? document.documentElement;
  const cs = getComputedStyle(root);
  const out = {};
  for (const n of ${JSON.stringify(names)}) { const v = cs.getPropertyValue(n).trim(); if (/^(#[0-9a-f]{3,8}|rgba?\\()/i.test(v)) out[n] = v; }
  if (layer) layer.disabled = false;
  return { tokens: out, shade: document.documentElement.getAttribute("data-theme") };
})()`;

// In the page, after the contrast probe has judged `entries` ([{ el, bgNode }]):
// which token each one's text and ground color comes from. Every color token
// gets a unique sentinel color for a moment, at the root (so tokens defined
// from others follow, and literal colors stay literal).
export const FINGERPRINT_FN = `(entries, names) => {
  const cs = getComputedStyle(document.querySelector(".dk") ?? document.documentElement);
  const colorTokens = names.filter((n) => /^(#[0-9a-f]{3,8}|rgba?\\()/i.test(cs.getPropertyValue(n).trim()));
  const sentinel = (k) => [1, 3 + (k % 250), 2 + Math.floor(k / 250)];
  const byColor = new Map(colorTokens.map((n, k) => [sentinel(k).join(","), n]));
  const style = document.createElement("style");
  style.textContent = "html:root:root:root, html:root:root:root .dk { " + colorTokens.map((n, k) => n + ": rgb(" + sentinel(k).join(", ") + ") !important;").join(" ") + " }";
  document.head.append(style);
  const key = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number).join(",");
  // Text inside an element that sets color tokens inline (a game page in its
  // artwork's colors, scopedAccent) isn't colored by the colorway: left out.
  const tokenSet = new Set(colorTokens);
  const scoped = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) if (n.style && [...n.style].some((p) => tokenSet.has(p))) return true; return false; };
  const out = entries.map(({ el, bgNode }) => scoped(el) ? [null, null] : [byColor.get(key(getComputedStyle(el).color)) ?? null, byColor.get(key(getComputedStyle(bgNode).backgroundColor)) ?? null]);
  style.remove();
  return out;
}`;

// One controller color source: a colorway code (and model) or the player's
// own colors on top of one.
//   { code: "04", model: "dualsense", custom: null, label: "04 Galactic Purple" }
export function colorSources(m, { customs = true } = {}) {
  const list = Object.entries(m.COLORWAYS).map(([code, c]) => ({ code, model: "dualsense", custom: null, label: `${code} ${c.name}` }));
  for (const [code, c] of Object.entries(m.EDGE_COLORWAYS)) list.push({ code, model: "edge", custom: null, label: `edge ${code} ${c.name}` });
  if (customs) for (const body of customBodies()) list.push({ code: null, model: "dualsense", custom: { body }, label: `custom body ${body}` });
  return list;
}

// Player's own body colors to try: 12 hues at three lightnesses, and greys.
function customBodies() {
  const hex = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };
  const out = [];
  for (let h = 0; h < 360; h += 30) for (const l of [0.3, 0.5, 0.7]) out.push(hex(h, 0.8, l));
  out.push("#555555", "#808080", "#aaaaaa");
  return out;
}

// The tokens the app shows for a theme and controller colors, from the
// theme's base tokens (harvested per theme / shade). null: this source
// changes nothing in this theme (a neutral colorway keeps the theme accent).
//   base: { "light": {...}, "dark": {...}, "desktop": {...}, "controller/dark": {...} }
export function tokensFor(m, base, theme, src) {
  const colors = m.mergeColors(m.colorway(src.code)?.colors ?? null, src.custom);
  if (theme === "controller") {
    const full = m.controllerSurfaces(src.code, src.custom);
    if (!full || !colors) return null;
    const shade = m.wantsLightInk(m.hexToRgb(colors.body)) ? "dark" : "light";
    const b = base[`controller/${shade}`] ?? base[shade];
    return b ? { ...b, ...full } : undefined;
  }
  const b = base[theme];
  if (!b) return undefined;
  const color = m.colorwayAccent(src.code, src.custom);
  if (!color) return null;
  // The app's own function (controllerAccent.ts), on the theme's base tokens.
  const rgb = Object.fromEntries(Object.entries(b).map(([n, v]) => [n, m.parseColor(v)]));
  return { ...b, ...m.accentTokens(color, rgb) };
}

// Where a literal color seen in a render applies: the theme, and the
// Controller theme's shade for these colors.
function themeKey(m, theme, src) {
  if (theme !== "controller") return theme;
  const colors = m.mergeColors(m.colorway(src.code)?.colors ?? null, src.custom);
  return colors ? `controller/${m.wantsLightInk(m.hexToRgb(colors.body)) ? "dark" : "light"}` : "controller";
}

const ratioOf = (m, tokens, fg, bg) => {
  const f = tokens[fg] ?? (fg.startsWith("rgb") ? fg : null);
  const g = tokens[bg] ?? (bg.startsWith("rgb") ? bg : null);
  return f && g ? m.contrast(m.parseColor(f), m.parseColor(g)) : null;
};

// Collects the fingerprinted text elements of the contrast renders. The pairs
// found in one theme's render are checked in every theme too (CSS rules name
// tokens, not themes), so the fast plan needs each view only once per style.
export class ColorwayCheck {
  constructor() {
    this.base = {};
    this.samples = []; // { theme, src, fg, bg, need, got, where }
    this.unmapped = 0;
  }
  // The theme's own tokens, read in a standard-style render.
  addBase(theme, { tokens, shade }) {
    const key = theme === "controller" ? `controller/${shade}` : theme;
    this.base[key] ??= tokens;
  }
  // One render's judged elements: [{ fgTok, bgTok, fg, bg, need, got, text }]
  add(theme, src, judged, where) {
    for (const j of judged) {
      if (!j.fgTok && !j.bgTok) {
        this.unmapped++;
        continue;
      }
      this.samples.push({ theme, src, fg: j.fgTok ?? j.fg, bg: j.bgTok ?? j.bg, literal: !j.fgTok || !j.bgTok, need: j.need, got: j.got, where: `${where}: ${j.text}` });
    }
  }
  // The pairs the UI draws: "fg|bg|need|where" -> an example. A pair of two
  // tokens holds in every theme; one with a literal color (text over a
  // fixed color, or a fixed color on a token) only where it was seen: that
  // theme, and for the Controller theme that shade.
  pairs(m) {
    const out = new Map();
    for (const s of this.samples) {
      const k = `${s.fg}|${s.bg}|${s.need}|${s.literal ? themeKey(m, s.theme, s.src) : "*"}`;
      if (!out.has(k)) out.set(k, s.where);
    }
    return out;
  }
  // Rendered vs computed ratios, wherever a render showed a colorway.
  agreement(m, tolerance = 0.05) {
    const off = [];
    let compared = 0;
    for (const s of this.samples) {
      const tokens = tokensFor(m, this.base, s.theme, s.src);
      if (!tokens) continue;
      const r = ratioOf(m, tokens, s.fg, s.bg);
      if (r === null) continue;
      compared++;
      if (Math.abs(r - s.got) > tolerance) off.push({ kind: `computed ${r.toFixed(2)} vs rendered ${s.got.toFixed(2)} (${s.theme}, ${s.src.label}, ${s.fg} on ${s.bg})`, text: s.where });
    }
    return { compared, off };
  }
  // Every source in every theme, on every pair the UI draws.
  findings(m, themes, sources) {
    const out = [];
    const pairs = this.pairs(m);
    let checked = 0;
    const missingBase = new Set();
    // The theme's own accent (a neutral colorway, or Accent: Desktop) first:
    // the token pairs found in any theme's render, in every theme.
    const own = { code: null, model: "dualsense", custom: null, label: "the theme's own accent" };
    for (const theme of themes)
      for (const src of theme === "controller" ? sources : [own, ...sources]) {
        const tokens = src === own ? this.base[theme] : tokensFor(m, this.base, theme, src);
        if (tokens === undefined) missingBase.add(theme);
        if (!tokens) continue;
        for (const [k, where] of pairs) {
          const [fg, bg, need, only] = k.split("|");
          if (only !== "*" && only !== (src === own ? theme : themeKey(m, theme, src))) continue;
          const r = ratioOf(m, tokens, fg, bg);
          if (r === null) continue;
          checked++;
          if (r < Number(need)) out.push({ kind: `contrast ${r.toFixed(2)} < ${need} (${fg} on ${bg})`, text: `${theme} ${src.label}, e.g. ${where}`, theme, src });
        }
      }
    return { out, checked, pairs: pairs.size, missingBase: [...missingBase] };
  }
}

// The drawing's outlines for every colorway of both models and the custom
// samples: 2:1 on the body and caps, 3:1 on the black parts, 2:1 on the
// sticks (the rule in colorways.ts; customs go through legibleLine).
export function drawingFindings(m, sources) {
  const out = [];
  for (const src of sources) {
    const c = m.mergeColors(m.drawingColors(src.code, src.model), src.custom);
    if (!c) continue;
    const dark = m.lineOnDark(c);
    for (const [line, ground, part, need] of [
      [c.line, c.body, "body", 2],
      [c.line, c.cap, "caps", 2],
      [dark, c.dark, "black parts", 3],
      [dark, c.stick, "sticks", 2],
    ]) {
      const r = m.contrast(m.hexToRgb(line), m.hexToRgb(ground));
      if (r < need) out.push({ kind: `outline ${r.toFixed(2)} < ${need} on the ${part}`, text: src.label });
    }
  }
  return out;
}
