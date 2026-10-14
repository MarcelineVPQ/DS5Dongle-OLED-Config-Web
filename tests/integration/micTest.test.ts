// @vitest-environment jsdom
// The microphone test: one button starts and stops it, a segmented meter
// shows the controller's raw mic live while it runs, the mic is heard live
// only with a headset (and an Audio output that plays to it), and Listen back
// plays the last seconds only after the mic is closed, normalized to the
// speaker test's level, with a status line that always says what's happening.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import i18n from "../../src/i18n";
import { MicTest } from "../../src/desktop/live/PartPanel";
import { findControllerAudio } from "../../src/desktop/controllerAudio";
import { LISTEN_SECONDS, MAX_GAIN, MIC_QUIET, QUIET_GAIN, normalizeClip, playbackGain } from "../../src/desktop/live/micTest";
import { PEAK } from "../../src/desktop/live/speakerTune";
import type { SpeakerSelect } from "../../src/protocol/config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Device = { kind: MediaDeviceKind; label: string; deviceId: string };
const CONTROLLER: Device[] = [
  { kind: "audioinput", label: "Default - Microphone (DualSense Wireless Controller)", deviceId: "default" },
  { kind: "audioinput", label: "Monitor of DualSense Wireless Controller Analog Stereo", deviceId: "monitor" },
  { kind: "audioinput", label: "Built-in Audio Analog Stereo", deviceId: "pc-mic" },
  { kind: "audioinput", label: "Microphone (DualSense Wireless Controller)", deviceId: "ds5-mic" },
  { kind: "audiooutput", label: "Speakers (Realtek(R) Audio)", deviceId: "pc-speaker" },
  { kind: "audiooutput", label: "DualSense Wireless Controller Analog Stereo", deviceId: "ds5-speaker" },
];

describe("controller audio matcher", () => {
  it("picks the controller's mic and speaker, never the PC's, a monitor or the default alias", () => {
    expect(findControllerAudio(CONTROLLER, "audioinput")).toBe("ds5-mic");
    expect(findControllerAudio(CONTROLLER, "audiooutput")).toBe("ds5-speaker");
    expect(findControllerAudio([{ kind: "audioinput" as const, label: "Wireless Controller", deviceId: "edge" }], "audioinput")).toBe("edge");
  });

  it("finds none without the controller", () => {
    const pcOnly = CONTROLLER.filter((d) => d.deviceId.startsWith("pc-"));
    expect(findControllerAudio(pcOnly, "audioinput")).toBeNull();
    expect(findControllerAudio(pcOnly, "audiooutput")).toBeNull();
  });
});

describe("listen back loudness", () => {
  it("brings the peak to the speaker test's level, capped, never clipping", () => {
    expect(playbackGain(0.4)).toBeCloseTo(PEAK / 0.4);
    expect(playbackGain(0.1)).toBeCloseTo(PEAK / 0.1); // ×8
    expect(playbackGain(0.03)).toBe(MAX_GAIN); // would need ×26.7
    expect(playbackGain(MIC_QUIET / 2)).toBe(QUIET_GAIN); // almost silent: noise isn't made a roar
    expect(playbackGain(0)).toBe(1);
    expect(playbackGain(1)).toBeCloseTo(PEAK); // already loud: brought down, not clipped
    for (const peak of [0.001, 0.01, 0.05, 0.2, 0.9, 1]) expect(peak * playbackGain(peak)).toBeLessThanOrEqual(PEAK + 1e-9);
  });

  it("scales every channel in place and reports the gain", () => {
    const a = Float32Array.of(0, 0.1, -0.05);
    const b = Float32Array.of(0.02, -0.1, 0);
    const { peak, gain } = normalizeClip([a, b]);
    expect(peak).toBeCloseTo(0.1);
    expect(gain).toBeCloseTo(8);
    expect(Math.max(...a.map(Math.abs), ...b.map(Math.abs))).toBeCloseTo(PEAK);
  });
});

let devices = CONTROLLER;
let tracks: FakeTrack[] = [];
let sources: FakeSource[] = [];
let buffers: FakeBuffer[] = [];
let sinks: string[] = [];
let analyserReads = 0;
let constraints: MediaStreamConstraints | null = null;
let loopConnected = false;
let ring = new Float32Array(0);
let micOpenAtPlay: boolean[] = [];
let startThrows = false;

