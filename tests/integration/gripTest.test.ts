// @vitest-environment jsdom
// The Haptic feedback section's test group (Haptic feedback test, its last group). Firmware from protocol 1.15 holds
// the grip test (0xF6 0x0E [side, tenths]) steadily: the app sends one 3 s
// test and a stop ([side, 0]) when it ends early. Older firmware buzzes 0.5 s
// per command, so the app repeats it every 0.4 s (overlapping) up to 3 s. The
// running button counts down and stops the test when pressed again; the other
// test buttons wait; leaving the panel or losing the controller stops it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { DEFAULT_CONFIG, validateConfig } from "../../src/protocol/config";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { HapticsTest } from "../../src/desktop/pages/SettingsPage";
import { FakeDongle, type FakeDongleOptions } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.useRealTimers();
});

async function setup(opts: FakeDongleOptions = {}) {
  const dongle = new FakeDongle(opts);
  const client = new Ds5BridgeClient(dongle);
  const identity: BridgeIdentity = { ...(await client.identity()), controllerConnected: true };
  const bridge = (connected = true) =>
    ({
      draft: DEFAULT_CONFIG,
      config: DEFAULT_CONFIG,
      issues: validateConfig(DEFAULT_CONFIG),
      setDraftField: vi.fn(),
      client,
      identity: { ...identity, controllerConnected: connected },
    }) as unknown as UseDs5BridgeResult;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (connected = true) => act(() => root!.render(createElement(HapticsTest, { bridge: bridge(connected) })));
  render();
  const el = container;
  const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(label))!;
  return { dongle, render, button };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("haptic feedback test (3 s), firmware before 1.15", () => {
  it("repeats the 0.5 s grip test every 0.4 s up to 3 s, counting down, then stops by itself", async () => {
    const { dongle, button } = await setup();
    act(() => button("Test left").click());
    await wait(100);
    expect(dongle.gripTests).toBe(1);
    expect(dongle.lastGripTest).toBe(0);
    expect(button("Test left").getAttribute("aria-busy")).toBe("true");
    expect(button("Test left").textContent).toMatch(/3s$/);
    expect(button("Test right").disabled).toBe(true);
    expect(button("Test both").disabled).toBe(true);
    await wait(1000);
    expect(button("Test left").textContent).toMatch(/2s$/);
    expect(dongle.gripTests).toBe(3); // 0, 0.4, 0.8 s
    await wait(2000);
    expect(dongle.gripTests).toBe(7); // ... 2.4 s, the last one ends at 2.9 s
    expect(dongle.lastGripTenths).toBe(5);
    expect(button("Test left").getAttribute("aria-busy")).toBeNull();
    expect(button("Test right").disabled).toBe(false);
    await wait(2000);
    expect(dongle.gripTests).toBe(7);
    expect(dongle.gripStops).toBe(0);
  });

  it("stops early when pressed again", async () => {
    const { dongle, button } = await setup();
    act(() => button("Test both").click());
    await wait(500);
    expect(dongle.gripTests).toBe(2);
    expect(dongle.lastGripTest).toBe(2);
    act(() => button("Test both").click());
    await wait(3000);
    expect(dongle.gripTests).toBe(2);
    expect(button("Test both").getAttribute("aria-busy")).toBeNull();
  });

  it("sends nothing more after the panel closes or the controller disconnects", async () => {
    const closed = await setup();
    act(() => closed.button("Test right").click());
    await wait(100);
    act(() => root!.unmount());
    root = null;
    await wait(3000);
    expect(closed.dongle.gripTests).toBe(1);

    const gone = await setup();
    act(() => gone.button("Test right").click());
    await wait(500);
    expect(gone.dongle.gripTests).toBe(2);
    gone.render(false);
    await wait(3000);
    expect(gone.dongle.gripTests).toBe(2);
  });
});

describe("haptic feedback test (3 s), timed grip test (1.15)", () => {
  it("sends one steady 3 s test, counts down, and ends by itself", async () => {
    const { dongle, button } = await setup({ protoMinor: 15 });
    act(() => button("Test right").click());
    await wait(100);
    expect(dongle.gripTests).toBe(1);
    expect(dongle.lastGripTest).toBe(1);
    expect(dongle.lastGripTenths).toBe(30);
    expect(button("Test right").textContent).toMatch(/3s$/);
    expect(button("Test left").disabled).toBe(true);
    await wait(1000);
    expect(button("Test right").textContent).toMatch(/2s$/);
    await wait(2000);
    expect(button("Test right").getAttribute("aria-busy")).toBeNull();
    await wait(2000);
    expect(dongle.gripTests).toBe(1);
    expect(dongle.gripStops).toBe(0); // the dongle stops it at 3 s itself
  });

  it("sends a stop when pressed again", async () => {
    const { dongle, button } = await setup({ protoMinor: 15 });
    act(() => button("Test both").click());
    await wait(1000);
    act(() => button("Test both").click());
    await wait(100);
    expect(dongle.gripStops).toBe(1);
    expect(dongle.gripTests).toBe(1);
    expect(button("Test both").getAttribute("aria-busy")).toBeNull();
    await wait(3000);
    expect(dongle.gripTests).toBe(1);
  });

  it("sends a stop when the panel closes or the controller disconnects", async () => {
    const closed = await setup({ protoMinor: 15 });
    act(() => closed.button("Test left").click());
    await wait(100);
    act(() => root!.unmount());
    root = null;
    await wait(100);
    expect(closed.dongle.gripStops).toBe(1);
    await wait(3000);
    expect(closed.dongle.gripTests).toBe(1);

    const gone = await setup({ protoMinor: 15 });
    act(() => gone.button("Test right").click());
    await wait(500);
    gone.render(false);
    await wait(100);
    expect(gone.dongle.gripStops).toBe(1);
    expect(gone.dongle.gripTests).toBe(1);
  });
});
