// @vitest-environment jsdom
// An idle window on screen draws (almost) nothing: what used to make frames
// with nobody touching anything now waits for a real change.
//   - The live controller view: a report that shows nothing new (a controller
//     put down: sensor noise inside a small deadband) stops re-rendering once
//     the spark lines have scrolled flat; the link numbers change once a second.
//   - The background's pan, zoom and crossfade: stepped from script together
//     (10 a second), none while the window isn't focused, none with Reduce
//     motion; never a CSS animation or transition.
//   - The "Connected" dot pulses three times when the controller connects,
//     then stays steady.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyInputReport, sameShownInput, type InputReport } from "../../src/oled/inputReport";
import type { Ds5BridgeClient } from "../../src/protocol/bridgeClient";
import { FADE_MS, fadeProgress, panTransform } from "../../src/desktop/live/backdropPan";
import i18n from "../../src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
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
    onRunningGame: () => () => undefined,
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
    expect(sameShownInput(a, { ...a, gyroX: 50 })).toBe(false);
    expect(sameShownInput(a, { ...a, leftStick: { x: 129, y: 128 } })).toBe(false);
    expect(sameShownInput(a, { ...a, cross: true })).toBe(false);
    expect(sameShownInput(a, { ...a, fingers: [{ ...a.fingers[0], touching: true }, a.fingers[1]] })).toBe(false);
    expect(sameShownInput(a, { ...a, leftStick: { ...a.leftStick } })).toBe(true);
  });
  it("lets the motion sensors' resting noise through, not a real move", () => {
    const a = emptyInputReport();
    expect(sameShownInput({ ...a, gyroX: 10, gyroZ: -10 }, a)).toBe(true);
    expect(sameShownInput({ ...a, gyroY: 11 }, a)).toBe(false);
    expect(sameShownInput({ ...a, accelY: a.accelY + 20 }, a)).toBe(true);
    expect(sameShownInput({ ...a, accelX: -21 }, a)).toBe(false);
  });
});

describe("the live controller view at rest", () => {
  it("stops re-rendering once a still report has scrolled the spark lines flat, and wakes on a change", async () => {
    const { useLiveInput, STILL_REPAINTS } = await import("../../src/desktop/useLiveInput");
    let report: InputReport = emptyInputReport();
    let seq = 0;
    // A fresh object every read (as decoded from the board): the counter
    // moving and the gyro jittering, as a real controller put down does.
    const client = { readInput: () => Promise.resolve({ ...report, leftStick: { ...report.leftStick }, gyroX: report.gyroX + ((seq % 7) - 3), seq: seq++ & 0xff }) } as unknown as Ds5BridgeClient;
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

  it("steps 10 times a second while focused and holds still whenever it isn't", async () => {
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
    // Another window (or a game) in front: the background holds.
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

  it("crossfades in 40 steps with the pan, and finishes at once when the window loses focus", async () => {
    vi.resetModules();
    const { bd } = await mountArt();
    act(() => window.dispatchEvent(new Event("focus")));
    const fade = () => bd.style.getPropertyValue("--bd-fade");
    await advance(FADE_MS + 500);
    expect(fade()).toBe("1"); // the first game has faded in
    // The next game, 20 s after the start: a 4 s fade in 100 ms steps.
    await advance(20_000 - FADE_MS - 500);
    const seen = new Set<string>();
    // loop: NOT-WORTH — test: 50 samples of 100 ms
    for (let i = 0; i < 50; i++) {
      await advance(100);
      seen.add(fade());
    }
    expect(seen.size).toBeGreaterThanOrEqual(38);
    expect(seen.size).toBeLessThanOrEqual(42);
    expect(fade()).toBe("1");
    // Unfocused mid-fade: no cycle, and a fade underway jumps to its end.
    await advance(20_000 - 5000 + 1000);
    expect(Number(fade())).toBeLessThan(1);
    act(() => window.dispatchEvent(new Event("blur")));
    await advance(10);
    expect(fade()).toBe("1");
    expect(fadeProgress(0)).toBe("0.000");
    expect(fadeProgress(FADE_MS)).toBe("1");
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
    // No CSS crossfade either: the opacity follows --bd-fade.
    expect(/\.art-bd-layer \{[^}]*\}/.exec(css)?.[0]).not.toMatch(/transition/);
  });
});

describe("the Connected dot", () => {
  it("pulses (a few times, never endlessly) when the controller connects, not when the page is opened again", async () => {
    vi.resetModules();
    const { ConnectedDot, resetConnectedDot } = await import("../../src/desktop/live/ControllerView");
    act(() => root.render(createElement(ConnectedDot)));
    expect(container.querySelector(".live-spec-dot")?.classList.contains("pulse")).toBe(true);
    // Away and back: steady.
    act(() => root.render(null));
    act(() => root.render(createElement(ConnectedDot)));
    expect(container.querySelector(".live-spec-dot")?.classList.contains("pulse")).toBe(false);
    // Disconnected and connected again: it pulses again.
    act(() => root.render(null));
    resetConnectedDot();
    act(() => root.render(createElement(ConnectedDot)));
    expect(container.querySelector(".live-spec-dot")?.classList.contains("pulse")).toBe(true);
    const css = (await import("node:fs")).readFileSync("src/desktop/desktop.css", "utf8");
    expect(css).toMatch(/\.live-spec-dot\.pulse::after \{\s*animation: live-spec-pulse 2\.4s ease-out 3;/);
    expect(css).not.toMatch(/live-spec-pulse[^;]*infinite/);
  });
});

describe("the Connection numbers", () => {
  it("change once a second, not with every input frame", async () => {
    await i18n.changeLanguage("en");
    const { default: LiveData } = await import("../../src/desktop/live/LiveData");
    const { liveStats } = await import("../../src/desktop/useLiveInput");
    liveStats.hz = 30;
    liveStats.ms = 2;
    const text = () => container.textContent ?? "";
    act(() => root.render(createElement(LiveData, { input: emptyInputReport(), rssi: 0 })));
    expect(text()).toContain("30.0 /s");
    liveStats.hz = 29.5;
    liveStats.ms = 3.3;
    // A new input frame: the numbers stay.
    act(() => root.render(createElement(LiveData, { input: { ...emptyInputReport(), cross: true }, rssi: 0 })));
    expect(text()).toContain("30.0 /s");
    await advance(1000);
    expect(text()).toContain("29.5 /s");
    expect(text()).toContain("3.3 ms");
  });
});
