// The color picker's math: hex <-> RGB <-> HSV, parsing what people type, and
// the short list of recent colors. Values out are always "#rrggbb" (lower
// case), the same as the native <input type="color"> gave.

export type Rgb = [number, number, number];
// Hue 0..360 (degrees), saturation and value 0..1.
export type Hsv = { h: number; s: number; v: number };

export const clamp = (x: number, lo: number, hi: number): number => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);
const byte = (x: number) => Math.round(clamp(x, 0, 255));

export function rgbToHex(rgb: readonly number[]): string {
  // loop: HOT-PATH-OK — N = 3 channels
  return `#${rgb
    .slice(0, 3)
    .map((c) => byte(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

// "#abc", "abc", "#aabbcc" or "aabbcc" (any case, spaces around ignored) ->
// RGB; anything else -> null.
export function parseHex(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  // loop: HOT-PATH-OK — N = 3 characters of a short hex
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  // loop: HOT-PATH-OK — N = 3 channels
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

// A hex value as the picker hands it on ("#rrggbb"), or null if it isn't one.
export const normalizeHex = (text: string): string | null => {
  const rgb = parseHex(text);
  return rgb ? rgbToHex(rgb) : null;
};

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
  const hh = ((clamp(h, -1e9, 1e9) % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const vv = clamp(v, 0, 1);
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [byte((r + m) * 255), byte((g + m) * 255), byte((b + m) * 255)];
}

export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

// The HSV to show for a hex value, keeping the hue (and saturation) the
// picker had when the color is grey or black, where they're undefined; so
// dragging to a corner doesn't make the hue slider jump.
export function hsvFromHex(hex: string, previous?: Hsv): Hsv {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const next = rgbToHsv(rgb);
  if (!previous) return next;
  if (hsvToHex(previous) === rgbToHex(rgb)) return previous;
  if (next.v === 0) return { h: previous.h, s: previous.s, v: 0 };
  if (next.s === 0) return { h: previous.h, s: 0, v: next.v };
  return next;
}

// One channel typed into an R / G / B field: a whole number 0..255, or null.
export function parseChannel(text: string): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const n = Number(text);
  return n <= 255 ? n : null;
}

// Recent colors: newest first, no repeats, at most `max`.
export const RECENT_MAX = 8;
export function addRecent(list: readonly string[], hex: string, max = RECENT_MAX): string[] {
  const h = normalizeHex(hex);
  if (!h) return [...list];
  return [h, ...list.filter((c) => c !== h)].slice(0, max);
}

// The stored list (comma-separated), with anything that isn't a color dropped.
export function parseRecent(raw: string | null, max = RECENT_MAX): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const h = normalizeHex(part);
    if (h && !out.includes(h)) out.push(h);
  }
  return out.slice(0, max);
}
