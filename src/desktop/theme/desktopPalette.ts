// "Match desktop" theme. The main process reads the desktop's colors (KDE's
// kdeglobals; elsewhere just the system accent) and the renderer maps them onto
// the app's CSS tokens here. Pure functions, unit-tested.

export type Rgb = [number, number, number];

export interface DesktopPalette {
  // "kde": a full color scheme. "accent": only an accent color (Windows, macOS,
  // GNOME via the portal), layered on the built-in light/dark theme.
  source: "kde" | "accent";
  isDark: boolean;
  accent: Rgb;
  window?: Rgb;
  windowText?: Rgb;
  view?: Rgb;
  viewText?: Rgb;
  button?: Rgb;
  buttonText?: Rgb;
  inactiveText?: Rgb;
}

// --- kdeglobals ---------------------------------------------------------------

type Ini = Record<string, Record<string, string>>;

function parseIni(text: string): Ini {
  const out: Ini = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1];
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0 && section) out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function rgb(value: string | undefined): Rgb | undefined {
  const m = value?.match(/^(\d{1,3}),(\d{1,3}),(\d{1,3})/);
  if (!m) return undefined;
  const c = [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb;
  return c.every((v) => v <= 255) ? c : undefined;
}

// Null when the file has no usable color scheme (e.g. a fresh account).
export function parseKdeGlobals(text: string): DesktopPalette | null {
  const ini = parseIni(text);
  const win = ini["Colors:Window"] ?? {};
  const view = ini["Colors:View"] ?? {};
  const button = ini["Colors:Button"] ?? {};
  const selection = ini["Colors:Selection"] ?? {};
  const window = rgb(win.BackgroundNormal);
  const windowText = rgb(win.ForegroundNormal);
  if (!window || !windowText) return null;
  const accent = rgb(ini.General?.AccentColor) ?? rgb(selection.BackgroundNormal) ?? rgb(view.DecorationFocus) ?? [61, 174, 233];
  return {
    source: "kde",
    isDark: luminance(window) < 0.4,
    accent,
    window,
    windowText,
    view: rgb(view.BackgroundNormal) ?? window,
    viewText: rgb(view.ForegroundNormal) ?? windowText,
    button: rgb(button.BackgroundNormal) ?? window,
    buttonText: rgb(button.ForegroundNormal) ?? windowText,
    inactiveText: rgb(win.ForegroundInactive) ?? rgb(view.ForegroundInactive),
  };
}

// --- color math ---------------------------------------------------------------

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

// #rrggbb, or a CSS rgb()/rgba() value, as Rgb (null if neither).
export function parseColor(value: string): Rgb | null {
  const v = value.trim();
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return /^#[0-9a-f]{6}$/i.test(v) ? hexToRgb(v) : null;
}
export const hexToRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

// HSV: hue 0..360 (degrees), saturation and value 0..1. The app's one RGB <->
// HSV conversion (the swirl's hue turns; the color picker's colorMath is to
// re-export these, quality pass F20/F23).
export type Hsv = { h: number; s: number; v: number };
const unit = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const byte = (x: number) => Math.round(unit(x / 255) * 255);

export function rgbToHsv([r, g, b]: readonly number[]): Hsv {
  const [rn, gn, bn] = [byte(r) / 255, byte(g) / 255, byte(b) / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
  const c = unit(v) * unit(s);
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = unit(v) - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [byte((r + m) * 255), byte((g + m) * 255), byte((b + m) * 255)];
}

// Whether white text reads better than black on `bg`. The one light/dark
// rule for ink, contrast pushes and the controller theme's shade.
export const wantsLightInk = (bg: Rgb) => contrast([255, 255, 255], bg) >= contrast([0, 0, 0], bg);

// Push `fg` toward white or black (whichever reads better on `bg`) until it
// reaches the target contrast against `bg`. Keeps the hue; only as far as
// needed; at worst that black or white itself.
// `toward` fixes the direction (a theme's own ink) when one color must work
// on several grounds.
export function ensureContrast(fg: Rgb, bg: Rgb, target: number, toward: Rgb = wantsLightInk(bg) ? [255, 255, 255] : [0, 0, 0]): Rgb {
  if (contrast(fg, bg) >= target) return fg;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(fg, toward, t);
    if (contrast(c, bg) >= target) return c;
  }
  return toward;
}

const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// CSS custom properties for documentElement. Status colors (connected green,
// warning amber, error red) are deliberately not touched: they carry meaning.
export function paletteToCssVars(p: DesktopPalette): Record<string, string> {
  const vars: Record<string, string> = {};

  // The surfaces accent and selection text is drawn on (only the panel is
  // known for an accent-only palette: the built-in theme draws the rest).
  let grounds: Rgb[] | undefined;
  if (p.source === "kde" && p.window && p.windowText) {
    const page = p.view ?? p.window;
    const pageText = p.viewText ?? p.windowText;
    const panel = p.window;
    const button = p.button ?? panel;
    const inset = mix(panel, page, 0.5);
    grounds = [page, panel, inset, button];
    const muted = ensureContrast(p.inactiveText ?? mix(pageText, page, 0.4), panel, 4.5);
    const border = mix(panel, pageText, p.isDark ? 0.14 : 0.16);
    Object.assign(vars, {
      "--bg-page": css(page),
      "--bg-panel": css(panel),
      "--bg-elevated": css(panel),
      "--bg-inset": css(inset),
      "--bg-segment": css(button),
      "--bg-input": css(button),
      "--text-strong": css(ensureContrast(pageText, panel, 7)),
      "--text-body": css(ensureContrast(p.windowText, panel, 7)),
      "--text-soft": css(ensureContrast(p.windowText, panel, 5.5)),
      "--text-muted": css(muted),
      "--text-eyebrow": css(muted),
      "--border-default": css(border),
      "--border-subtle": css(mix(panel, pageText, 0.08)),
      "--border-soft": css(mix(panel, pageText, 0.22)),
      "--border-input": css(mix(button, pageText, 0.2)),
      "--switch-off-bg": css(mix(button, pageText, 0.25)),
      "--switch-knob-bg": "#ffffff",
    });
  }

  const panel = p.window ?? (p.isDark ? ([27, 35, 54] as Rgb) : ([255, 255, 255] as Rgb));
  Object.assign(vars, accentVars(p.accent, panel, p.isDark, grounds));
  return vars;
}

// `fg` pushed toward `ink` until it reaches `target` on every ground (at
// worst the ink itself).
export function legibleOnAll(fg: Rgb, grounds: Rgb[], target: number, ink: Rgb): Rgb {
  let c = fg;
  for (let i = 0; i < 5 && grounds.some((g) => contrast(c, g) < target); i++) c = grounds.reduce((acc, g) => ensureContrast(acc, g, target, ink), c);
  return c;
}

// The accent tokens for one accent color on a given panel color (also used
// for the controller's own color, theme/controllerAccent.ts). `grounds`: the
// surfaces the accent and selection colors are drawn on as text (links on
// the page, cards and tiles too), each reaching 4.5:1 on all of them.
export function accentVars(accent: Rgb, panel: Rgb, isDark: boolean, grounds: Rgb[] = [panel]): Record<string, string> {
  const onAccent: Rgb = contrast([255, 255, 255], accent) >= contrast([0, 0, 0], accent) ? [255, 255, 255] : [0, 0, 0];
  const ink: Rgb = isDark ? [255, 255, 255] : [0, 0, 0];
  // The selection tint, kept dark (light) enough for its text to read: on a
  // mid-tone controller body the tint toward a light trim left no color
  // reaching 4.5:1 on it (checker, 2026-10-12).
  const selBg = ensureContrast(mix(panel, accent, isDark ? 0.22 : 0.16), ink, 4.6, isDark ? [0, 0, 0] : [255, 255, 255]);
  return {
    "--dk-accent": css(accent),
    // The accent as text (labels, values): readable on the panel whatever
    // the accent is (a desktop accent can be any color). 4.6, not 4.5: cards
    // drawn a shade off the panel (dashboard, game pages) otherwise land at
    // 4.49 (checker, 2026-10-12).
    "--dk-accent-text": css(legibleOnAll(accent, grounds, 4.6, ink)),
    "--dk-accent-hover": css(mix(accent, isDark ? [255, 255, 255] : [0, 0, 0], 0.15)),
    "--dk-on-accent": css(onAccent),
    "--dk-sel-bg": css(selBg),
    "--dk-sel-border": css(accent),
    "--dk-sel-text": css(legibleOnAll(accent, [selBg, ...grounds], 4.6, ink)),
    "--dk-focus": css(accent),
    // The web components (Remap editor) use the shared accent tokens.
    "--accent": css(accent),
    "--accent-hover": css(mix(accent, [0, 0, 0], 0.15)),
    "--accent-border": css(accent),
    "--text-on-primary": css(onAccent),
  };
}
