// @vitest-environment jsdom
// An idle window on screen draws (almost) nothing: what used to make frames
// with nobody touching anything now waits for a real change.
//   - The live controller view: a report that shows nothing new (a controller
//     put down) stops re-rendering once the spark lines have scrolled flat.
//   - The background's pan and zoom: stepped from script (10 a second, 4
//     behind another window, none while a game runs and the window isn't
//     focused, none with Reduce motion), never a CSS animation.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyInputReport, sameShownInput, type InputReport } from "../../src/oled/inputReport";
import type { Ds5BridgeClient } from "../../src/protocol/bridgeClient";
import { panTransform } from "../../src/desktop/live/backdropPan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let running: ((key: string | null) => void) | null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  running = null;
  vi.stubGlobal("desktop", {
    platform: "linux",
    getSettings: () => Promise.resolve({ hardwareAcceleration: false }),
    onWindowVisible: () => () => undefined,
    // Two recently played games with art: the art background cycles.
    gamesDetails: () =>
      Promise.resolve({
        "steam-1:steam:1": { art: ["hero"], lastPlayed: 2 },
        "steam-1:steam:2": { art: ["hero"], lastPlayed: 1 },
      }),
    gamesRunning: () => Promise.resolve(null),
    onRunningGame: (l: (key: string | null) => void) => ((running = l), () => (running = null)),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("what the live view counts as a change", () => {
  it("ignores the report counter and the motion clock, nothing else", () => {
    const a = emptyInputReport();
    expect(sameShownInput(a, { ...a, seq: 9, sensorTime: 12345 })).toBe(true);
    expect(sameShownInput(a, { ...a, gyroX: 1 })).toBe(false);
    expect(sameShownInput(a, { ...a, leftStick: { x: 129, y: 128 } })).toBe(false);
    expect(sameShownInput(a, { ...a, cross: true })).toBe(false);
    expect(sameShownInput(a, { ...a, fingers: [{ ...a.fingers[0], touching: true }, a.fingers[1]] })).toBe(false);
    expect(sameShownInput(a, { ...a, leftStick: { ...a.leftStick } })).toBe(true);
  });
});

describe("the live controller view at rest", () => {
  it("stops re-rendering once a still report has scrolled the spark lines flat, and wakes on a change", async () => {
    const { useLiveInput, STILL_REPAINTS } = await import("../../src/desktop/useLiveInput");
    let report: InputReport = emptyInputReport();
    let seq = 0;
    // A fresh object every read (as decoded from the board), only the counter moving.
    const client = { readInput: () => Promise.resolve({ ...report, leftStick: { ...report.leftStick }, seq: seq++ & 0xff }) } as unknown as Ds5BridgeClient;
    let renders = 0;
    function View() {
      useLiveInput(client, true);
      renders++;
      return null;
    }
    act(() => root.render(createElement(View)));
    // act() batches renders: step a poll at a time. Well past the repaints a
    // still report gets (33 ms polls).
    const run = async (polls: number) => {
      // loop: NOT-WORTH — test: one act per poll
      for (let i = 0; i < polls; i++) await advance(33);
    };
    await run(STILL_REPAINTS + 60);
    const settled = renders;
    expect(settled).toBeGreaterThan(STILL_REPAINTS / 2);
    expect(settled).toBeLessThanOrEqual(STILL_REPAINTS + 3);
    await run(150);
    expect(renders).toBe(settled); // 150 polls later: not one render
    report = { ...report, cross: true };
    await run(5);
    expect(renders).toBeGreaterThan(settled);
  });
});

describe("the background's pan and zoom", () => {
  it("follows the old CSS animation's path: 46 s one way, eased, then back", () => {
    expect(panTransform(0)).toBe("scale(1.0000) translate(-2.000%, -1.000%)");
    expect(panTransform(23)).toBe("scale(1.0600) translate(0.000%, 0.250%)");
    expect(panTransform(46)).toBe("scale(1.1200) translate(2.000%, 1.500%)");
    expect(panTransform(69)).toBe(panTransform(23));
    expect(panTransform(92)).toBe(panTransform(0));
    // Eased: slow near the ends, faster in the middle.
    const scale = (t: number) => Number(/scale\(([\d.]+)\)/.exec(panTransform(t))![1]);
    expect(scale(4.6) - scale(0)).toBeLessThan(scale(25.3) - scale(20.7));
  });

  async function mountArt() {
    window.localStorage.setItem("ds5.background", "art");
    const { default: ArtBackdrop } = await import("../../src/desktop/live/ArtBackdrop");
    act(() => root.render(createElement(ArtBackdrop, { colors: null })));
    await advance(50);
    const bd = container.querySelector<HTMLElement>(".art-bd")!;
    const steps: string[] = [];
    let last = "";
    const sample = () => {
      const v = bd.style.getPropertyValue("--bd-pan");
      if (v !== last) steps.push((last = v));
    };
    return { bd, steps, sample };
  }

  it("steps 10 times a second while focused and holds still while a game runs behind it", async () => {
    vi.resetModules();
    const { steps, sample } = await mountArt();
    act(() => window.dispatchEvent(new Event("focus")));
    // To the middle of a leg, where it moves fastest (near the ends a step
    // can round to the same transform: no change, no frame).
    await advance(20_000);
    sample();
    steps.length = 0;
    // loop: NOT-WORTH — test: 20 samples of 50 ms
    for (let i = 0; i < 20; i++) {
      await advance(50);
      sample();
    }
    expect(steps.length).toBeGreaterThanOrEqual(9);
    expect(steps.length).toBeLessThanOrEqual(11);
    // A game starts and the player switches to it: the background holds.
    act(() => running?.("steam-1:steam:1"));
    act(() => window.dispatchEvent(new Event("blur")));
    await advance(50);
    sample();
    const held = steps.length;
    // loop: NOT-WORTH — test: 40 samples of 50 ms
    for (let i = 0; i < 40; i++) {
      await advance(50);
      sample();
    }
    expect(steps.length).toBe(held);
    // Back to the app: it moves again.
    act(() => window.dispatchEvent(new Event("focus")));
    await advance(500);
    sample();
    expect(steps.length).toBeGreaterThan(held);
  });

  it("is not a CSS animation and stays still with Reduce motion", async () => {
    vi.resetModules();
    window.localStorage.setItem("ds5.reduceMotion", "1");
    const { bd, steps, sample } = await mountArt();
    await advance(2000);
    sample();
    expect(steps).toEqual([]);
    expect(bd.style.getPropertyValue("--bd-pan")).toBe("");
    const css = (await import("node:fs")).readFileSync("src/desktop/desktop.css", "utf8");
    expect(css).not.toMatch(/art-bd-kenburns/);
  });
});
