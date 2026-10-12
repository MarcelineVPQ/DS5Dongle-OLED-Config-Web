// "My controller's colors": the player's colors on top of the colorway, and
// outlines that stay readable whatever they pick (the colorways' rule, see
// tests/unit/colorways.test.ts). src/desktop/live/customColors.ts.
import { describe, expect, it } from "vitest";
import { COLORWAYS, contrast, lineOnDark, type ColorwayColors } from "../../src/desktop/live/colorways";
import { colorwayAccent, controllerSurfaces } from "../../src/desktop/live/controllerAccent";
import { FALLBACK_BASE, mergeColors, parseCustomColors } from "../../src/desktop/live/customColors";

const genshin = COLORWAYS.ZE.colors!;
const red = COLORWAYS["02"].colors!;

describe("merging the player's colors", () => {
  it("keeps the colorway as it is with nothing set", () => {
    expect(mergeColors(genshin, null)).toBe(genshin);
    expect(mergeColors(genshin, {})).toBe(genshin);
    expect(mergeColors(null, {})).toBeNull();
  });

  it("replaces only the parts the player set", () => {
    const m = mergeColors(genshin, { dark: "#0f5c5c", cap: "#c9a24a" })!;
    expect(m).toEqual({ ...genshin, dark: "#0f5c5c", cap: "#c9a24a", line: m.line });
    expect(m.body).toBe(genshin.body);
    expect(m.stick).toBe(genshin.stick);
  });

  it("starts from the stock white DualSense when the colorway isn't known", () => {
    const m = mergeColors(null, { body: "#2a7fd4" })!;
    expect(m.dark).toBe(FALLBACK_BASE.dark);
    expect(m.body).toBe("#2a7fd4");
  });

  it("keeps a readable outline as picked", () => {
    expect(mergeColors(red, { line: "#ffffff" })!.line).toBe("#ffffff");
  });

  it("the Controller theme follows the player's body color", () => {
    expect(colorwayAccent("00", { body: "#2a7fd4" })).toBe("#2a7fd4");
    expect(colorwayAccent("02", { body: "#808080" })).toBeNull(); // a neutral shell gives no accent
    expect(controllerSurfaces("00", { body: "#2a7fd4" })!["--bg-panel"]).toBe("rgb(42, 127, 212)");
  });
});

describe("outlines stay readable", () => {
  // Grounds from very light to very dark, and the outline picks that fail on them.
  const shades = ["#ffffff", "#ebeef0", "#d94e9a", "#2aa39c", "#808080", "#493199", "#171b20", "#000000"];
  const cases: Array<[string, Partial<ColorwayColors>]> = [];
  for (const body of shades) for (const line of shades) cases.push([`body ${body}, line ${line}`, { body, cap: body, line }]);
  cases.push(["light body, dark caps", { body: "#f0f0f0", cap: "#202020", line: "#808080" }]);
  cases.push(["teal black parts, light outline", { dark: "#5fc9c9", stick: "#5fc9c9", line: "#ebeef0" }]);

  it.each(cases)("%s: ≥ 2:1 on the body and caps, ≥ 3:1 on the black parts", (_name, custom) => {
    const m = mergeColors(genshin, custom)!;
    expect(m.line).toMatch(/^#[0-9a-f]{6}$/);
    const best = (grounds: string[], ratio: number) => Math.max(...["#ffffff", "#000000"].map((ink) => Math.min(...grounds.map((g) => contrast(ink, g) / ratio))));
    // Where some ink can reach the target on every ground, the outline does.
    if (best([m.body, m.cap], 2) >= 1) {
      expect(contrast(m.line, m.body)).toBeGreaterThanOrEqual(2);
      expect(contrast(m.line, m.cap)).toBeGreaterThanOrEqual(2);
    }
    if (best([m.dark], 3) >= 1 && best([m.stick], 2) >= 1) {
      expect(contrast(lineOnDark(m), m.dark)).toBeGreaterThanOrEqual(3);
      expect(contrast(lineOnDark(m), m.stick)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the stored colors", () => {
  it("keeps only valid #rrggbb parts", () => {
    expect(parseCustomColors('{"body":"#AABBCC","dark":"teal","cap":"#123","extra":"#000000","line":5}')).toEqual({ body: "#aabbcc" });
    expect(parseCustomColors("not json")).toEqual({});
    expect(parseCustomColors(null)).toEqual({});
    expect(parseCustomColors("[1]")).toEqual({});
  });
});
