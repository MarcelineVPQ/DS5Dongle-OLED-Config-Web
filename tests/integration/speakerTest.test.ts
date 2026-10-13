// @vitest-environment jsdom
// The speaker test's tune belongs to the app-wide player (speakerPlayer.ts):
// leaving the Speaker panel doesn't stop it, coming back shows the running
// countdown and progress line, and Stop or the controller going away stops it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import { SpeakerTest } from "../../src/desktop/live/PartPanel";
import { speakerPlayback, stopSpeakerTest } from "../../src/desktop/live/speakerPlayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let sources: FakeSource[] = [];
class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  stopped = false;
  constructor() {
    sources.push(this);
  }
  connect(node: unknown) {
    return node;
  }
  disconnect() {}
  start() {}
  stop() {
    this.stopped = true;
    setTimeout(() => this.onended?.(), 25);
  }
}
class FakeContext {
  sampleRate = 8000;
  currentTime = 0;
  destination = {};
  setSinkId = () => Promise.resolve();
  createBuffer = () => ({ copyToChannel() {} });
  createBufferSource = () => new FakeSource();
  createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: (n: unknown) => n });
  close = () => Promise.resolve();
}

let devices = [{ kind: "audiooutput", label: "DualSense Wireless Controller", deviceId: "ds5" }];
const deviceListeners = new Set<() => void>();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  sources = [];
  devices = [{ kind: "audiooutput", label: "DualSense Wireless Controller", deviceId: "ds5" }];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      addEventListener: (_: string, l: () => void) => deviceListeners.add(l),
      removeEventListener: (_: string, l: () => void) => deviceListeners.delete(l),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  stopSpeakerTest();
  await act(() => vi.advanceTimersByTimeAsync(100));
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const mount = () => act(() => root!.render(createElement(SpeakerTest)));
const unmount = () => act(() => root!.render(createElement("div")));
const button = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(label));
const progress = () => Number(container!.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"));

describe("speaker test playback", () => {
  it("keeps playing when the panel unmounts and shows the progress when it comes back", async () => {
    mount();
    act(() => button("Play")!.click());
    await wait(100);
    expect(speakerPlayback().playing).toBe(true);
    unmount();
    await wait(20_000);
    expect(speakerPlayback().playing).toBe(true);
    expect(sources[0].stopped).toBe(false);
    mount();
    await wait(100);
    const play = button("Play")!;
    expect(play.getAttribute("aria-busy")).toBe("true");
    const left = Math.ceil(speakerPlayback().duration) - 20;
    expect(play.textContent).toMatch(new RegExp(`${left}s$`));
    expect(progress()).toBeGreaterThanOrEqual(25);
    expect(button("Stop")).toBeDefined();
  });

  it("stops on Stop", async () => {
    mount();
    act(() => button("Play")!.click());
    await wait(1000);
    act(() => button("Stop")!.click());
    await wait(100);
    expect(sources[0].stopped).toBe(true);
    expect(speakerPlayback().playing).toBe(false);
    expect(button("Play")!.getAttribute("aria-busy")).toBeNull();
    expect(button("Stop")).toBeUndefined();
    expect(progress()).toBe(0);
  });

  it("stops when the controller's speaker goes away", async () => {
    mount();
    act(() => button("Play")!.click());
    await wait(1000);
    unmount();
    devices = [];
    deviceListeners.forEach((l) => l());
    await wait(100);
    expect(sources[0].stopped).toBe(true);
    expect(speakerPlayback().playing).toBe(false);
  });
});
