// @vitest-environment jsdom
// Loop pass batch 1 (docs/LOOP_PASS_2026-10.md): the controller view
// re-renders on every live input frame (~30 a second), and work that doesn't
// depend on the input must not run again on those frames:
// - the Buttons list and the saved layouts (memo, with a stable useRemap
//   result) and each layout's use count (once per library change);
// - the stick curve's nodes (once per curve, not per curveAt call);
// - a finished drift test's results (once per test);
// - the drawing's trigger stops and touchpad box (looked up once at mount).
// Each test counts the work across several live frames.
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import { emptyInputReport, type InputReport } from "../../src/oled/inputReport";
import { DEFAULT_CALIBRATION } from "../../src/protocol/calibration";
import { curveAt, curveNodeBuilds, type StickCurve } from "../../src/protocol/stickCurve";
import { EMPTY_LIBRARY, type LibraryFile } from "../../src/desktop/games/library";
import { LibraryContext } from "../../src/desktop/library/libraryContext";
import { useRemap, type Remap } from "../../src/desktop/live/useRemap";
import type { PartId } from "../../src/desktop/live/parts";

// Count the per-row and per-layout work the Buttons sections do when they render.
const counts = vi.hoisted(() => ({ buttonLabel: 0, layoutSummary: 0, driftStats: 0 }));
vi.mock("../../src/desktop/live/layoutSummary", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/desktop/live/layoutSummary")>();
  return {
    ...real,
    buttonLabel: (i: number) => (counts.buttonLabel++, real.buttonLabel(i)),
    layoutSummary: (...a: Parameters<typeof real.layoutSummary>) => (counts.layoutSummary++, real.layoutSummary(...a)),
  };
});
vi.mock("../../src/desktop/live/stickTests", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/desktop/live/stickTests")>();
  return { ...real, driftStats: (...a: Parameters<typeof real.driftStats>) => (counts.driftStats++, real.driftStats(...a)) };
});
// Imported after the mocks are set up (vi.mock is hoisted anyway).
const { AllButtonsList, SavedLayouts } = await import("../../src/desktop/live/PartPanel");
const { default: StickTests } = await import("../../src/desktop/live/StickTestCards");
const { default: LiveController } = await import("../../src/desktop/live/LiveController");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(globalThis as { SVGGeometryElement?: unknown }).SVGGeometryElement ??= class {};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => {
  counts.buttonLabel = counts.layoutSummary = counts.driftStats = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.useRealTimers();
});
function mount(el: ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}
const render = (el: ReactElement) => act(() => root!.render(el));

// A live input frame: a new report object with the left stick moved.
const frame = (n: number): InputReport => ({ ...emptyInputReport(), leftStick: { x: 128 + (n % 20), y: 128 }, triggerLeft: n % 2 ? 40 : 0 });

describe("useRemap", () => {
  it("returns the same object across renders while nothing in it changed", () => {
    const seen: Remap[] = [];
    function Probe({ tick }: { tick: number }) {
      seen.push(useRemap(null));
      return createElement("span", null, tick);
    }
    mount(createElement(Probe, { tick: 0 }));
    for (let n = 1; n <= 5; n++) render(createElement(Probe, { tick: n }));
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(1);
  });
});

describe("the Buttons list and saved layouts", () => {
  const remap: Remap = {
    supported: true,
    device: Array.from({ length: 16 }, (_, i) => i),
    draft: Array.from({ length: 16 }, (_, i) => i),
    dirty: false,
    busy: false,
    error: null,
    setTarget: () => undefined,
    apply: async () => undefined,
    revert: () => undefined,
    resetAll: () => undefined,
    load: () => undefined,
    loaded: null,
    temporary: false,
    extraDevice: null,
    extraDraft: [0, 0, 0, 0],
    setExtra: () => undefined,
  };
  const swapped = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0 : i));
  const library = {
    ...EMPTY_LIBRARY,
    layouts: { a: { name: "Swap", table: swapped }, b: { name: "Normal", table: remap.draft } },
    games: {
      g1: { profile: { settings: { buttonLayout: "a" } } },
      g2: { profile: { settings: { buttonLayout: "a" } } },
      g3: { profile: { settings: { buttonLayout: "b" } } },
      g4: {},
    },
  } as unknown as LibraryFile;
  const onFocus = vi.fn();
  const onHover = vi.fn();
  // The library context comes from DesktopApp, which doesn't re-render on live frames: one value.
  const context = { library, setLibrary: () => undefined, active: null, editProfile: () => undefined } as never;
  // The controller view: re-renders with each live frame, the sections get the same remap.
  function View({ input, r }: { input: InputReport; r: Remap }) {
    return createElement(
      LibraryContext.Provider,
      { value: context },
      createElement("span", { "data-stick": input.leftStick.x }),
      createElement(AllButtonsList, { remap: r, focus: null, onFocus, onHover, edge: false }),
      createElement(SavedLayouts, { remap: r }),
    );
  }

  it("don't re-render on live input frames, only when the remap changes", () => {
    (window as { desktop?: unknown }).desktop = {};
    const el = mount(createElement(View, { input: frame(0), r: remap }));
    const first = { ...counts };
    expect(first.buttonLabel).toBe(16); // one per row
    expect(first.layoutSummary).toBe(2); // one per saved layout
    for (let n = 1; n <= 30; n++) render(createElement(View, { input: frame(n), r: remap }));
    expect(el.querySelector("[data-stick]")?.getAttribute("data-stick")).toBe(String(frame(30).leftStick.x)); // the view itself re-rendered
    expect(counts).toEqual(first);
    // A remap change re-renders them (the counters do see renders).
    render(createElement(View, { input: frame(31), r: { ...remap, draft: swapped } }));
    expect(counts.buttonLabel).toBe(32);
    expect(counts.layoutSummary).toBe(4);
  });

  it("count each layout's games once per library change", () => {
    (window as { desktop?: unknown }).desktop = {};
    const el = mount(createElement(View, { input: frame(0), r: remap }));
    const used = [...el.querySelectorAll(".dk-layouts li")].map((li) => li.textContent ?? "");
    // Sorted by name: Normal (1 game), Swap (2 games).
    expect(used[0]).toMatch(/^Normal.*1/);
    expect(used[1]).toMatch(/^Swap.*2/);
  });
});

