// @vitest-environment jsdom
// Loop pass batch 4 (docs/LOOP_PASS_2026-10.md): lists that re-rendered on
// work they don't depend on.
// - The Games grid's tiles (memo, one stable onOpen): a library render redraws
//   only tiles whose game changed, not hundreds per render.
// - The Pico page's log: its rows render when a line is added, not on every
//   OLED mirror frame (10 a second), and each line's time is formatted once.
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import type { GameEntry } from "../../src/desktop/games/types";
import { Ds5BridgeClient, type BridgeIdentity, type OledFrame } from "../../src/protocol/bridgeClient";
import { FakeDongle } from "../support/fakeDongle";

const counts = vi.hoisted(() => ({ supportOf: 0 }));
vi.mock("../../src/desktop/library/support", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/desktop/library/support")>();
  return { ...real, supportOf: (...a: Parameters<typeof real.supportOf>) => (counts.supportOf++, real.supportOf(...a)) };
});
const { GameTile } = await import("../../src/desktop/library/GameTile");
const { default: DongleConsole } = await import("../../src/desktop/dongle/DongleConsole");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  counts.supportOf = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const render = (el: ReactElement) => act(() => root.render(el));

const game = (i: number): GameEntry => ({
  key: `steam-1:steam:${i}`,
  launcher: "steam",
  store: "steam",
  id: String(i),
  title: `Game ${i}`,
  runner: null,
  runnerMissing: false,
  usesOurProton: false,
  envFlags: [],
  support: "unknown",
  fixes: [],
});

describe("the Games grid (loop pass batch 4)", () => {
  it("re-renders only the tiles whose game changed", () => {
    const games = Array.from({ length: 40 }, (_, i) => game(i));
    const onOpen = vi.fn();
    const grid = (list: GameEntry[], tick: number) =>
      createElement(
        Fragment,
        null,
        createElement("span", null, tick),
        // loop: test — 40 tiles
        list.map((g) => createElement(GameTile, { key: g.key, game: g, info: undefined, running: false, hasProfile: false, onOpen, glass: false })),
      );
    render(grid(games, 0));
    expect(counts.supportOf).toBe(40);
    counts.supportOf = 0;
    // loop: test — 5 library renders with nothing changed
    for (let tick = 1; tick <= 5; tick++) render(grid(games, tick));
    expect(counts.supportOf).toBe(0);
    // One game changed: one tile.
    const changed = [...games];
    changed[3] = { ...games[3], title: "Renamed" };
    render(grid(changed, 6));
    expect(counts.supportOf).toBe(1);
    // A tile opens its own game with the shared handler.
    act(() => container.querySelectorAll<HTMLButtonElement>(".lib-tile")[7].click());
    expect(onOpen).toHaveBeenCalledWith(games[7].key);
  });
});

describe("the Pico page's log (loop pass batch 4)", () => {
  it("formats each line's time once and leaves the rows alone on mirror frames", async () => {
    const client = new Ds5BridgeClient(new FakeDongle());
    const identity: BridgeIdentity = await client.identity();
    const toTime = vi.spyOn(Date.prototype, "toLocaleTimeString");
    const page = (frame: OledFrame | null, on: boolean) =>
      createElement(DongleConsole, {
        client,
        identity,
        controllerOn: on,
        frame: { frame, changes: 0, error: false },
        keys: { supported: false, press: null },
        pad: { supported: false, press: null },
      });
    render(page(null, true));
    act(() => [...container.querySelectorAll<HTMLButtonElement>(".dcon-tab")][1].click());
    const rows = () => container.querySelectorAll(".dcon-log .dcon-row").length;
    expect(rows()).toBe(2); // board online, controller connected
    const formatted = toTime.mock.calls.length;
    expect(formatted).toBe(2);
    // loop: test — 20 mirror frames
    for (let n = 0; n < 20; n++) render(page({ power: "on", screen: 0, contrast: 0xff, pixels: new Uint8Array(1024) } as unknown as OledFrame, true));
    expect(toTime.mock.calls.length).toBe(formatted);
    render(page(null, false)); // the controller goes: one new line, one time formatted
    expect(rows()).toBe(3);
    expect(toTime.mock.calls.length).toBe(formatted + 1);
  });
});
