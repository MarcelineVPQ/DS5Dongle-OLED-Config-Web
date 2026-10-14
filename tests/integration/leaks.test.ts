// @vitest-environment jsdom
// The leak test (CLAUDE.md "Lifetime pass"): every main page and panel is
// mounted and unmounted N times with fakes (the simulated dongle, a faked
// window.desktop, a fake microphone and audio) and the live resources must
// come back to where they started: DOM listeners, timers / intervals /
// animation frames, microphone tracks, AudioContexts, observers and
// window.desktop subscriptions. A leak of one per mount shows as N.
import { act, createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installLeakProbe, type LeakCounts, type LeakProbe } from "../support/leakProbe";
import { fakeBridge, ghostrunner, GHOSTRUNNER_INFO, GHOSTRUNNER_RECORD, gamesReport } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
// jsdom lacks these: SVG shape geometry and media queries.
(globalThis as Record<string, unknown>).SVGGeometryElement ??= class extends SVGElement {};
// No canvas package: drawing surfaces are absent, as with a GPU that fails.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const N = 50;
// Long enough for every one-shot timer the pages arm (debounces, toasts,
// retries) to fire once the page is gone.
const AFTER_UNMOUNT_MS = 15_000;

let probe: LeakProbe;
let root: Root;
let container: HTMLDivElement;
// Loaded after the dev-build flag is set: the simulated dongle is a dev-build feature.
let mods: {
  ControllerView: typeof import("../../src/desktop/live/ControllerView").default;
  useDs5Bridge: typeof import("../../src/hooks/useDs5Bridge").useDs5Bridge;
  useAppUpdate: typeof import("../../src/desktop/useUpdates").useAppUpdate;
  useFirmwareUpdate: typeof import("../../src/desktop/useUpdates").useFirmwareUpdate;
  GamesPage: typeof import("../../src/desktop/pages/GamesPage").default;
  GamePage: typeof import("../../src/desktop/library/GamePage").default;
  AppSettingsPage: typeof import("../../src/desktop/pages/AppSettingsPage").default;
  AboutPage: typeof import("../../src/desktop/pages/AboutPage").default;
};

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  vi.resetModules();
  probe = installLeakProbe();
  // Media queries that never match, each an EventTarget the probe counts.
  vi.stubGlobal("matchMedia", (media: string) => Object.assign(new EventTarget(), { media, matches: false, onchange: null, addListener() {}, removeListener() {} }));
  vi.stubGlobal("desktop", probe.desktop());
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  const { writePref } = await import("../../src/desktop/storage");
  const { SIMULATED_KEY } = await import("../../src/desktop/devPreview");
  writePref(SIMULATED_KEY, "1");
  // jsdom reports "prerender"; the app's window-shown store wants "visible".
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  const updates = await import("../../src/desktop/useUpdates");
  mods = {
    ControllerView: (await import("../../src/desktop/live/ControllerView")).default,
    useDs5Bridge: (await import("../../src/hooks/useDs5Bridge")).useDs5Bridge,
    useAppUpdate: updates.useAppUpdate,
    useFirmwareUpdate: updates.useFirmwareUpdate,
    GamesPage: (await import("../../src/desktop/pages/GamesPage")).default,
    GamePage: (await import("../../src/desktop/library/GamePage")).default,
    AppSettingsPage: (await import("../../src/desktop/pages/AppSettingsPage")).default,
    AboutPage: (await import("../../src/desktop/pages/AboutPage")).default,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterAll(() => {
  act(() => root.unmount());
  container.remove();
  probe.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const press = (label: string) => {
  const b = [...container.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no "${label}" button`);
  act(() => b.click());
};

type View = import("../../src/desktop/live/PartPanel").PanelView;
// The controller view as DesktopApp shows it: the app's connection to the
// (simulated) dongle, its update state, and the view around the live controller.
function Controller({ view }: { view: View }) {
  const bridge = mods.useDs5Bridge();
  const app = mods.useAppUpdate();
  const fw = mods.useFirmwareUpdate(bridge, app);
  return bridge.isConnected ? createElement(mods.ControllerView, { bridge, fw, view, onView: () => undefined }) : null;
}

// App settings as DesktopApp shows it (the board and update state for its Updates section).
function AppSettings() {
  const bridge = mods.useDs5Bridge();
  const app = mods.useAppUpdate();
  const fw = mods.useFirmwareUpdate(bridge, app);
  return createElement(mods.AppSettingsPage, { bridge, fw });
}
// Opens and folds every accordion section on the page, one after another
// (closed sections mount nothing; open ones must give back what they took).
const everySection = async () => {
  const heads = () => [...container.querySelectorAll<HTMLButtonElement>(".dk-sec-toggle")];
  expect(heads().length).toBeGreaterThan(3);
  for (let i = 0; i < heads().length; i++) {
    act(() => heads()[i].click());
    await advance(300);
    expect(heads()[i].getAttribute("aria-expanded")).toBe("true");
    act(() => heads()[i].click());
  }
};

interface Page {
  name: string;
  element: () => ReactElement;
  desktop?: () => Record<string, unknown>;
  // Something to do while it's open (start the mic test), before it unmounts.
  use?: () => Promise<void>;
  ready?: () => boolean;
}
const PAGES: Page[] = [
  { name: "controller view", element: () => createElement(Controller, { view: "overview" }), ready: () => !!container.querySelector("[data-part]") },
  { name: "Pico page (dongle)", element: () => createElement(Controller, { view: "dongle" }) },
  { name: "App settings, every section opened", element: () => createElement(AppSettings), use: everySection },
  { name: "About, every section opened", element: () => createElement(mods.AboutPage), use: everySection },
  { name: "Calibration", element: () => createElement(Controller, { view: "calibration" }) },
  { name: "Speaker panel", element: () => createElement(Controller, { view: { part: "speaker" } }) },
  {
    name: "Mic panel with the mic test running",
    element: () => createElement(Controller, { view: { part: "mute" } }),
    use: async () => {
      const { tracks, audioContexts } = probe.snapshot();
      press("Mic Test");
      await advance(500);
      // The mic is open (and its AudioContext) when the panel goes away.
      expect(probe.snapshot()).toMatchObject({ tracks: tracks + 1, audioContexts: audioContexts + 1 });
    },
  },
  {
    name: "Games Home",
    desktop: () => homeDesktop("healthy"),
    element: () =>
      createElement(mods.GamesPage, {
        allowed: true,
        onAllowedChange: () => undefined,
        bridge: fakeBridge(),
        profiles: { library: homeLibrary(homeReport("healthy").games), setLibrary: () => undefined, running: null } as never,
      }),
  },
  {
    name: "game page",
    element: () =>
      createElement(mods.GamePage, {
        game: ghostrunner(),
        info: GHOSTRUNNER_INFO,
        record: GHOSTRUNNER_RECORD,
        running: false,
        report: gamesReport(ghostrunner()),
        bridge: fakeBridge(),
        onLibrary: () => undefined,
        onRescan: () => undefined,
      }),
  },
];

async function cycle(page: Page) {
  act(() => root.render(page.element()));
  await advance(1500);
  await page.use?.();
  act(() => root.render(null));
  await advance(AFTER_UNMOUNT_MS);
}

const tally = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
const diff = (a: LeakCounts, b: LeakCounts) =>
  Object.fromEntries(Object.keys(a).flatMap((k) => (a[k as keyof LeakCounts] === b[k as keyof LeakCounts] ? [] : [[k, `${a[k as keyof LeakCounts]} -> ${b[k as keyof LeakCounts]}`]])));

describe("the leak probe", () => {
  it("sees a page that forgets its cleanups", async () => {
    vi.stubGlobal("desktop", probe.desktop());
    const before = probe.snapshot();
    function Leaky() {
      useEffect(() => {
        window.addEventListener("resize", () => undefined);
        setInterval(() => undefined, 1000);
        void navigator.mediaDevices.getUserMedia({ audio: true });
        new AudioContext();
        new ResizeObserver(() => undefined).observe(document.body);
        window.desktop!.onWindowVisible(() => undefined);
      }, []);
      return null;
    }
    act(() => root.render(createElement(Leaky)));
    await advance(100);
    act(() => root.render(null));
    await advance(AFTER_UNMOUNT_MS);
    const after = probe.snapshot();
    expect(diff(before, after)).toEqual({
      listeners: `${before.listeners} -> ${before.listeners + 1}`,
      timers: `${before.timers} -> ${before.timers + 1}`,
      tracks: `${before.tracks} -> ${before.tracks + 1}`,
      audioContexts: `${before.audioContexts} -> ${before.audioContexts + 1}`,
      observers: `${before.observers} -> ${before.observers + 1}`,
      subscriptions: `${before.subscriptions} -> ${before.subscriptions + 1}`,
    });
    vi.clearAllTimers();
  });
});

describe(`leak test: ${N} mounts and unmounts per page`, () => {
  it.each(PAGES)(
    "$name gives back everything it takes",
    async (page) => {
      vi.stubGlobal("desktop", probe.desktop(page.desktop?.()));
      // One warm-up cycle: module-level stores wire once per app (the
      // window-shown store, i18n, the theme watcher) and stay by design.
      await cycle(page);
      const before = probe.snapshot();
      const held = tally(probe.describe());
      act(() => root.render(page.element()));
      await advance(1500);
      if (page.ready) expect(page.ready(), `${page.name} rendered`).toBe(true);
      // While open it does hold something (the probe sees it).
      const open = probe.snapshot();
      await page.use?.();
      act(() => root.render(null));
      await advance(AFTER_UNMOUNT_MS);
      // Sanity: while open the page holds something the probe sees.
      expect(Object.values(diff(before, open)).length, `${page.name} acquires nothing the probe sees`).toBeGreaterThan(0);
      for (let i = 1; i < N; i++) await cycle(page);
      const after = probe.snapshot();
      const now = tally(probe.describe());
      const extra = [...now].filter(([d, n]) => n > (held.get(d) ?? 0)).map(([d, n]) => `${d}: ${held.get(d) ?? 0} -> ${n}`);
      expect({ diff: diff(before, after), extra }).toEqual({ diff: {}, extra: [] });
    },
    120_000,
  );
});
