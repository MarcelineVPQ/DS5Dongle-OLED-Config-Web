// @vitest-environment jsdom
// One save model (IA audit Q1, page rule 4): every board setting is kept by
// the one save bar. The buttons, stick curves and calibration have no Save,
// Apply or Revert of their own: a change there is staged (the bar says so and
// its Save lights up), the bar's Save writes it to the board, Revert puts
// every part back. The bar shows only on the pages it saves (the Controller
// and Pico 2 W pages). While a game's profile is on, the bar saves to the
// profile and nothing staged for the board is written.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.scrollTo ??= () => undefined;
(globalThis as Record<string, unknown>).SVGGeometryElement ??= class extends SVGElement {};
window.matchMedia ??= ((media: string) => Object.assign(new EventTarget(), { media, matches: false, onchange: null, addListener() {}, removeListener() {} })) as never;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let m: {
  i18n: typeof import("../../src/i18n").default;
  ControllerView: typeof import("../../src/desktop/live/ControllerView").default;
  drafts: typeof import("../../src/desktop/live/boardDrafts");
  SaveBar: typeof import("../../src/desktop/SaveBar");
  useDs5Bridge: typeof import("../../src/hooks/useDs5Bridge").useDs5Bridge;
  storage: typeof import("../../src/desktop/storage");
  devPreview: typeof import("../../src/desktop/devPreview");
  acc: typeof import("../../src/desktop/accordion/useAccordion");
};

beforeAll(async () => {
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  vi.resetModules();
  m = {
    i18n: (await import("../../src/i18n")).default,
    ControllerView: (await import("../../src/desktop/live/ControllerView")).default,
    drafts: await import("../../src/desktop/live/boardDrafts"),
    SaveBar: await import("../../src/desktop/SaveBar"),
    useDs5Bridge: (await import("../../src/hooks/useDs5Bridge")).useDs5Bridge,
    storage: await import("../../src/desktop/storage"),
    devPreview: await import("../../src/desktop/devPreview"),
    acc: await import("../../src/desktop/accordion/useAccordion"),
  };
  await m.i18n.changeLanguage("en");
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "desktop",
    new Proxy({ platform: "linux", appVersion: "0.9.5", getSettings: () => Promise.resolve({}) } as Record<string, unknown>, {
      get: (o, p: string) => (p in o ? o[p] : p.startsWith("on") ? () => () => undefined : () => Promise.resolve(undefined)),
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const FW = {
  available: false,
  latest: null,
  problem: null,
  state: { phase: "idle" },
  start: () => Promise.resolve(),
  refreshLatest: () => Promise.resolve({ latest: null }),
  dismiss: () => undefined,
} as never;
const NO_PROFILE = { active: null, editing: null, profileDirty: false, revertToProfile: async () => undefined, saveToProfile: async () => true };
let drafts: import("../../src/desktop/live/boardDrafts").BoardDrafts | null = null;
function Probe() {
  drafts = m.drafts.useBoardDrafts();
  return null;
}
// The Controller page as DesktopApp shows it: the board's drafts, the page and the bar.
let bridgeNow: ReturnType<typeof m.useDs5Bridge> | null = null;
function Page({ profiles = NO_PROFILE }: { profiles?: typeof NO_PROFILE }) {
  const bridge = m.useDs5Bridge();
  bridgeNow = bridge;
  if (!bridge.isConnected) return null;
  return createElement(
    m.drafts.BoardDraftsProvider,
    { bridge },
    createElement(m.ControllerView, { bridge, fw: FW, view: "overview", onView: () => undefined }),
    createElement(Probe),
    createElement(Bar, { bridge, profiles }),
  );
}
function Bar({ bridge, profiles }: { bridge: ReturnType<typeof m.useDs5Bridge>; profiles: typeof NO_PROFILE }): ReactNode {
  return createElement(m.SaveBar.default, { bridge, profiles: profiles as never, drafts: m.drafts.useBoardDrafts() });
}
const wait = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));
async function live(profiles?: typeof NO_PROFILE) {
  m.storage.writePref(m.devPreview.SIMULATED_KEY, "1");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await act(async () => root.render(createElement(Page, { profiles })));
  // loop: test — until the simulated board answers and the drafts are read
  for (let i = 0; i < 200 && !(container.querySelector(".dk-sec") && drafts?.calibration.saved && drafts.curves.saved && drafts.remap.supported); i++) await wait(10);
  await wait(50);
}
const dongle = () => m.devPreview.simulatedBoard()!.dongle()!;
const note = () => container.querySelector(".dk-bar-note")!.textContent;
const barButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>(".dk-bar button")].find((b) => b.textContent === label)!;
const t = (key: string) => m.i18n.t(key);
const open = async (id: string) => {
  m.acc.revealSection("controller", id as never);
  await wait();
  return container.querySelector<HTMLElement>(`[data-section="${id}"] .dk-sec-body`)!;
};
const change = (el: HTMLSelectElement | HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // A slider commits when it's let go (Slider in controls.tsx).
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });

