// Every colorway the live view can paint must keep its outlines readable:
// buttons and symbols against the body and caps, and the lines on the black
// parts (triggers, bumpers, sticks, center). See src/desktop/live/colorways.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLORWAYS, colorway, contrast, lineOnDark } from "../../src/desktop/live/colorways";

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
