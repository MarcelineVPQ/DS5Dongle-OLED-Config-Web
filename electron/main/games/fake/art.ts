// Developer card → Fake games: artwork drawn for the fake library, never
// copied from a store. Each game gets its own palette and pattern (picked from
// its title), drawn at the sizes the launchers keep on disk (Steam's 600x900
// cover and 1920x620 hero, 460x215 header, a transparent logo, a 32x32 icon;
// some stores' 300x450 covers), so the art protocol, the scaled copies
// (artThumbs.ts) and the art color run on real files. Pure pixels here (BGRA,
// what Electron's nativeImage takes); fake/service.ts encodes and writes them.
// The colors are fixed, not theme tokens: they are the games' own "box art".
import type { ArtKind } from "../../../../src/desktop/games/types";

export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array; // BGRA, row by row
}
type Rgb = readonly [number, number, number];

// [sky top, sky bottom, accent, title ink]
const PALETTES: ReadonlyArray<readonly [Rgb, Rgb, Rgb, Rgb]> = [
  [
    [18, 10, 48],
    [214, 48, 120],
    [255, 196, 60],
    [255, 244, 220],
  ],
  [
    [6, 32, 44],
    [22, 140, 150],
    [240, 250, 120],
    [235, 255, 250],
  ],
  [
    [40, 8, 8],
    [200, 64, 24],
    [255, 220, 120],
    [255, 240, 230],
  ],
  [
    [10, 18, 40],
    [60, 90, 200],
    [120, 230, 255],
    [230, 240, 255],
  ],
  [
    [16, 36, 16],
    [90, 170, 70],
    [250, 240, 160],
    [245, 255, 235],
  ],
  [
    [30, 12, 50],
    [120, 60, 200],
    [80, 255, 200],
    [240, 230, 255],
  ],
  [
    [50, 40, 20],
    [210, 160, 70],
    [90, 40, 20],
    [255, 248, 230],
  ],
  [
    [4, 4, 12],
    [40, 40, 70],
    [255, 80, 80],
    [250, 250, 255],
  ],
  [
    [60, 20, 40],
    [250, 140, 120],
    [255, 255, 200],
    [255, 245, 240],
  ],
  [
    [8, 40, 60],
    [240, 170, 90],
    [30, 60, 110],
    [255, 250, 240],
  ],
];
const STYLES = ["sun", "stripes", "rings", "bokeh", "grid"] as const;
export type ArtStyle = (typeof STYLES)[number];

