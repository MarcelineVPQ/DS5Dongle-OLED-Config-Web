// @vitest-environment jsdom
// The microphone test records in the page with Chromium's audio capture,
// only from the input named like the controller (the same matcher as the
// speaker), with the browser's processing off, plays the clip back on the
// controller's speaker, and stops the stream and the level loop as soon as
// the test ends or the panel closes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import i18n from "../../src/i18n";
import { MicTest } from "../../src/desktop/live/PartPanel";
import { findControllerAudio } from "../../src/desktop/controllerAudio";

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

let devices = CONTROLLER;
let tracks: { stopped: boolean; stop(): void }[] = [];
let recorders: FakeRecorder[] = [];
let sources: FakeSource[] = [];
let sinks: string[] = [];
let analyserReads = 0;
let constraints: MediaStreamConstraints | null = null;

class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["clip"]) });
    this.onstop?.();
  }
}
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
  start() {
    setTimeout(() => this.onended?.(), 3000);
  }
  stop() {
    this.stopped = true;
    setTimeout(() => this.onended?.(), 0);
  }
}
let clipLevel = 0.5;
class FakeContext {
  destination = {};
  setSinkId = (id: string) => {
    sinks.push(id);
    return Promise.resolve();
  };
  createAnalyser = () => ({
    fftSize: 2048,
    getFloatTimeDomainData: (buf: Float32Array) => {
      analyserReads++;
      buf.fill(0.3);
    },
  });
  createMediaStreamSource = () => ({ connect: (n: unknown) => n });
  decodeAudioData = () => Promise.resolve({ numberOfChannels: 1, getChannelData: () => Float32Array.of(0, clipLevel, -clipLevel / 5) });
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
  recorders = [];
  sources = [];
  sinks = [];
  analyserReads = 0;
  constraints = null;
  clipLevel = 0.5;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () => Promise.resolve(devices),
      getUserMedia: (c: MediaStreamConstraints) => {
        constraints = c;
        const track = {
          stopped: false,
          stop() {
            this.stopped = true;
          },
        };
        tracks.push(track);
        return Promise.resolve({ getTracks: () => [track] });
      },
    },
  });
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
const mount = () => act(() => root!.render(createElement(MicTest)));
const start = () => act(() => container!.querySelector<HTMLButtonElement>("button")!.click());
const text = () => container!.textContent ?? "";

describe("microphone test", () => {
  it("records the controller's raw mic, plays it back on its speaker, then stops everything", async () => {
    mount();
    start();
    await wait(1000);
    expect(constraints).toEqual({
      audio: { deviceId: { exact: "ds5-mic" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    expect(sinks).toEqual(["ds5-speaker"]);
    expect(text()).toContain("speak now");
    expect(text()).toContain("30%");
    await wait(2100);
    expect(tracks[0].stopped).toBe(true);
    expect(text()).toContain("Playing it back");
    const reads = analyserReads;
    await wait(3100);
    expect(analyserReads).toBe(reads); // the level loop ended with the recording
    expect(text()).toContain(i18n.t("desktop.audioTest.micDone"));
  });

  it("says when the clip is almost silent", async () => {
    clipLevel = 0.01;
    mount();
    start();
    await wait(7000);
    expect(text()).toContain(i18n.t("desktop.audioTest.micQuiet"));
  });

  it("says the microphone isn't found without the controller's input", async () => {
    devices = CONTROLLER.filter((d) => d.kind === "audiooutput");
    mount();
    start();
    await wait(100);
    expect(text()).toContain(i18n.t("desktop.audioTest.problem.no-mic"));
    expect(tracks).toHaveLength(0);
  });

  it("stops the stream, the recorder and the level loop when the panel closes", async () => {
    mount();
    start();
    await wait(1000);
    expect(tracks[0].stopped).toBe(false);
    act(() => root!.render(createElement("div")));
    await wait(50);
    expect(tracks[0].stopped).toBe(true);
    expect(recorders[0].state).toBe("inactive");
    const reads = analyserReads;
    await wait(5000);
    expect(analyserReads).toBe(reads);
    expect(sources).toHaveLength(0); // never played back
  });

  it("stops the playback when the panel closes", async () => {
    mount();
    start();
    await wait(3500);
    expect(sources).toHaveLength(1);
    act(() => root!.render(createElement("div")));
    await wait(50);
    expect(sources[0].stopped).toBe(true);
  });
});
