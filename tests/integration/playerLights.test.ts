// @vitest-environment jsdom
// The player indicator lights: the pattern the PC set (identity byte 25,
// bits 0..4) lights what the controller lights, on the live drawing (both the
// DualSense and the DualSense Edge art) and on the Player tile. Individually
// wired boards (generation 0x03) light bit n's own light; paired ones (later
// boards, and the default) light both outer lights for bit 0 or 4 and both
// inner ones for bit 1 or 3. The tile names the player for the five standard
// patterns (1 = center light ... 5 = all), the same on both wirings, and
// shows no number for anything else. A new pattern repaints the lights (none
// left on from the last one).
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import type { PlayerLightWiring } from "../../src/protocol/controllerInfo";
import LiveController from "../../src/desktop/live/LiveController";
import LiveStrip from "../../src/desktop/live/LiveStrip";
import type { PartId } from "../../src/desktop/live/parts";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: the drawing places its mic / headset marks with these.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
(globalThis as { SVGGeometryElement?: unknown }).SVGGeometryElement ??= class {};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

// The identity as the client decodes it from the dongle's bytes.
async function identityWith(playerLeds: number, model: "dualsense" | "edge"): Promise<BridgeIdentity> {
  const dongle = new FakeDongle();
  dongle.playerLeds = playerLeds;
  const id = await new Ds5BridgeClient(dongle).identity();
  return { ...id, controllerConnected: true, model };
}

function mount(playerWiring: PlayerLightWiring) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const el = container;
  const render = (id: BridgeIdentity) =>
    act(() =>
      root!.render(
        createElement(
          Fragment,
          null,
          createElement(LiveController, {
            model: id.model === "edge" ? "edge" : "dualsense",
            input: null,
            lightbar: null,
            playerLeds: id.playerLeds,
            playerWiring,
            colors: null,
            selected: null,
            remapped: new Set<PartId>(),
            onSelect: vi.fn(),
          }),
          createElement(LiveStrip, { id, playerWiring, rssi: null, lightbarMode: null, lightbar: null, onLightbar: vi.fn() }),
        ),
      ),
    );
  const leds = () => [...el.querySelectorAll(".live-ctl svg [data-led]")];
  const lit = () =>
    leds()
      .filter((led) => led.classList.contains("on"))
      .map((led) => Number(led.getAttribute("data-led")))
      .sort();
  const tileLit = () => [...el.querySelectorAll(".live-pleds > span")].flatMap((s, i) => (s.classList.contains("on") ? [i] : []));
  const tile = () => el.querySelector(".live-pleds")!.closest(".live-tile")!.querySelector(".live-tile-value")!.textContent;
  return { render, leds, lit, tileLit, tile };
}

// pattern -> lights on (by data-led, left to right) and the tile's text.
type Case = [number, number[], string];
const STANDARD: Case[] = [
  [0x00, [], "—"],
  [0x04, [2], "Player 1"],
  [0x0a, [1, 3], "Player 2"],
  [0x15, [0, 2, 4], "Player 3"],
  [0x1b, [0, 1, 3, 4], "Player 4"],
  [0x1f, [0, 1, 2, 3, 4], "Player 5"],
];
// Not one of the standard patterns: the lights the controller lights, no player number.
const CASES: Record<PlayerLightWiring, Case[]> = {
  individual: [...STANDARD, [0x01, [0], "—"], [0x02, [1], "—"], [0x10, [4], "—"], [0x11, [0, 4], "—"]],
  paired: [...STANDARD, [0x01, [0, 4], "—"], [0x02, [1, 3], "—"], [0x10, [0, 4], "—"], [0x11, [0, 4], "—"]],
};

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

describe.each([
  ["dualsense", "paired"],
  ["dualsense", "individual"],
  ["edge", "paired"],
  ["edge", "individual"],
] as const)("player lights on the %s drawing, %s wiring", (model, wiring) => {
  it("has five lights, data-led 0..4 left to right", async () => {
    const view = mount(wiring);
    view.render(await identityWith(0, model));
    const leds = view.leds();
    expect(leds.map((l) => l.getAttribute("data-led"))).toEqual(["0", "1", "2", "3", "4"]);
    const xs = leds.map((l) => Number(l.getAttribute("x")));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it.each(CASES[wiring])(`pattern %s lights %j and the tile shows %s`, async (pattern, on, text) => {
    const view = mount(wiring);
    view.render(await identityWith(pattern, model));
    expect(view.lit(), hex(pattern)).toEqual(on);
    expect(view.tileLit(), hex(pattern)).toEqual(on);
    expect(view.tile()).toBe(text);
  });

  it("repaints on a new pattern, with nothing left from the last one", async () => {
    const view = mount(wiring);
    // every pattern after every other one, on the same mounted drawing
    for (const [from] of CASES[wiring])
      for (const [pattern, on, text] of CASES[wiring]) {
        view.render(await identityWith(from, model));
        view.render(await identityWith(pattern, model));
        expect(view.lit(), `${hex(from)} -> ${hex(pattern)}`).toEqual(on);
        expect(view.tileLit()).toEqual(on);
        expect(view.tile()).toBe(text);
      }
  });
});

it("keeps the lights when the model changes (the other drawing mounts lit)", async () => {
  const view = mount("paired");
  view.render(await identityWith(0x0a, "dualsense"));
  view.render(await identityWith(0x0a, "edge"));
  expect(view.lit()).toEqual([1, 3]);
  view.render(await identityWith(0x15, "dualsense"));
  expect(view.lit()).toEqual([0, 2, 4]);
});
