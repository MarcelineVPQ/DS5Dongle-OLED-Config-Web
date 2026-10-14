// Counts the live resources a page holds, for the leak test (CLAUDE.md
// "Lifetime pass"): DOM listeners (addEventListener minus removeEventListener,
// `once` and AbortSignal removals included), pending timers / intervals /
// animation frames (vitest's fake timers), microphone tracks not stopped,
// AudioContexts not closed, observers still observing, and window.desktop
// subscriptions not unsubscribed. Install before the page mounts; read
// `snapshot()` before and after.
import { vi } from "vitest";

type Entry = { target: EventTarget; type: string; listener: unknown; capture: boolean };

export interface LeakCounts {
  listeners: number;
  timers: number;
  tracks: number;
  audioContexts: number;
  observers: number;
  subscriptions: number;
}

export interface LeakProbe {
  snapshot(): LeakCounts;
  // What is still registered, for a failure message ("window resize", ...).
  describe(): string[];
  // window.desktop: calls answered by `known`, on*(listener) counted (each
  // returns its unsubscribe), anything else resolves to {}.
  desktop(known?: Record<string, unknown>): Record<string, unknown>;
  // For a test to fire a desktop subscription (e.g. a tray command).
  emit(name: string, ...args: unknown[]): void;
  restore(): void;
}

// A listener on an element that has left the document goes with the element
// (React puts "load", "invalid", "toggle" ... on the element itself and never
// removes them): only listeners on window, document, attached nodes and
// other objects (media queries, devices, sockets) can outlive a page.
const holds = (e: Entry) => !(e.target instanceof Node) || e.target === document || e.target.isConnected;
const capOf = (o: boolean | AddEventListenerOptions | undefined) => (typeof o === "boolean" ? o : Boolean(o?.capture));
const nameOf = (t: EventTarget) => (t === window ? "window" : t === document ? "document" : t instanceof Element ? t.tagName.toLowerCase() : (t.constructor?.name ?? "target"));

