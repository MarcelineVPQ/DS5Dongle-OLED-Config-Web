// @vitest-environment jsdom
// The lean rule for three pieces of UI-only work the lifetime pass found
// running when nothing needed them (docs/LIFETIME_PASS_2026-10.md, batch 2's
// WASTE rows): each now stops.
//   - App updates question: its 1 Hz check stops once answered and while the
//     window is hidden.
//   - Stick tests: the circularity sampler (33 ms) pauses while hidden.
//   - Tour: the hold ring's frame loop runs only while ✕ / ○ is held.
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import AutoUpdateAsk from "../../src/desktop/AutoUpdateAsk";
import { TOUR_EVENT } from "../../src/desktop/tour/Tour";
import { emptyInputReport, type InputReport } from "../../src/oled/inputReport";
import { DEFAULT_CALIBRATION } from "../../src/protocol/calibration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: an observer that never fires (and holds no timer).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let root: Root;
let container: HTMLDivElement;
let visible: Set<(shown: boolean) => void>;
let frames: number; // requestAnimationFrame calls

beforeEach(async () => {
  vi.useFakeTimers();
  await i18n.changeLanguage("en");
  window.localStorage.clear();
  frames = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames++;
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  visible = new Set();
  const settings = { updatesAsked: false };
  vi.stubGlobal("desktop", {
    platform: "linux",
    getSettings: () => Promise.resolve(settings),
    setSetting: () => Promise.resolve(),
    onWindowVisible: (l: (shown: boolean) => void) => (visible.add(l), () => visible.delete(l)),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setShown(true);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
// The main process's window-visible signal (the window-shown store wired at
// import listens through window.desktop.onWindowVisible).
function setShown(shown: boolean) {
  act(() => visible.forEach((l) => l(shown)));
}

describe("the app updates question", () => {
  it("checks for its moment only while unanswered and on screen", async () => {
    // The store subscribes once per app, on first import: wire it to this fake.
    vi.resetModules();
    const Ask = (await import("../../src/desktop/AutoUpdateAsk")).default;
    act(() => root.render(createElement(Ask)));
    await advance(10);
    expect(vi.getTimerCount()).toBe(1); // the 1 Hz check

    setShown(false);
    await advance(10);
    expect(vi.getTimerCount()).toBe(0);
    setShown(true);
    await advance(10);
    expect(vi.getTimerCount()).toBe(1);

    // A minute in (no tour), the question shows; the check is done.
    await advance(61_000);
    expect(container.textContent).toMatch(/update/i);
    expect(vi.getTimerCount()).toBe(0);
    // Answered: nothing keeps running.
    act(() => [...container.querySelectorAll("button")][0].click());
    await advance(5_000);
    expect(container.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an already answered question never starts the check", async () => {
    vi.stubGlobal("desktop", { ...window.desktop, getSettings: () => Promise.resolve({ updatesAsked: true }) });
    act(() => root.render(createElement(AutoUpdateAsk)));
    await advance(10);
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(container.textContent).toBe("");
  });
});

describe("the stick tests' circularity sampler", () => {
  it("samples while on screen and pauses while hidden", async () => {
    vi.resetModules();
    const Tests = (await import("../../src/desktop/live/StickTestCards")).default;
    const input = emptyInputReport();
    act(() => root.render(createElement(Tests, { input, sticks: [DEFAULT_CALIBRATION.sticks[0], DEFAULT_CALIBRATION.sticks[1]] })));
    await advance(10);
    expect(vi.getTimerCount()).toBe(1); // the 33 ms sampler
    setShown(false);
    await advance(10);
    expect(vi.getTimerCount()).toBe(0);
    setShown(true);
    await advance(10);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("the tour's hold ring", () => {
  it("runs its frame loop only while ✕ is held on a controller step", async () => {
    vi.resetModules();
    const T = (await import("../../src/desktop/tour/Tour")).default;
    const { setNarrator } = await import("../../src/desktop/narrator");
    setNarrator("off"); // no narrator question on the first card
    let input: InputReport = emptyInputReport();
    const render = () => act(() => root.render(createElement(T, { client: null, input, view: "overview", onView: () => undefined, ready: true })));
    render();
    act(() => window.dispatchEvent(new Event(TOUR_EVENT)));
    await advance(100);
    // ✕ on the welcome card moves to the first controller step.
    input = { ...emptyInputReport(), cross: true };
    render();
    await advance(50);
    input = emptyInputReport();
    render();
    await advance(2_000);
    expect(document.querySelector(".tour-card")?.textContent).toMatch(/^Step 2 of/); // "press": a controller step

    // Nothing held: no frames.
    frames = 0;
    await advance(1_000);
    expect(frames).toBe(0);

    // Held: the ring fills frame by frame.
    input = { ...emptyInputReport(), cross: true };
    render();
    await advance(300);
    expect(frames).toBeGreaterThan(10);

    // Let go before it fills: the loop stops.
    input = emptyInputReport();
    render();
    await advance(50);
    frames = 0;
    await advance(1_000);
    expect(frames).toBe(0);
  });
});

// The spotlight follows its target with a 200 ms check; it renders only when
// the target moved or resized, not 5 times a second (bug hunt D7, 0.9.5).
describe("the tour's spotlight check", () => {
  it("renders nothing while its target stays put, and follows it when it moves", async () => {
    vi.resetModules();
    const T = (await import("../../src/desktop/tour/Tour")).default;
    const { setNarrator } = await import("../../src/desktop/narrator");
    setNarrator("off");
    // The first controller step's target, with a box that only moves when the test says so.
    const target = document.createElement("div");
    target.className = "live-ctl";
    target.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    document.body.append(target);
    let box = { left: 10, top: 20, width: 300, height: 200 };
    target.querySelector("svg")!.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;
    let commits = 0;
    let input: InputReport = emptyInputReport();
    const render = () =>
      act(() =>
        root.render(createElement(Profiler, { id: "tour", onRender: () => void commits++ }, createElement(T, { client: null, input, view: "overview", onView: () => undefined, ready: true }))),
      );
    try {
      render();
      act(() => window.dispatchEvent(new Event(TOUR_EVENT)));
      await advance(100);
      input = { ...emptyInputReport(), cross: true };
      render();
      await advance(50);
      input = emptyInputReport();
      render();
      await advance(2_000);
      expect(document.querySelector(".tour-card")?.textContent).toMatch(/^Step 2 of/);
      commits = 0;
      // loop: test — one act per check, so each would be its own commit
      for (let i = 0; i < 10; i++) await advance(200);
      expect(commits, "10 checks, target unchanged: no render").toBe(0);
      box = { ...box, left: 40 };
      await advance(250);
      expect(commits, "it moved: one render").toBe(1);
    } finally {
      target.remove();
    }
  });
});