// A small, stable hash (FNV-1a) and a generator seeded from it: the same
// title always draws the same picture.
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  // loop: NOT-WORTH — the title's characters, once per picture
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
function shapeRandom(seed: number): () => number {
  // xorshift32: plenty for picking shapes
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function artLook(title: string): { palette: number; style: ArtStyle } {
  const h = hash32(title);
  return { palette: h % PALETTES.length, style: STYLES[(h >>> 8) % STYLES.length] };
}

// ---- A 5x7 pixel font (upper case, digits, the punctuation titles use) ----
export const GLYPHS: Record<string, string> = {
  A: ".###.#...##...#######...##...##...#",
  B: "####.#...##...#####.#...##...#####.",
  C: ".###.#...##....#....#....#...#.###.",
  D: "###..#..#.#...##...##...##..#.###..",
  E: "######....#....####.#....#....#####",
  F: "######....#....####.#....#....#....",
  G: ".###.#...##....#.####...##...#.####",
  H: "#...##...##...#######...##...##...#",
  I: ".###...#....#....#....#....#...###.",
  J: "..###...#....#....#.#..#.#..#..##..",
  K: "#...##..#.#.#..##...#.#..#..#.#...#",
  L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##.#.##...##...##...#",
  N: "#...###..##.#.##..###...##...##...#",
  O: ".###.#...##...##...##...##...#.###.",
  P: "####.#...##...#####.#....#....#....",
  Q: ".###.#...##...##...##.#.##..#..##.#",
  R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.",
  T: "#####..#....#....#....#....#....#..",
  U: "#...##...##...##...##...##...#.###.",
  V: "#...##...##...##...##...#.#.#...#..",
  W: "#...##...##...##.#.##.#.##.#.#.#.#.",
  X: "#...##...#.#.#...#...#.#.#...##...#",
  Y: "#...##...#.#.#...#....#....#....#..",
  Z: "#####....#...#...#...#...#....#####",
  "0": ".###.#...##..###.#.###..##...#.###.",
  "1": "..#...##....#....#....#....#...###.",
  "2": ".###.#...#....#...#...#...#...#####",
  "3": "####.....#....#.###.....#....#####.",
  "4": "...#...##..#.#.#..#.#####...#....#.",
  "5": "######....####.....#....##...#.###.",
  "6": "..##..#...#....####.#...##...#.###.",
  "7": "#####....#...#...#...#....#....#...",
  "8": ".###.#...##...#.###.#...##...#.###.",
  "9": ".###.#...##...#.####....#...#..##..",
  ":": "......##...##........##...##.......",
  "'": "..#....#...#.......................",
  "-": "................###................",
  ".": "..........................##...##..",
  ",": ".........................##..#..#..",
  "&": ".##..#..#.#.#...#...#.#.##..#.##.##",
  "!": "..#....#....#....#....#.........#..",
  "?": ".###.#...#....#...#...#.........#..",
  "/": "....#....#...#...#...#...#....#....",
  " ": "",
};
const GW = 5;
const GH = 7;
const glyph = (c: string): string => GLYPHS[c] ?? GLYPHS[" "];
const isOn = (g: string, x: number, y: number): boolean => g[y * GW + x] === "#";

// Title words wrapped into lines of at most `max` characters (a longer word
// gets its own line).
export function wrapTitle(title: string, max: number): string[] {
  // loop: NOT-WORTH — the title's characters, once per picture
  const clean = [...title.toUpperCase()].map((c) => (c in GLYPHS ? c : c === "’" ? "'" : " ")).join("");
  const lines: string[] = [];
  let line = "";
  // loop: NOT-WORTH — the title's words, once per picture
  for (const word of clean.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// ---- Drawing ----
function canvas(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}
function blend(b: Bitmap, x: number, y: number, c: Rgb, a: number): void {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height || a <= 0) return;
  const i = (y * b.width + x) * 4;
  const d = b.data;
  const k = Math.min(1, a);
  const da = d[i + 3] / 255;
  const oa = k + da * (1 - k);
  // Over a transparent pixel (the logo) the color is taken as it is.
  const mix = (src: number, dst: number) => (oa === 0 ? 0 : Math.round((src * k + dst * da * (1 - k)) / oa));
  d[i] = mix(c[2], d[i]);
  d[i + 1] = mix(c[1], d[i + 1]);
  d[i + 2] = mix(c[0], d[i + 2]);
  d[i + 3] = Math.round(oa * 255);
}
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The background: a gradient and the game's pattern, in coordinates relative
// to the picture's short side, so a cover and a hero of the same game match.
function paintScene(b: Bitmap, title: string): void {
  const { palette, style } = artLook(title);
  const [top, bottom, accent] = PALETTES[palette];
  const r = shapeRandom(hash32(title + "#scene"));
  const w = b.width;
  const h = b.height;
  const unit = Math.min(w, h);
  const blobs = Array.from({ length: 14 }, () => ({ x: r() * w, y: r() * h, rad: unit * (0.04 + r() * 0.14), a: 0.08 + r() * 0.2 }));
  const horizon = h * (0.55 + r() * 0.12);
  const sun = { x: w * (0.3 + r() * 0.4), y: horizon - unit * 0.12, rad: unit * 0.28 };
  const ridges = Array.from({ length: 6 }, () => ({ p: r() * Math.PI * 2, f: 1 + r() * 4 }));
  const angle = r() * Math.PI;
  const d = b.data;
  // loop: NOT-WORTH — every pixel of one picture, drawn once per game and kind (the files are kept on disk)
  for (let y = 0; y < h; y++) {
    const gy = y / h;
    // loop: NOT-WORTH — every pixel of one picture, drawn once per game and kind (nested in the row loop above)
    for (let x = 0; x < w; x++) {
      let c: Rgb = lerp(top, bottom, gy);
      const u = x / unit;
      const v = y / unit;
      if (style === "sun") {
        const dist = Math.hypot(x - sun.x, y - sun.y);
        if (dist < sun.rad && y < horizon && Math.floor((sun.y + sun.rad - y) / (unit * 0.03)) % 3 !== 0) c = lerp(c, accent, 0.85);
        // loop: NOT-WORTH — 6 ridge waves per pixel, once per picture
        const ridge = horizon - unit * 0.05 * ridges.reduce((s, k) => s + Math.sin((x / w) * k.f * Math.PI * 2 + k.p), 0);
        if (y > ridge) c = lerp(top, bottom, 0.15 + 0.2 * ((y - ridge) / h));
      } else if (style === "stripes") {
        const t = u * Math.cos(angle) + v * Math.sin(angle);
        if (Math.floor(t * 9) % 2 === 0) c = lerp(c, accent, 0.18);
        if (Math.abs(((t * 9) % 2) - 1) < 0.04) c = lerp(c, accent, 0.6);
      } else if (style === "rings") {
        const dist = Math.hypot(x - sun.x, y - h * 0.4) / unit;
        if (Math.floor(dist * 14) % 2 === 0) c = lerp(c, accent, 0.22 * Math.max(0, 1 - dist));
      } else if (style === "grid" && y > horizon) {
        const depth = (y - horizon) / (h - horizon + 1);
        const gx = (x - w / 2) / (depth * unit + 1);
        if (Math.abs(gx % 0.5) < 0.02 || Math.abs(((depth * 12) % 1) - 0.5) < 0.04) c = lerp(c, accent, 0.7 * depth + 0.2);
      }
      const i = (y * w + x) * 4;
      d[i] = c[2];
      d[i + 1] = c[1];
      d[i + 2] = c[0];
      d[i + 3] = 255;
    }
  }
  if (style === "bokeh" || style === "rings")
    // loop: NOT-WORTH — 14 soft circles, once per picture
    for (const bl of blobs) disc(b, bl.x, bl.y, bl.rad, accent, bl.a);
}

function disc(b: Bitmap, cx: number, cy: number, rad: number, c: Rgb, a: number): void {
  // loop: NOT-WORTH — the circle's pixels, once per picture
  for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(b.height, Math.ceil(cy + rad)); y++)
    // loop: NOT-WORTH — the circle's pixels, once per picture (nested in the row loop above)
    for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(b.width, Math.ceil(cx + rad)); x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < rad) blend(b, x, y, c, a * Math.min(1, (rad - dist) / 2));
    }
}

