// @vitest-environment jsdom
// Developer card, "Pretend more controllers": the fakes fill the board's first
// empty slots in order, only as many as fit, and move when the real slots
// change; switching to one shows it as the connected controller in its slot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BridgeIdentity } from "../../src/protocol/bridgeClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Loaded after the dev-build flag is set: the fakes are a dev-build feature.
let dev: typeof import("../../src/desktop/devPreview");
let storage: typeof import("../../src/desktop/storage");
beforeAll(async () => {
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  vi.resetModules();
  dev = await import("../../src/desktop/devPreview");
  storage = await import("../../src/desktop/storage");
});
afterAll(() => vi.unstubAllEnvs());

const ids = (occupied: boolean[]) => dev.placeFakes(occupied).map((f) => f?.id ?? null);

describe("placeFakes", () => {
  it("fills the first empty slots in order", () => {
    expect(ids([true, false, false, true])).toEqual([null, "edge-01", "dualsense-04", null]);
    expect(ids([false, false, false, false])).toEqual(["edge-01", "dualsense-04", null, null]);
  });
  it("shows only as many as fit", () => {
    expect(ids([true, false, true, true])).toEqual([null, "edge-01", null, null]);
    expect(ids([true, true, true, true])).toEqual([null, null, null, null]);
  });
  it("places nothing before the slots are read", () => {
    expect(dev.placeFakes(null)).toEqual([]);
  });
});

describe("useFakeSlots / useShownIdentity", () => {
  const real = { currentSlot: 0, model: "dualsense", colorwayCode: "00" } as BridgeIdentity;
  let root: Root;
  let fake: ReturnType<typeof dev.useFakeSlots>;
  let shown: BridgeIdentity;
  function Probe() {
    fake = dev.useFakeSlots();
    shown = dev.useShownIdentity(real);
    return null;
  }
  beforeAll(() => {
    // An older build's slot-number pick is ignored (the real controller).
    storage.writePref("ds5.dev.fakeSlot", "2");
    storage.writePref("ds5.dev.fakeSlots", "1");
    const el = document.createElement("div");
    root = createRoot(el);
    act(() => root.render(createElement(Probe)));
  });
  afterAll(() => act(() => root.unmount()));

  it("ignores the old slot-number pref", () => {
    act(() => dev.noteSlotOccupancy([true, false, false, true]));
    expect(fake.shown).toBeNull();
    expect(shown).toBe(real);
  });
  it("switching to a fake shows it in its slot", () => {
    expect(fake.placed.map((f) => f?.id ?? null)).toEqual([null, "edge-01", "dualsense-04", null]);
    act(() => fake.switchTo(fake.placed[2]!));
    expect(fake.shown?.slot).toBe(2);
    expect(shown).toMatchObject({ currentSlot: 2, model: "dualsense", colorwayCode: "04" });
    expect(storage.readPref("ds5.dev.fakeSlot")).toBe("dualsense-04");
  });
  it("re-places when the real slots change", () => {
    act(() => dev.noteSlotOccupancy([false, true, true, false]));
    expect(fake.placed.map((f) => f?.id ?? null)).toEqual(["edge-01", null, null, "dualsense-04"]);
    expect(shown).toMatchObject({ currentSlot: 3, model: "dualsense", colorwayCode: "04" });
    // No room for it: back to the real controller (the pick is kept).
    act(() => dev.noteSlotOccupancy([true, true, false, true]));
    expect(fake.shown).toBeNull();
    expect(shown).toBe(real);
  });
  it("switching back shows the real controller", () => {
    act(() => dev.noteSlotOccupancy([true, false, false, true]));
    expect(fake.shown?.slot).toBe(2);
    act(() => fake.switchTo(null));
    expect(fake.shown).toBeNull();
    expect(shown).toBe(real);
  });
});
