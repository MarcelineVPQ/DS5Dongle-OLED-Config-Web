// Every colorway the live view can paint must keep its outlines readable:
// buttons and symbols against the body and caps, and the lines on the black
// parts (triggers, bumpers, sticks, center). See src/desktop/live/colorways.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORWAYS, colorway, contrast, lineOnDark } from "../../src/desktop/live/colorways";
import { controllerSurfaces } from "../../src/desktop/live/controllerAccent";
import { contrast as rgbContrast, wantsLightInk } from "../../src/desktop/theme/desktopPalette";

const painted = Object.entries(COLORWAYS).filter(([, c]) => c.colors);

describe("colorways", () => {
  it("paints every known colorway (special editions are approximations)", () => {
    expect(painted.length).toBe(Object.keys(COLORWAYS).length);
  });

  it.each(painted)("%s: outlines read against the body and the button caps (≥ 2:1)", (_code, { colors }) => {
    expect(contrast(colors!.line, colors!.body)).toBeGreaterThanOrEqual(2);
    expect(contrast(colors!.line, colors!.cap)).toBeGreaterThanOrEqual(2);
  });

  it.each(painted)("%s: outlines on the black parts meet WCAG non-text contrast (≥ 3:1)", (_code, { colors }) => {
    expect(contrast(lineOnDark(colors!), colors!.dark)).toBeGreaterThanOrEqual(3);
    expect(contrast(lineOnDark(colors!), colors!.stick)).toBeGreaterThanOrEqual(2);
  });

  it("unknown codes keep the theme colors", () => {
    expect(colorway("??")).toBeNull();
    expect(colorway(null)).toBeNull();
  });

  it("the art tags the lines on the black parts", () => {
    const svg = readFileSync("src/assets/dualsense.svg", "utf8");
    expect(svg.match(/class="ln ln-dk"/g)?.length).toBeGreaterThanOrEqual(15);
  });

  it("computes contrast like WCAG", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
});

describe("controller theme legibility (every colorway)", () => {
  const rgbOf = (v: string) => v.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
  it.each(Object.keys(COLORWAYS))("colorway %s: readable text and a visible accent on its own body color", (code) => {
    const v = controllerSurfaces(code)!;
    const panel = rgbOf(v["--bg-panel"]);
    // 7:1 where the body allows it; mid-tone bodies can't reach it even with
    // pure black or white, so then the best possible ink (always >= 4.5:1, WCAG AA).
    const best = Math.max(rgbContrast([255, 255, 255], panel), rgbContrast([0, 0, 0], panel));
    expect(rgbContrast(rgbOf(v["--text-strong"]), panel)).toBeGreaterThanOrEqual(Math.min(7, best) - 0.01);
    expect(best).toBeGreaterThanOrEqual(4.5);
    expect(rgbContrast(rgbOf(v["--text-muted"]), panel)).toBeGreaterThanOrEqual(4.5);
    expect(rgbContrast(rgbOf(v["--dk-accent"]), panel)).toBeGreaterThanOrEqual(3);
    // Text stays on the ink side the body calls for (never pushed the wrong way).
    const ink = wantsLightInk(panel) ? 255 : 0;
    expect(Math.abs(rgbOf(v["--text-strong"])[0] - ink)).toBeLessThan(128);
  });
});