function rect(b: Bitmap, x0: number, y0: number, w: number, h: number, c: Rgb, a: number): void {
  // loop: NOT-WORTH — the rectangle's pixels, once per picture
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(b.height, Math.ceil(y0 + h)); y++)
    // loop: NOT-WORTH — the rectangle's pixels, once per picture (nested in the row loop above)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(b.width, Math.ceil(x0 + w)); x++) blend(b, x, y, c, a);
}

// Text in the pixel font, centered on (cx, cy), `scale` pixels per font dot,
// with a dark outline so it reads on any background.
function text(b: Bitmap, lines: string[], cx: number, cy: number, scale: number, ink: Rgb, outline: Rgb): void {
  const lineH = (GH + 3) * scale;
  const top = cy - (lines.length * lineH - 3 * scale) / 2;
  const draw = (dx: number, dy: number, c: Rgb) =>
    // loop: NOT-WORTH — ≤ 4 lines of a title, once per picture
    lines.forEach((line, li) => {
      const left = cx - (line.length * (GW + 1) * scale - scale) / 2;
      // loop: NOT-WORTH — the line's characters x 35 font dots, once per picture
      [...line].forEach((ch, ci) => {
        const g = glyph(ch);
        // loop: NOT-WORTH — 7 font rows, once per character
        for (let gy = 0; gy < GH; gy++)
          // loop: NOT-WORTH — 5 font columns, once per character
          for (let gx = 0; gx < GW; gx++) if (isOn(g, gx, gy)) rect(b, left + (ci * (GW + 1) + gx) * scale + dx, top + li * lineH + gy * scale + dy, scale, scale, c, 1);
      });
    });
  const o = Math.max(1, Math.round(scale / 3));
  // loop: NOT-WORTH — 8 outline offsets, once per picture
  for (const [dx, dy] of [
    [-o, 0],
    [o, 0],
    [0, -o],
    [0, o],
    [-o, -o],
    [o, o],
    [-o, o],
    [o, -o],
  ])
    draw(dx, dy, outline);
  draw(0, 0, ink);
}

// The title's lines and font scale that fit `boxW` x `boxH`.
function fitTitle(title: string, boxW: number, boxH: number, maxChars: number): { lines: string[]; scale: number } {
  const lines = wrapTitle(title, maxChars);
  // loop: NOT-WORTH — ≤ 4 lines, once per picture
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byW = Math.floor(boxW / (longest * (GW + 1)));
  const byH = Math.floor(boxH / (lines.length * (GH + 3)));
  return { lines, scale: Math.max(1, Math.min(byW, byH)) };
}

// One picture of `kind` for `title`, `width` x `height` pixels.
export function drawArt(kind: ArtKind, title: string, width: number, height: number): Bitmap {
  const b = canvas(width, height);
  const [, , accent, ink] = PALETTES[artLook(title).palette];
  const dark: Rgb = [8, 8, 16];
  if (kind === "logo") {
    // Transparent, the title only (drawn over the hero, like Steam's logos).
    const { lines, scale } = fitTitle(title, width * 0.94, height * 0.9, 14);
    text(b, lines, width / 2, height / 2, scale, ink, dark);
    return b;
  }
  if (kind === "icon") {
    rect(b, 0, 0, width, height, accent, 1);
    const letter = wrapTitle(title, 99)[0]?.[0] ?? "?";
    const scale = Math.max(1, Math.floor(Math.min(width / (GW + 2), height / (GH + 2))));
    text(b, [letter], width / 2, height / 2, scale, dark, accent);
    return b;
  }
  paintScene(b, title);
  if (kind === "cover") {
    rect(b, 0, height * 0.66, width, height * 0.34, dark, 0.35);
    const { lines, scale } = fitTitle(title, width * 0.86, height * 0.26, 10);
    text(b, lines, width / 2, height * 0.83, scale, ink, dark);
  } else if (kind === "header") {
    const { lines, scale } = fitTitle(title, width * 0.86, height * 0.6, 16);
    text(b, lines, width / 2, height / 2, scale, ink, dark);
  }
  // hero: no title (Steam's heroes have none; the logo is drawn over it)
  return b;
}
