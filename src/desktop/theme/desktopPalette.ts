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

// Push `fg` toward white (dark bg) or black (light bg) until it reaches the
// target contrast against `bg`. Keeps the hue; only as far as needed.
export function ensureContrast(fg: Rgb, bg: Rgb, target: number): Rgb {
  if (contrast(fg, bg) >= target) return fg;
  const toward: Rgb = luminance(bg) < 0.4 ? [255, 255, 255] : [0, 0, 0];
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

  if (p.source === "kde" && p.window && p.windowText) {
    const page = p.view ?? p.window;
    const pageText = p.viewText ?? p.windowText;
    const panel = p.window;
    const button = p.button ?? panel;
    const muted = ensureContrast(p.inactiveText ?? mix(pageText, page, 0.4), panel, 4.5);
    const border = mix(panel, pageText, p.isDark ? 0.14 : 0.16);
    Object.assign(vars, {
      "--bg-page": css(page),
      "--bg-panel": css(panel),
      "--bg-elevated": css(panel),
      "--bg-inset": css(mix(panel, page, 0.5)),
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
  const accent = p.accent;
  const onAccent: Rgb = contrast([255, 255, 255], accent) >= contrast([0, 0, 0], accent) ? [255, 255, 255] : [0, 0, 0];
  const selBg = mix(panel, accent, p.isDark ? 0.22 : 0.16);
  Object.assign(vars, {
    "--dk-accent": css(accent),
    "--dk-accent-hover": css(mix(accent, p.isDark ? [255, 255, 255] : [0, 0, 0], 0.15)),
    "--dk-on-accent": css(onAccent),
    "--dk-sel-bg": css(selBg),
    "--dk-sel-border": css(accent),
    "--dk-sel-text": css(ensureContrast(accent, selBg, 4.5)),
    "--dk-focus": css(accent),
    // The web components (Remap editor) use the shared accent tokens.
    "--accent": css(accent),
    "--accent-hover": css(mix(accent, [0, 0, 0], 0.15)),
    "--accent-border": css(accent),
    "--text-on-primary": css(onAccent),
  });
  return vars;
}
