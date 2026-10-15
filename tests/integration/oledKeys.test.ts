// @vitest-environment jsdom
// Remote KEY0 / KEY1 presses (protocol 1.18, identity [46] bit 6, 0xF6 0x18):
// the client sends [key, long], the simulated dongle navigates its OLED like
// the firmware's handle_buttons() (KEY0 next, KEY1 short back, KEY1 long
// brightness), the mirror shows it, and older firmware is never asked.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CommandError, Ds5BridgeClient, FEATURES3, FUNC, supportsFeature3 } from "../../src/protocol/bridgeClient";
import { SCREEN_NAMES } from "../../src/oled/screenNames";
import { useDs5Bridge, type UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(protoMinor = 18) {
  const dongle = new FakeDongle({ protoMinor });
  return { dongle, client: new Ds5BridgeClient(dongle) };
}

describe("remote OLED keys (protocol 1.18)", () => {
  it("announces the feature bit and sends 0xF6 0x18 [key, long]", async () => {
    const { dongle, client } = setup();
    const id = await client.identity();
    expect(id.features3 & FEATURES3.oledKeys).toBe(FEATURES3.oledKeys);
    expect(supportsFeature3(id, 18, FEATURES3.oledKeys)).toBe(true);
    expect(client.oledKeys).toBe(true);
    await client.pressOledKey(1, true);
    expect([...dongle.sets.at(-1)!]).toEqual([FUNC.oledKey, 1, 1]);
    expect(dongle.oledKeyPresses).toEqual([[1, true]]);
  });

  it("navigates the mirrored screen like the firmware", async () => {
    const { client } = setup();
    await client.identity();
    const screen = async () => (await client.readOledFrame())!.screen;
    expect(await screen()).toBe(2);
    await client.pressOledKey(0, false);
    expect(await screen()).toBe(3);
    await client.pressOledKey(0, true); // KEY0 long = next as well
    expect(await screen()).toBe(4);
    await client.pressOledKey(1, false);
    expect(await screen()).toBe(3);
    // KEY1 long: next brightness level, same screen.
    const before = (await client.readOledFrame())!.contrast;
    await client.pressOledKey(1, true);
    const after = await client.readOledFrame();
    expect(after!.screen).toBe(3);
    expect(before).toBe(0xff);
    expect(after!.contrast).toBe(0x7f);
    // Wraps around both ways, over the firmware's screen count.
    // loop: NOT-WORTH — test only
    for (let i = 0; i < SCREEN_NAMES.length; i++) await client.pressOledKey(0, false);
    expect(await screen()).toBe(3);
  });

  it("is refused by firmware without the bit, without sending anything", async () => {
    const { dongle, client } = setup(17);
    const id = await client.identity();
    expect(supportsFeature3(id, 18, FEATURES3.oledKeys)).toBe(false);
    expect(client.oledKeys).toBe(false);
    await expect(client.pressOledKey(0, false)).rejects.toThrow(/Update the firmware/);
    expect(dongle.sets.length).toBe(0);
  });

  it("answers INVALID for a bad key or press, like the firmware", async () => {
    const { dongle, client } = setup();
    await client.identity();
    await expect(client.command(FUNC.oledKey, [2, 0])).rejects.toBeInstanceOf(CommandError);
    await expect(client.command(FUNC.oledKey, [0, 2])).rejects.toBeInstanceOf(CommandError);
    await expect(client.command(FUNC.oledKey, [0])).rejects.toBeInstanceOf(CommandError);
    expect(dongle.oledKeyPresses).toEqual([]);
  });

  it("is exposed by useDs5Bridge as supportsOledKeys / pressOledKey", async () => {
    let bridge: UseDs5BridgeResult | null = null;
    function Probe() {
      bridge = useDs5Bridge();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(bridge!.supportsOledKeys).toBe(false);
    expect(await bridge!.pressOledKey(0, false)).toBe(false); // no board: nothing to press
    act(() => root.unmount());
  });
});
