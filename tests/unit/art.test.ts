import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PART_IDS } from "../../src/desktop/live/parts";

const svg = readFileSync(new URL("../../src/assets/dualsense.svg", import.meta.url), "utf8");

describe("live controller art (tools/prepare_controller_art.py output)", () => {
  it("has every selectable part, the touchpad box, the player lights and the fills", () => {
    for (const part of PART_IDS) expect(svg, part).toContain(`data-part="${part}"`);
    expect(svg).toMatch(/data-part="touchpad"[^>]*data-box="[\d. ]+"/);
    expect(svg.match(/data-led="\d"/g)).toHaveLength(5);
    for (const id of ["ctl-l2-fill", "ctl-r2-fill", "ctl-led-clip", "ctl-led-edge-clip"]) expect(svg, id).toContain(`id="${id}"`);
  });

  it("carries the MIT credit and no Inkscape metadata", () => {
    expect(svg).toContain("AL2009man");
    expect(svg).not.toMatch(/inkscape:|sodipodi/);
  });
});
