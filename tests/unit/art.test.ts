import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDGE_PARTS, PART_IDS } from "../../src/desktop/live/parts";

const svg = readFileSync(new URL("../../src/assets/dualsense.svg", import.meta.url), "utf8");
const edge = readFileSync(new URL("../../src/assets/dualsense-edge.svg", import.meta.url), "utf8");

describe("live controller art (tools/prepare_controller_art.py output)", () => {
  it("has every selectable part, the touchpad box, the player lights and the fills", () => {
    for (const part of PART_IDS) if (!EDGE_PARTS.has(part)) expect(svg, part).toContain(`data-part="${part}"`);
    expect(svg).toMatch(/data-part="touchpad"[^>]*data-box="[\d. ]+"/);
    expect(svg.match(/data-led="\d"/g)).toHaveLength(5);
    for (const id of ["ctl-l2-fill", "ctl-r2-fill", "ctl-led-clip", "ctl-led-edge-clip"]) expect(svg, id).toContain(`id="${id}"`);
  });

  it("carries the MIT credit and no Inkscape metadata", () => {
    expect(svg).toContain("AL2009man");
    expect(svg).not.toMatch(/inkscape:|sodipodi/);
  });
});

describe("DualSense Edge art (tools/prepare_edge_art.py output)", () => {
  it("has every selectable part, the Edge's own included, the touchpad box, the player lights and the fills", () => {
    for (const part of PART_IDS) expect(edge, part).toContain(`data-part="${part}"`);
    expect(edge).toMatch(/data-part="touchpad"[^>]*data-box="[\d. ]+"/);
    expect(edge.match(/data-led="\d"/g)).toHaveLength(5);
    for (const id of ["ctl-l2-fill", "ctl-r2-fill", "ctl-gloss", "ctl-tp-dots"]) expect(edge, id).toContain(`id="${id}"`);
  });

  it("is colored only by the theme classes (no fixed colors) and tags the lines on the dark parts", () => {
    expect(edge).not.toMatch(/#[0-9a-fA-F]{3,6}\b|fill:|stroke:/);
    expect(edge.match(/class="ln ln-dk"/g)?.length).toBeGreaterThanOrEqual(15);
  });

  it("leaves out Sony's marks: the source's PlayStation logo and touchpad pattern", () => {
    // The source's ids for them, and its unprepared coordinates.
    expect(edge).not.toMatch(/TPPattern|id="PS"|serif:/);
    expect(edge).toMatch(/<g data-part="ps"><circle /);
  });

  it("carries the MIT credit", () => {
    expect(edge).toContain("daidr");
    expect(edge).toContain("MIT");
  });
});