class FakeTrack {
  stopped = false;
  private ended: (() => void) | null = null;
  addEventListener(_: string, cb: () => void) {
    this.ended = cb;
  }
  stop() {
    this.stopped = true;
  }
  end() {
    this.ended?.();
  }
}
class FakeBuffer {
  data = new Float32Array(0);
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    buffers.push(this);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  copyToChannel(d: Float32Array) {
    this.data = d.slice();
  }
}
class FakeSource {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  stopped = false;
  constructor() {
    sources.push(this);
  }
  connect(node: unknown) {
    return node;
  }
  start() {
    if (startThrows) throw new Error("no output");
    micOpenAtPlay.push(tracks.some((t) => !t.stopped));
    setTimeout(() => this.onended?.(), (this.buffer?.duration ?? 0) * 1000);
  }
  stop() {
    this.stopped = true;
  }
}
const LOOP = { connect: (n: unknown) => n };
class FakeWorkletNode {
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: () => setTimeout(() => this.port.onmessage?.({ data: { samples: ring.slice(), sampleRate: 1000 } }), 0),
  };
}
class FakeContext {
  destination = {};
  audioWorklet = { addModule: () => Promise.resolve() };
  setSinkId = (id: string) => {
    sinks.push(id);
    return Promise.resolve();
  };
  createAnalyser = () => ({
    fftSize: 1024,
    getFloatTimeDomainData: (buf: Float32Array) => {
      analyserReads++;
      buf.fill(0.3);
    },
  });
  createMediaStreamSource = () => ({
    connect: (n: unknown) => {
      if (n === LOOP) loopConnected = true;
      return n;
    },
    disconnect: (n: unknown) => {
      if (n === LOOP) loopConnected = false;
    },
  });
  createGain = () => LOOP;
  createBuffer = (_: number, length: number, rate: number) => new FakeBuffer(length, rate);
  createBufferSource = () => new FakeSource();
  close = () => Promise.resolve();
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  vi.useFakeTimers();
  await i18n.changeLanguage("en");
  devices = CONTROLLER;
  tracks = [];
  sources = [];
  buffers = [];
  sinks = [];
  analyserReads = 0;
  constraints = null;
  loopConnected = false;
  micOpenAtPlay = [];
  startThrows = false;
  ring = Float32Array.from({ length: LISTEN_SECONDS * 1000 }, (_, i) => (i % 2 ? 0.1 : -0.05));
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getUserMedia: (c: MediaStreamConstraints) => {
        constraints = c;
        const track = new FakeTrack();
        tracks.push(track);
        return Promise.resolve({ getTracks: () => [track] });
      },
    },
  });
  // jsdom reports "prerender"; the app's window-shown store wants "visible".
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const mount = (headset = false, output: SpeakerSelect = 0) => act(() => root!.render(createElement(MicTest, { headset, output })));
const buttons = () => [...container!.querySelectorAll<HTMLButtonElement>("button:not(.dk-info)")];
const press = (label: string) =>
  act(() =>
    buttons()
      .find((b) => b.textContent?.includes(label))!
      .click(),
  );
const status = () => container!.querySelector('[role="status"]')!.textContent ?? "";
const lit = () => container!.querySelectorAll(".mic-vu i[data-lit]").length;