describe("stick curve nodes", () => {
  it("are built once per curve, not per curveAt call", () => {
    const custom: StickCurve = {
      type: "custom",
      points: [
        [60, 40],
        [120, 100],
        [180, 170],
        [230, 225],
      ],
    };
    const preset: StickCurve = { ...custom, type: "precise" };
    const before = curveNodeBuilds();
    // The curve graph draws 65 points per curve, on every live frame.
    for (let f = 0; f < 30; f++)
      for (let i = 0; i <= 64; i++) {
        curveAt(custom, i / 64);
        curveAt(preset, i / 64);
      }
    expect(curveNodeBuilds() - before).toBe(2);
    // An edit is a new curve object: built again (once).
    curveAt({ ...custom, points: [...custom.points] }, 0.5);
    expect(curveNodeBuilds() - before).toBe(3);
  });
});

describe("a finished drift test", () => {
  it("works out its results once, not on every live frame", () => {
    vi.useFakeTimers();
    const sticks = DEFAULT_CALIBRATION.sticks;
    const el = mount(createElement(StickTests, { input: frame(0), sticks }));
    const start = [...el.querySelectorAll<HTMLButtonElement>("button.primary")].find((b) => b.closest("section")?.querySelector("h2")?.textContent?.match(/drift/i));
    expect(start).toBeTruthy();
    act(() => start!.click());
    // The test samples for 10 s while the input keeps coming.
    for (let n = 1; n <= 40; n++) {
      render(createElement(StickTests, { input: frame(n), sticks }));
      act(() => vi.advanceTimersByTime(260));
    }
    expect(el.querySelectorAll(".stest-drift")).toHaveLength(2);
    expect(counts.driftStats).toBe(2); // one per stick
    for (let n = 41; n <= 70; n++) render(createElement(StickTests, { input: frame(n), sticks }));
    expect(counts.driftStats).toBe(2);
  });
});

describe("the live drawing", () => {
  it("looks up the trigger stops and the touchpad box once, not on every frame", () => {
    const props = { model: "dualsense" as const, lightbar: null, playerLeds: 0, playerWiring: "paired" as never, colors: null, selected: null, remapped: new Set<PartId>(), onSelect: vi.fn() };
    const el = mount(createElement(Fragment, null, createElement(LiveController, { ...props, input: frame(0) })));
    const qsa = vi.spyOn(Element.prototype, "querySelectorAll");
    const attr = vi.spyOn(Element.prototype, "getAttribute");
    for (let n = 1; n <= 30; n++)
      render(createElement(Fragment, null, createElement(LiveController, { ...props, input: { ...frame(n), fingers: [{ touching: true, x: 100 + n, y: 200, id: 1 }] as never } })));
    expect(qsa).not.toHaveBeenCalled();
    expect(attr.mock.calls.filter(([name]) => name === "data-box")).toHaveLength(0);
    // The trigger still follows the input: its stops show the last value.
    const stops = el.querySelectorAll("#ctl-l2-fill [data-edge]");
    expect(stops.length).toBe(2);
    expect(stops[0].getAttribute("offset")).toBe(String(frame(30).triggerLeft / 255));
    // And the touch dot is drawn.
    expect(el.querySelectorAll(".touches circle")).toHaveLength(1);
    qsa.mockRestore();
    attr.mockRestore();
  });
});
