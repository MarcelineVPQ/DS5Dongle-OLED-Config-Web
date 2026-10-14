// "My controller's colors" (App settings -> Appearance): the player's own
// colors for the drawing's part groups, for modded and custom shells (a
// colored lower body, two-tone shells, colored buttons and sticks). Only the
// parts the player set are replaced; the rest stay the detected colorway's.
// The same merged colors paint the drawing, the backdrop and the Controller
// theme (controllerAccent.ts).
//
// Outlines stay readable whatever the player picks: the same rule as the
// colorways (2:1 against the body and caps, 3:1 on the black parts via
// lineOnDark); a chosen outline that fails it is pushed toward white or black
// until it reads, and the settings say so.
//
// One set for now. Later: per controller (keyed by slot names / the
// per-controller settings), see docs/BACKLOG.md.
import { useCallback, useMemo } from "react";
import { useFlagPref, useRawPref } from "../storage";
import { COLORWAYS, drawingColors, legibleOn, type ColorwayColors, type Model } from "./colorways";

export type ColorPart = keyof ColorwayColors;
export type CustomColors = Partial<ColorwayColors>;

// In the order the settings list them.
export const COLOR_PARTS: readonly ColorPart[] = ["body", "dark", "cap", "stick", "line"];

export const CUSTOM_COLORS_ON_KEY = "ds5.customColors.on";
export const CUSTOM_COLORS_KEY = "ds5.customColors";

// Under the player's colors when the colorway isn't known: the stock white
// DualSense.
export const FALLBACK_BASE = COLORWAYS["00"].colors!;

const HEX = /^#[0-9a-f]{6}$/;

// The stored JSON, keeping only valid #rrggbb parts (anything else is dropped).
export function parseCustomColors(raw: string | null): CustomColors {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  const out: CustomColors = {};
  // loop: NOT-WORTH — N = 6 parts, useMemo on the stored string
  for (const part of COLOR_PARTS) {
    const v = (data as Record<string, unknown>)[part];
    if (typeof v === "string" && HEX.test(v.toLowerCase())) out[part] = v.toLowerCase();
  }
  return out;
}

// loop: HOT-PATH-OK — N = 6 parts, per render
export const hasCustomColors = (custom: CustomColors | null): boolean => !!custom && COLOR_PARTS.some((p) => custom[p]);

// The outline on the body and the button caps, made readable (2:1 on both).
export const legibleLine = (c: ColorwayColors): string =>
  legibleOn(c.line, [
    [c.body, 2],
    [c.cap, 2],
  ]);

// The colorway with the player's colors on top (null custom or none set: the
// colorway as it is, null when unknown). The outline is kept readable.
export function mergeColors(base: ColorwayColors | null, custom: CustomColors | null): ColorwayColors | null {
  if (!custom || !hasCustomColors(custom)) return base;
  const merged: ColorwayColors = { ...(base ?? FALLBACK_BASE) };
  // loop: HOT-PATH-OK — N = 6 parts, inside useMemo on code/model/colors
  for (const part of COLOR_PARTS) if (custom[part]) merged[part] = custom[part];
  return { ...merged, line: legibleLine(merged) };
}

// The player's colors as stored, and whether they are on.
export function useCustomColors(): {
  on: boolean;
  setOn: (on: boolean) => void;
  colors: CustomColors;
  setColors: (colors: CustomColors) => void;
  // What applies: the colors while on, else null.
  active: CustomColors | null;
} {
  const [on, setOn] = useFlagPref(CUSTOM_COLORS_ON_KEY);
  const [raw, setRaw] = useRawPref(CUSTOM_COLORS_KEY);
  const colors = useMemo(() => parseCustomColors(raw), [raw]);
  const setColors = useCallback((next: CustomColors) => setRaw(JSON.stringify(next)), [setRaw]);
  const active = on && hasCustomColors(colors) ? colors : null;
  return { on, setOn, colors, setColors, active };
}

// The drawing's colors for a colorway code (and model: the Edge has its own),
// with the player's on top.
export function useControllerColors(code: string | null, model: Model | null = null): ColorwayColors | null {
  const { active } = useCustomColors();
  return useMemo(() => mergeColors(drawingColors(code, model), active), [code, model, active]);
}