describe("microphone test", () => {
  it("toggles: Mic Test opens the controller's raw mic, Stop test closes it", async () => {
    mount();
    press("Mic Test");
    await wait(100);
    expect(constraints).toEqual({
      audio: { deviceId: { exact: "ds5-mic" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    expect(sinks).toEqual(["ds5-speaker"]);
    expect(status()).toContain("Testing");
    expect(buttons()[0].textContent).toBe("Stop test");
    press("Stop test");
    await wait(50);
    expect(tracks[0].stopped).toBe(true);
    expect(buttons()[0].textContent).toBe("Mic Test");
    expect(status()).toContain("Test stopped");
    expect(sources).toHaveLength(0); // stopping never plays anything
  });

  it("runs the meter only while testing", async () => {
    mount();
    await wait(200);
    expect(analyserReads).toBe(0);
    expect(lit()).toBe(0);
    press("Mic Test");
    await wait(100); // the test opens
    await wait(100); // the meter's frames
    expect(analyserReads).toBeGreaterThan(0);
    expect(lit()).toBe(Math.round(Math.sqrt(0.3) * 20));
    press("Stop test");
    await wait(50);
    const reads = analyserReads;
    await wait(1000);
    expect(analyserReads).toBe(reads);
    expect(lit()).toBe(0);
  });

  it("loops the mic back live only with a headset that Audio output plays to", async () => {
    mount(false);
    press("Mic Test");
    await wait(100);
    expect(loopConnected).toBe(false);
    expect(status()).toContain("No live sound without a headset");
    mount(true); // plugged in during the test
    await wait(20);
    expect(loopConnected).toBe(true);
    expect(status()).toContain("live on the headset");
    mount(true, 1); // Audio output: Speaker would feed back
    await wait(20);
    expect(loopConnected).toBe(false);
    expect(status()).toContain("Audio output is set to Speaker");
    mount(false, 0); // unplugged
    await wait(20);
    expect(loopConnected).toBe(false);
  });

  it("listens back only after the mic is closed, normalized, saying so while it plays", async () => {
    mount();
    press("Mic Test");
    await wait(100);
    press("Listen back");
    await wait(10);
    expect(tracks[0].stopped).toBe(true);
    expect(sources).toHaveLength(1);
    expect(micOpenAtPlay).toEqual([false]);
    expect(status()).toBe(i18n.t("desktop.audioTest.playingBack"));
    expect(container!.querySelector('[role="progressbar"]')).not.toBeNull();
    const played = buffers[0].data;
    expect(Math.max(...played.map(Math.abs))).toBeCloseTo(PEAK); // 0.1 × 8
    await wait(1500);
    expect(status()).toBe(i18n.t("desktop.audioTest.playingBack")); // the whole playback
    await wait(2000);
    expect(status()).toContain(i18n.t("desktop.audioTest.micDone"));
  });

  it("says when the recording is almost silent, played at the capped gain", async () => {
    ring = ring.map((v) => v / 10); // peak 0.01
    mount();
    press("Mic Test");
    await wait(100);
    press("Listen back");
    await wait(10);
    expect(Math.max(...buffers[0].data.map(Math.abs))).toBeCloseTo(0.01 * QUIET_GAIN);
    await wait(4000);
    expect(status()).toBe(i18n.t("desktop.audioTest.micQuiet"));
  });

  it("says so when the playback fails, instead of staying silent", async () => {
    startThrows = true;
    mount();
    press("Mic Test");
    await wait(100);
    press("Listen back");
    await wait(10);
    expect(status()).toBe(i18n.t("desktop.audioTest.problem.playback"));
    expect(container!.querySelector(".dk-bad")).not.toBeNull();
  });

  it("says the microphone isn't found without the controller's input", async () => {
    devices = CONTROLLER.filter((d) => d.kind === "audiooutput");
    mount();
    press("Mic Test");
    await wait(50);
    expect(status()).toBe(i18n.t("desktop.audioTest.problem.no-mic"));
    expect(tracks).toHaveLength(0);
    expect(buttons()[0].textContent).toBe("Mic Test");
  });

  it("says so when the mic goes away during the test", async () => {
    mount();
    press("Mic Test");
    await wait(100);
    act(() => tracks[0].end());
    await wait(50);
    expect(status()).toBe(i18n.t("desktop.audioTest.problem.lost"));
  });

  it("Stop test also stops a playback", async () => {
    mount();
    press("Mic Test");
    await wait(100);
    press("Listen back");
    await wait(500);
    press("Stop test");
    await wait(20);
    expect(sources[0].stopped).toBe(true);
    expect(buttons()[0].textContent).toBe("Mic Test");
  });

  it("stops the mic and the meter when the panel closes", async () => {
    mount();
    press("Mic Test");
    await wait(100);
    act(() => root!.render(createElement("div")));
    await wait(50);
    expect(tracks[0].stopped).toBe(true);
    const reads = analyserReads;
    await wait(1000);
    expect(analyserReads).toBe(reads);
    expect(sources).toHaveLength(0);
  });

  it("stops the mic when the window hides", async () => {
    mount(true);
    press("Mic Test");
    await wait(100);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await wait(50);
    expect(tracks[0].stopped).toBe(true);
    expect(loopConnected).toBe(false);
    expect(buttons()[0].textContent).toBe("Mic Test");
  });
});