export function installLeakProbe(): LeakProbe {
  const live: Entry[] = [];
  const find = (e: Omit<Entry, "listener"> & { listener: unknown }) => live.findIndex((x) => x.target === e.target && x.type === e.type && x.listener === e.listener && x.capture === e.capture);
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const wrapAdd = (add: EventTarget["addEventListener"]) =>
    function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      add.call(this, type, listener, options);
      if (!listener) return;
      const entry = { target: this, type, listener: listener as unknown, capture: capOf(options) };
      if (find(entry) >= 0) return; // the DOM ignores a duplicate
      if (typeof options === "object" && options.once) return; // gone when it fires
      live.push(entry);
      if (typeof options === "object" && options.signal) {
        options.signal.addEventListener("abort", () => {
          const i = find(entry);
          if (i >= 0) live.splice(i, 1);
        });
      }
    };
  const wrapRemove = (remove: EventTarget["removeEventListener"]) =>
    function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      remove.call(this, type, listener, options);
      const i = find({ target: this, type, listener: listener as unknown, capture: capOf(options) });
      if (i >= 0) live.splice(i, 1);
    };
  // jsdom's window has its own pair (another realm's EventTarget).
  const winAdd = window.addEventListener;
  const winRemove = window.removeEventListener;
  proto.addEventListener = wrapAdd(add);
  proto.removeEventListener = wrapRemove(remove);
  window.addEventListener = wrapAdd(winAdd);
  window.removeEventListener = wrapRemove(winRemove);

  // Microphone tracks and AudioContexts.
  const tracks = new Set<{ stopped: boolean }>();
  const contexts = new Set<{ closed: boolean }>();
  class FakeNode {
    port = { onmessage: null as unknown, postMessage: () => undefined };
    connect(n: unknown) {
      return n;
    }
    disconnect() {}
  }
  class FakeContext {
    closed = false;
    sampleRate = 48000;
    currentTime = 0;
    state = "running";
    destination = new FakeNode();
    audioWorklet = { addModule: () => Promise.resolve() };
    constructor() {
      contexts.add(this);
    }
    setSinkId = () => Promise.resolve();
    resume = () => Promise.resolve();
    createAnalyser = () => Object.assign(new FakeNode(), { fftSize: 1024, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) });
    createMediaStreamSource = () => new FakeNode();
    createGain = () => Object.assign(new FakeNode(), { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} } });
    createBuffer = (channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      numberOfChannels: channels,
      copyToChannel() {},
      getChannelData: () => new Float32Array(length),
    });
    createBufferSource = () => Object.assign(new FakeNode(), { buffer: null, onended: null, start() {}, stop() {} });
    close = () => {
      this.closed = true;
      contexts.delete(this);
      return Promise.resolve();
    };
  }
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  const devices = [
    { kind: "audioinput", label: "Microphone (DualSense Wireless Controller)", deviceId: "ds5-mic" },
    { kind: "audiooutput", label: "DualSense Wireless Controller Analog Stereo", deviceId: "ds5-speaker" },
  ];
  const mediaDevices = Object.assign(new EventTarget(), {
    enumerateDevices: () => Promise.resolve(devices),
    getUserMedia: () => {
      const track = {
        stopped: false,
        kind: "audio",
        stop() {
          this.stopped = true;
          tracks.delete(this);
        },
        getSettings: () => ({ deviceId: "ds5-mic" }),
        addEventListener() {},
        removeEventListener() {},
      };
      tracks.add(track);
      return Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
    },
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });

  // Observers: one count per observer that observes something and isn't disconnected.
  const observing = new Set<object>();
  const counted = (Base: new (...a: never[]) => object) =>
    class extends (Base as new (...a: unknown[]) => { observe?(...a: unknown[]): void; disconnect?(): void }) {
      observe(...a: unknown[]) {
        observing.add(this);
        super.observe?.(...a);
      }
      disconnect() {
        observing.delete(this);
        super.disconnect?.();
      }
    };
  class Inert {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("ResizeObserver", counted(Inert));
  vi.stubGlobal("IntersectionObserver", counted(Inert));
  const RealMutationObserver = globalThis.MutationObserver;
  vi.stubGlobal("MutationObserver", counted(RealMutationObserver as never));

  // window.desktop subscriptions.
  const subs = new Map<string, Set<(...a: unknown[]) => void>>();
  const subscribe = (name: string) => (listener: (...a: unknown[]) => void) => {
    if (!subs.has(name)) subs.set(name, new Set());
    const set = subs.get(name)!;
    // Each subscription is its own entry, even with the same function.
    const entry = (...a: unknown[]) => listener(...a);
    set.add(entry);
    return () => set.delete(entry);
  };

  return {
    snapshot: () => ({
      listeners: live.filter(holds).length,
      timers: vi.getTimerCount(),
      tracks: tracks.size,
      audioContexts: contexts.size,
      observers: observing.size,
      subscriptions: [...subs.values()].reduce((n, s) => n + s.size, 0),
    }),
    describe: () => [
      ...live.filter(holds).map((e) => `listener ${nameOf(e.target)} "${e.type}"`),
      ...[...subs].filter(([, s]) => s.size).map(([n, s]) => `desktop.${n} × ${s.size}`),
      ...[...observing].map((o) => `observer ${o.constructor.name}`),
    ],
    desktop: (known = {}) =>
      new Proxy(known, {
        get: (t, p: string) => (/^on[A-Z]/.test(p) ? subscribe(p) : t[p] !== undefined ? t[p] : p === "platform" ? "linux" : () => Promise.resolve({})),
      }),
    emit: (name, ...args) => subs.get(name)?.forEach((l) => l(...args)),
    restore: () => {
      proto.addEventListener = add;
      proto.removeEventListener = remove;
      window.addEventListener = winAdd;
      window.removeEventListener = winRemove;
    },
  };
}
