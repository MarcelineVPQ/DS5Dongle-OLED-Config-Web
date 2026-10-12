// DualSense colorways by the code in the controller's factory serial (the
// dongle reads it once per connection; identity bytes 27-28). Codes from the
// community-maintained maps in dualshock-tools and daidr/dualsense-tester.
//
// Colors: the six with AL2009man art (Gamepad-Asset-Pack Theme SVGs) use that
// art's exact colors; the other plain colorways use close flat approximations.
// Special editions are painted in their real colors, part by part (e.g.
// Genshin Impact's teal center, triggers and sticks on an ivory shell with gold
// symbols): colors only, never their artwork, logos or motifs. Only Spider-Man 2
// and Monster Hunter Wilds keep stock black parts, as the real ones do.
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
// A special edition whose "black" parts (center, triggers, bumpers) and sticks
// come in their own colors.
const twoTone = (body: string, cap: string, line: string, dark: string, stick: string): ColorwayColors => ({ body, cap, dark, stick, line });

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
  // Special editions: colors by eye from the official product photos, only
  // the base colors of each part (never the printed artwork). Where a "black"
  // part is light (GoW Ragnarök's white center, The Last of Us), the outline
  // is a mid tone that reads on both.
  "30": { name: "30th Anniversary", colors: twoTone("#9a9da3", "#4a4c50", "#e4e6e8", "#5d6066", "#3e4044") },
  Z1: { name: "God of War Ragnarök", colors: twoTone("#2b3a8c", "#1c1d21", "#787da3", "#e4e6f2", "#26272b") },
  Z2: { name: "Marvel's Spider-Man 2", colors: plain("#b3141c", "#1c1c20", "#f2c9cb") },
  Z3: { name: "Astro Bot", colors: twoTone("#eef0f3", "#e6e9ee", "#2f6fd6", "#e4e7eb", "#d3d7db") },
  Z4: { name: "Fortnite", colors: twoTone("#5cb3e8", "#8cc8f0", "#234a8a", "#1b2233", "#23293a") },
  Z5: { name: "Monster Hunter Wilds", colors: plain("#8f1d24", "#86191f", "#d6d6da") },
  Z6: { name: "The Last of Us", colors: twoTone("#26272a", "#1c1d20", "#7c8187", "#e8eaec", "#d8dadc") },
  Z7: { name: "Ghost of Yōtei Gold", colors: twoTone("#f0efea", "#f3f2ee", "#7d5d14", "#c4c6c8", "#b0b3b5") },
  ZA: { name: "God of War 20th Anniversary", colors: twoTone("#eceef0", "#f2f3f5", "#d8262f", "#e4e6e8", "#2e3034") },
  ZB: { name: "Icon Blue", colors: twoTone("#1f4fc8", "#1e48b8", "#a9c8ff", "#1a3fa8", "#2550c0") },
  // ZC: daidr/dualsense-tester (two owner reports with serials); the
  // dualshock-tools map lists ZC as Ghost of Yōtei, which owners report as Z7.
  ZC: { name: "Astro Bot Joyful", colors: twoTone("#eef0f3", "#e6e9ee", "#2f6fd6", "#e4e7eb", "#d3d7db") },
  ZD: { name: "Marathon", colors: twoTone("#eceef0", "#e3e6e9", "#6e7277", "#e6e8eb", "#2a2c30") },
  ZE: { name: "Genshin Impact", colors: twoTone("#ece6dc", "#f0ebe1", "#a8843a", "#22536c", "#2a5f78") },
  ZF: { name: "007 First Light", colors: twoTone("#c9a868", "#1c1d20", "#7a6230", "#171b20", "#25272b") },
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

// The DualSense Edge's colorways where they differ from the standard
// controller's under the same code: Edge White has black face buttons, d-pad
// and sticks on the white shell (the black center and touchpad are its dark
// parts); Midnight Black is dark all over. Other codes use the standard map.
export const EDGE_COLORWAYS: Record<string, Colorway> = {
  "00": { name: "White", colors: twoTone("#ebeef0", "#1c1d20", "#8a8e93", DARK, "#2a2c30") },
  "01": { name: "Midnight Black", colors: COLORWAYS["01"].colors },
};

export type Model = "dualsense" | "edge";

export function colorway(code: string | null, model: Model | null = null): Colorway | null {
  if (!code) return null;
  return (model === "edge" ? EDGE_COLORWAYS[code] : undefined) ?? COLORWAYS[code] ?? null;
}

// The drawing's colors for a controller: its colorway's; an Edge whose code
// isn't known is drawn as the stock Edge (White), a standard DualSense keeps
// the theme colors (null).
export function drawingColors(code: string | null, model: Model | null = null): ColorwayColors | null {
  return colorway(code, model)?.colors ?? (model === "edge" ? EDGE_COLORWAYS["00"].colors! : null);
}