describe("the save bar", () => {
  it("shows on the controller view (the Controller and Pico 2 W pages) only", () => {
    expect(m.SaveBar.showsSaveBar("controller")).toBe(true);
    expect(m.SaveBar.showsSaveBar("app")).toBe(false);
    expect(m.SaveBar.showsSaveBar("games")).toBe(false);
    expect(m.SaveBar.showsSaveBar("about")).toBe(false);
  });

  it("is the only Save: Buttons, Sticks & calibration, Adaptive triggers and Gyroscope have no Save, Apply or Revert of their own", async () => {
    await live();
    for (const id of ["buttons", "sticks", "triggers", "gyro"]) {
      const body = await open(id);
      // loop: test — a section's buttons
      const labels = [...body.querySelectorAll("button")].map((b) => b.textContent);
      for (const own of ["Save to the Pico 2 W", "Apply assignments", "Revert", "Save to profile"]) expect(labels, `${id}: ${own}`).not.toContain(own);
    }
  });

  it("a button pick, a curve and a calibration change are staged: the bar says so, Save writes each to the board", async () => {
    await live();
    expect(note()).toBe(m.i18n.t("desktop.bar.saved"));
    expect(barButton(m.i18n.t("desktop.bar.save")).disabled).toBe(true);
    // Buttons: Cross → Circle.
    const buttons = await open("buttons");
    change(buttons.querySelector<HTMLSelectElement>("#all-remap-13")!, "14");
    expect(drafts!.remap.dirty).toBe(true);
    expect(note()).toBe(t("desktop.bar.staged"));
    expect(barButton(m.i18n.t("desktop.bar.save")).disabled).toBe(false);
    // Sticks: a curve, and the left stick's deadzone.
    const sticks = await open("sticks");
    act(() => [...sticks.querySelectorAll<HTMLButtonElement>(".dk-seg button")].find((b) => b.textContent === t("desktop.curves.type.precise"))!.click());
    expect(drafts!.curves.dirty).toBe(true);
    change(sticks.querySelector<HTMLInputElement>('input[type="range"]')!, "20");
    expect(drafts!.calibration.dirty).toBe(true);
    // Nothing reached the board yet.
    expect(dongle().remap[13]).toBe(13);
    await act(async () => barButton(m.i18n.t("desktop.bar.save")).click());
    await wait(100);
    expect(dongle().remap[13]).toBe(14);
    expect(dongle().calibration[dongle().currentSlot][2]).toBe(20); // the left stick's deadzone byte
    expect(drafts!.staged).toBe(false);
    expect(note()).toBe(m.i18n.t("desktop.bar.saved"));
  });

  it("Revert puts every staged part back (buttons, curves, calibration) and writes nothing", async () => {
    await live();
    const buttons = await open("buttons");
    change(buttons.querySelector<HTMLSelectElement>("#all-remap-13")!, "15");
    const sticks = await open("sticks");
    act(() => [...sticks.querySelectorAll<HTMLButtonElement>(".dk-seg button")].find((b) => b.textContent === t("desktop.curves.type.digital"))!.click());
    change(sticks.querySelector<HTMLInputElement>('input[type="range"]')!, "25");
    expect(drafts!.staged).toBe(true);
    await act(async () => barButton(m.i18n.t("desktop.bar.revert")).click());
    await wait();
    expect(drafts!.remap.dirty || drafts!.curves.dirty || drafts!.calibration.dirty).toBe(false);
    expect(drafts!.remap.draft[13]).toBe(dongle().remap[13]); // what the board has (the previous test saved Circle there)
    expect(dongle().remap[13]).not.toBe(15);
    expect(note()).toBe(m.i18n.t("desktop.bar.saved"));
  });

  it("a save the board drops off during is not 'All changes saved': the bar stays unsaved and says the board went away", async () => {
    await live();
    await act(async () => void (await bridgeNow!.applyBody({ ...bridgeNow!.config!, inactiveTime: 45 })));
    await wait(1200); // the identity poll reads the unsaved flag
    expect(note()).toBe(t("desktop.bar.unsaved"));
    const board = dongle();
    const original = board.setReport.bind(board);
    board.setReport = async (id, payload) => {
      await original(id, payload);
      if (payload[0] === 0x02) board.gone = true; // the save's SET landed, then the board left the bus
    };
    try {
      await act(async () => barButton(t("desktop.bar.save")).click());
      await wait();
      expect(note()).toBe(t("desktop.bar.unsaved"));
      expect(bridgeNow!.error).toBe(t("desktop.errors.usb.gone"));
    } finally {
      board.setReport = original;
      board.gone = false;
    }
  });

  it("a game's profile on: the bar saves to the profile, nothing staged for the board is written", async () => {
    const saveToProfile = vi.fn(async () => true);
    await live({ active: { gameKey: "g", title: "Ghostrunner" }, editing: null, profileDirty: true, revertToProfile: async () => undefined, saveToProfile } as never);
    const sticks = await open("sticks");
    change(sticks.querySelector<HTMLInputElement>('input[type="range"]')!, "30");
    expect(drafts!.calibration.dirty).toBe(true);
    const save = barButton(m.i18n.t("desktop.bar.saveProfileTo", { title: "Ghostrunner" }));
    expect(save).toBeTruthy();
    await act(async () => save.click());
    expect(saveToProfile).toHaveBeenCalled();
    expect(dongle().calibration[dongle().currentSlot][2]).not.toBe(30);
  });
});
