// The Glass look's captions on game art (Games → Home): legible over any
// art, and no live blur in the Library grid (every game: a backdrop filter
// per tile would cost the GPU on every scrolled frame).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glassCaption } from "../../src/desktop/glass/glassCaption";
import { contrast, mix, parseColor, type Rgb } from "../../src/desktop/theme/desktopPalette";

const rgb = (v: string) => parseColor(v)!;

describe("glass caption tokens", () => {
  it("the ink reads at 4.5:1 over white art, black art and the solid tint, for any art color", () => {
    for (const color of [null, "#c31646", "#f5d742", "#3cc8b4", "#2d6cdf", "#ffffff", "#7f7f7f", "#000000"]) {
      const t = glassCaption(color);
      const tint = rgb(t["--cap-tint"]);
      const alpha = parseInt(t["--cap-alpha"], 10) / 100;
      const grounds: Rgb[] = [mix([255, 255, 255], tint, alpha), mix([0, 0, 0], tint, alpha), tint];
      for (const ink of [t["--cap-ink"], t["--cap-ink-soft"]]) for (const g of grounds) expect(contrast(rgb(ink), g), `${color} ${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
      expect(alpha).toBeLessThan(1); // still glass: the art shows through
    }
  });

  it("the tint follows the art's color", () => {
    const red = rgb(glassCaption("#c31646")["--cap-tint"]);
    const blue = rgb(glassCaption("#2d6cdf")["--cap-tint"]);
    expect(red[0]).toBeGreaterThan(red[2]);
    expect(blue[2]).toBeGreaterThan(blue[0]);
  });
});

// Every rule of desktop.css (nested @media blocks flattened) as selector + body.
function cssRules(): Array<{ selector: string; body: string }> {
  const css = readFileSync(new URL("../../src/desktop/desktop.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re))
    out.push({
      selector: m[1]
        .trim()
        .replace(/^@[^{]*$/, "")
        .replace(/\s+/g, " "),
      body: m[2],
    });
  return out;
}

describe("the Library grid's tiles", () => {
  it("never get a backdrop filter (only the few Continue playing tiles and the app's own glass do)", () => {
    const offenders = cssRules()
      .filter((r) => /backdrop-filter/.test(r.body) && !/backdrop-filter:\s*none/.test(r.body))
      .flatMap((r) => r.selector.split(",").map((s) => s.trim()))
      .filter((s) => /\.lib-(tile|glass|grid)/.test(s) && !/\.lib-continue/.test(s));
    expect(offenders).toEqual([]);
  });

  it("the glass caption rules apply only to tiles marked .lib-glass", () => {
    const glassy = cssRules().filter((r) => /--cap-/.test(r.body));
    expect(glassy.length).toBeGreaterThan(0);
    for (const r of glassy) for (const s of r.selector.split(",")) expect(s, r.selector).toMatch(/\.lib-glass/);
  });
});
