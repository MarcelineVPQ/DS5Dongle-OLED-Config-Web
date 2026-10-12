// DualSense colorways by the code in the controller's factory serial (the
// dongle reads it once per connection; identity bytes 27-28). Codes from the
// community-maintained maps in dualshock-tools and daidr/dualsense-tester.
//
// Colors: the six with AL2009man art (Gamepad-Asset-Pack Theme SVGs) use that
// art's exact colors; the other plain colorways use close flat approximations.
// Special editions have printed artwork, so they keep the theme colors and
// only show their name.
//
// Outlines must stay readable: at least 2:1 against the body and the button
// caps, and 3:1 (WCAG non-text contrast) on the black parts, where a light
// grey is used when the colorway's own outline color is too dark
// (lineOnDark). tests/unit/colorways.test.ts enforces both. Galactic Purple,
// Starlight Blue and Nova Pink use outlines darker/lighter than the art's,
// which were too faint.
import { contrast as rgbContrast, hexToRgb, mix } from "../theme/desktopPalette";

export interface ColorwayColors {
  body: string;
  cap: string; // face buttons, d-pad
  dark: string; // center, triggers, bumpers
  stick: string;
  line: string; // outlines and symbols
}

export interface Colorway {
  name: string;
  colors?: ColorwayColors;
}

const DARK = "#171b20";
const STICK = "#333333";
const plain = (body: string, cap: string, line: string, dark = DARK): ColorwayColors => ({ body, cap, dark, stick: STICK, line });

export const COLORWAYS: Record<string, Colorway> = {
  "00": { name: "White", colors: plain("#ebeef0", "#e1e3e6", "#707373") },
  "01": { name: "Midnight Black", colors: plain("#232529", "#19191b", "#5d5d5d") },
  "02": { name: "Cosmic Red", colors: plain("#aa1450", "#a51249", "#ffbfbf") },
  "03": { name: "Nova Pink", colors: plain("#d94e9a", "#cd4e91", "#5e0f3b") },
  "04": { name: "Galactic Purple", colors: plain("#493199", "#402787", "#c4b8f2") },
  "05": { name: "Starlight Blue", colors: plain("#6dbaf0", "#82bdf2", "#2b5a8a") },
  // Approximations (no art in the pack; colors by eye from product photos,
  // correct here when someone has the controller).
  "06": { name: "Grey Camouflage", colors: plain("#7b8086", "#6f747a", "#3b3f44") },
  "07": { name: "Volcanic Red", colors: plain("#8f1d24", "#86191f", "#e8a3a7") },
  "08": { name: "Sterling Silver", colors: plain("#b9bdc3", "#aeb2b8", "#5c6066") },
  "09": { name: "Cobalt Blue", colors: plain("#2443a8", "#1f3b96", "#a9b8ec") },
  "10": { name: "Chroma Teal", colors: plain("#2aa39c", "#25958e", "#0f4f4b") },
  "11": { name: "Chroma Indigo", colors: plain("#3b3c9c", "#34358d", "#b9baf0") },
  "12": { name: "Chroma Pearl", colors: plain("#e9e5ee", "#dfdae6", "#77727f") },
  "13": { name: "HyperPop Techno Red", colors: plain("#d8202e", "#c41b28", "#ffd0d4") },
  "14": { name: "HyperPop Remix Green", colors: plain("#3fbf4a", "#36aa40", "#0f3d13") },
  "15": { name: "HyperPop Rhythm Blue", colors: plain("#2b6fe0", "#255fc4", "#cfe0ff") },
  "30": { name: "30th Anniversary", colors: plain("#b9b7b2", "#a9a7a2", "#4a4946") },
  Z1: { name: "God of War Ragnarök", colors: plain("#dde6ee", "#cdd9e4", "#2c3e5c") },
  Z2: { name: "Marvel's Spider-Man 2", colors: plain("#b3141c", "#1c1c20", "#f2c9cb") },
  Z3: { name: "Astro Bot", colors: plain("#ebeef0", "#dfe3e7", "#2f6fd6") },
  Z4: { name: "Fortnite", colors: plain("#7a4fd6", "#6a42c2", "#e2d6ff") },
  Z6: { name: "The Last of Us", colors: plain("#4d5b5c", "#424f50", "#d9a441") },
  Z7: { name: "Ghost of Yōtei", colors: plain("#2a2b2e", "#202124", "#c9a24a") },
  ZA: { name: "God of War 20th Anniversary", colors: plain("#3b3b3d", "#2f2f31", "#c9a24a") },
  ZB: { name: "Icon Blue", colors: plain("#1f5fd6", "#1a52bd", "#d3e1ff") },
  ZD: { name: "Marathon", colors: plain("#c6f23a", "#b3dc30", "#26310a") },
  ZE: { name: "Genshin Impact", colors: plain("#eef0f2", "#e2e5e8", "#5b7f8c") },
  ZF: { name: "007 First Light", colors: plain("#1f2023", "#17181a", "#c9a24a") },
};

// WCAG contrast ratio between two #rrggbb colors (1..21).
export const contrast = (a: string, b: string) => rgbContrast(hexToRgb(a), hexToRgb(b));

const LINE_ON_DARK_FALLBACK = "#9aa1a9";

const toHex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// `color` if it reaches every [ground, ratio] pair, else the smallest step
// toward white or black that does, else whichever of the two comes closest
// (two very different grounds can rule out every color). The one outline rule
// for the colorways here and the player's own colors (customColors.ts).
export function legibleOn(color: string, needs: ReadonlyArray<readonly [string, number]>): string {
  const reads = (c: string) => needs.every(([ground, ratio]) => contrast(c, ground) >= ratio);
  if (reads(color)) return color;
  const base = hexToRgb(color);
  const ends = ["#ffffff", "#000000"];
  for (let step = 1; step <= 20; step++) {
    for (const end of ends) {
      const c = toHex(mix(base, hexToRgb(end), step / 20));
      if (reads(c)) return c;
    }
  }
  const worst = (c: string) => Math.min(...needs.map(([ground, ratio]) => contrast(c, ground) / ratio));
  return worst(ends[0]) >= worst(ends[1]) ? ends[0] : ends[1];
}

// The outline color for lines drawn on the black parts (triggers, bumpers,
// stick wells, center): 3:1 on the black parts, 2:1 on the sticks. The
// colorway's own outline when it reads there, else a light grey, else (a
// player's own colors) the outline pushed until it does.
export function lineOnDark(colors: ColorwayColors): string {
  const needs = [
    [colors.dark, 3],
    [colors.stick, 2],
  ] as const;
  for (const c of [colors.line, LINE_ON_DARK_FALLBACK]) if (legibleOn(c, needs) === c) return c;
  return legibleOn(colors.line, needs);
}

export function colorway(code: string | null): Colorway | null {
  return code ? (COLORWAYS[code] ?? null) : null;
}
