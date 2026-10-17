// @vitest-environment jsdom
// Focus, hover and selection on the controller drawing: every part of both
// drawings (the shell included) gets the same ring, a group of three outline
// copies of its own shapes drawn just under them (gap, ring, halo), and one
// CSS rule set draws them from the theme's tokens. Found 0.9.5-dev.18: the
// standard DualSense had no outline layer, so focus showed on few parts and
// nowhere on Haptic feedback, Speaker, PS, Touch pad and Light bar.
// tools/check_focus_ring.mjs checks the rendered rings (contrast, every
// colorway) on a checker copy.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "../../src/i18n";
import LiveController from "../../src/desktop/live/LiveController";
import { EDGE_PARTS, PART_IDS, type PartId } from "../../src/desktop/live/parts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(globalThis as { SVGGeometryElement?: unknown }).SVGGeometryElement ??= class {};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

function mount(model: "dualsense" | "edge") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      createElement(LiveController, {
        model,
        input: null,
        lightbar: null,
        playerLeds: 0,
        playerWiring: "paired",
        colors: null,
        selected: null,
        remapped: new Set<PartId>(),
        onSelect: () => undefined,
      }),
    ),
  );
  return container.querySelector("svg")!;
}

// The rings that belong to a part: inside it, or just before it when the part is one shape.
const ringsOf = (part: Element) => (part.tagName === "g" ? [...part.querySelectorAll(":scope .rings")] : part.previousElementSibling?.matches(".rings") ? [part.previousElementSibling] : []);

describe("the part rings", () => {
  for (const model of ["dualsense", "edge"] as const)
    it(`gives every part of the ${model === "edge" ? "Edge" : "DualSense"} drawing, and its shell, a ring`, () => {
      const svg = mount(model);
      const ids = [...PART_IDS.filter((id) => model === "edge" || !EDGE_PARTS.has(id)), "body"];
      for (const id of ids) {
        const part = svg.querySelector(`[data-part="${id}"]`);
        expect(part, id).not.toBeNull();
        const rings = ringsOf(part!);
        expect(rings.length, `${id} has rings`).toBeGreaterThan(0);
        for (const g of rings) {
          expect(
            [...g.children].map((c) => c.getAttribute("class")),
            id,
          ).toEqual(["ring-halo", "ring", "ring-gap"]);
          // Copies of the geometry only: no ids, inline styles or part markers of their own.
          for (const c of g.children) for (const attr of ["id", "style", "data-part", "tabindex"]) expect(c.hasAttribute(attr), `${id} copy ${attr}`).toBe(false);
        }
      }
      // A part's own shapes, not its neighbors': only the part keyboard stops.
      expect(svg.querySelectorAll('.rings [tabindex], .rings [role="button"]')).toHaveLength(0);
    });

  it("draws them from the theme's tokens, one rule set for both drawings, hidden unless focused, hovered or selected", () => {
    const css = readFileSync("src/desktop/desktop.css", "utf8");
    const block = css.slice(css.indexOf("/* Part rings"), css.indexOf("/* The DualSense Edge drawing"));
    expect(css).toMatch(/--ctl-ring: var\(--text-strong\)/);
    expect(css).toMatch(/--ctl-ring-halo: var\(--bg-page\)/);
    expect(block).toMatch(/\.live-ctl \.rings \{[^}]*display: none/);
    expect(block).toMatch(/:focus-visible/);
    expect(block).toMatch(/:hover/);
    expect(block).toMatch(/\.sel/);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i); // no literal colors
    // The old shell-only hover glow is gone (the shell has the same ring now).
    expect(css).not.toMatch(/\[data-part="body"\]:hover/);
  });
});
