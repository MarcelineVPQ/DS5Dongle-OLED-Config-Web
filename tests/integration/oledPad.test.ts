// @vitest-environment jsdom
// Controller buttons for the OLED screens (protocol 1.19, identity [46] bit 7,
// 0xF6 0x19 [button, hold ms lo, hi]): the client sends them, the simulated
// board's screens react like the firmware's (Settings navigate / adjust /
// save, △ held 2 s for Reset / Wipe; Slots, Lightbar, Trigger Test,
// Diagnostics), and older firmware is never asked.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CommandError, Ds5BridgeClient, FEATURES3, FUNC, supportsFeature3 } from "../../src/protocol/bridgeClient";
import { decodeConfigBody } from "../../src/protocol/config";
import { SimulatedDongle } from "../../src/protocol/simulatedDongle";
import { SCREEN } from "../../src/oled/screenNames";
import { SETTINGS_GROUPS, SETTINGS_ITEMS, type SimBoard } from "../../src/oled/simScreens";
import { padAction } from "../../src/desktop/dongle/OledPad";
import { useDs5Bridge, type UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setup(protoMinor = 19) {
  const dongle = new SimulatedDongle({ protoMinor });
  const client = new Ds5BridgeClient(dongle);
  await client.identity();
  return { dongle, client };
}
// Navigates with KEY1 (back) until the board shows `screen`.
async function goTo(client: Ds5BridgeClient, dongle: SimulatedDongle, screen: number) {
  // loop: test — at most 11 screens
  for (let i = 0; i < 11 && dongle.oledScreen !== screen; i++) await client.pressOledKey(0, false);
  expect(dongle.oledScreen).toBe(screen);
}
const savedBody = (d: SimulatedDongle) => {
  const whole = new Uint8Array(51);
  whole.set(d.flashConfig, 0);
  whole.set(d.rightGain, 38);
  whole.set(d.flashTail, 42);
  return decodeConfigBody(whole);
};

describe("controller buttons for the OLED (protocol 1.19)", () => {
  it("announces the feature bit and sends 0xF6 0x19 [button, hold lo, hi]", async () => {
    const { dongle, client } = await setup();
    const id = await client.identity();
    expect(id.features3 & FEATURES3.oledPad).toBe(FEATURES3.oledPad);
    expect(supportsFeature3(id, 19, FEATURES3.oledPad)).toBe(true);
    expect(client.oledPad).toBe(true);
    await client.pressOledPad("triangle", 2000);
    expect([...dongle.sets.at(-1)!]).toEqual([FUNC.oledPad, 4, 0xd0, 0x07]);
    await client.pressOledPad("r1");
    expect([...dongle.sets.at(-1)!]).toEqual([FUNC.oledPad, 8, 0, 0]);
    await client.pressOledPad("up", 99_999); // clamped to the firmware's 5 s
    expect([...dongle.sets.at(-1)!]).toEqual([FUNC.oledPad, 0, 0x88, 0x13]);
    expect(dongle.oledScreens.presses.map(([b]) => b)).toEqual(["triangle", "r1", "up"]);
  });

  it("is refused by firmware without the bit, without sending anything", async () => {
    const { dongle, client } = await setup(18);
    expect(client.oledPad).toBe(false);
    await expect(client.pressOledPad("up")).rejects.toThrow(/desktop\.errors\.board\.noOledPad/);
    expect(dongle.sets.length).toBe(0);
  });

  it("answers INVALID for a bad button or hold, like the firmware", async () => {
    const { dongle, client } = await setup();
    await expect(client.command(FUNC.oledPad, [9, 0, 0])).rejects.toBeInstanceOf(CommandError);
    await expect(client.command(FUNC.oledPad, [4, 0x89, 0x13])).rejects.toBeInstanceOf(CommandError); // 5001 ms
    await expect(client.command(FUNC.oledPad, [])).rejects.toBeInstanceOf(CommandError);
    expect(dongle.oledScreens.presses).toEqual([]);
  });

  it("Settings: a category menu (✕ or → opens a group, ○ back); the directional buttons move and adjust, △ saves; Reset only after a 2 s hold", async () => {
    const { dongle, client } = await setup();
    await goTo(client, dongle, SCREEN.settings);
    const board = { body: () => savedBody(dongle), powerFlags: () => 0 } as unknown as SimBoard;
    const screen = () => dongle.oledScreens.lines(SCREEN.settings, board)!;
    // The menu: the six groups with their sizes, as firmware 0.9.5-dev.19 draws them.
    expect(screen().title).toBe("Settings");
    expect(screen().rows).toEqual(["> Haptics/trigger 6", "  Audio 9", "  Connection 4", "  Screen & lights 4", "  PC sleep 2"]);
    expect(screen().footer).toBe("X=open  Tri=save");
    expect(SETTINGS_GROUPS.reduce((n, g) => (g.first === n ? n + g.count : NaN), 0)).toBe(SETTINGS_ITEMS.length); // the groups tile the items, in order
    // Connection → Idle time.
    await client.pressOledPad("down");
    await client.pressOledPad("down");
    await client.pressOledPad("cross");
    expect(screen().title).toBe("Connection");
    expect(screen().footer).toBe("O=back  Tri=save");
    const idle = SETTINGS_ITEMS.findIndex((it) => it.label === "Idle time");
    // loop: test — down to "Idle time"
    while (dongle.oledScreens.sel !== idle) await client.pressOledPad("down");
    const before = savedBody(dongle).inactiveTime;
    await client.pressOledPad("right");
    await client.pressOledPad("right");
    await client.pressOledPad("left");
    expect(dongle.oledScreens.dirty).toBe(true);
    expect(screen().title).toBe("Connection (*)");
    expect(savedBody(dongle).inactiveTime).toBe(before); // not saved yet
    await client.pressOledPad("triangle");
    expect(savedBody(dongle).inactiveTime).toBe(before + 5);
    expect(dongle.oledScreens.status).toBe("Saved!");
    expect(dongle.oledScreens.dirty).toBe(false);
    await client.pressOledPad("up");
    expect(dongle.oledScreens.sel).toBe(idle - 1);
    // ○ back to the menu (its cursor kept), then → opens Reset.
    await client.pressOledPad("circle");
    expect(dongle.oledScreens.inGroup).toBe(false);
    expect(dongle.oledScreens.group).toBe(2);
    // loop: test — down to "Reset"
    while (SETTINGS_GROUPS[dongle.oledScreens.group].name !== "Reset") await client.pressOledPad("down");
    await client.pressOledPad("right");
    expect(SETTINGS_ITEMS[dongle.oledScreens.sel].label).toBe("Reset to defaults");
    dongle.oledScreens.status = ""; // the firmware's "Saved!" shows for a moment, then the row's hint
    expect(screen().footer).toBe("Hold Tri 2s = RESET");
    await client.pressOledPad("triangle", 500); // let go too soon: nothing
    expect(savedBody(dongle).inactiveTime).toBe(before + 5);
    await client.pressOledPad("triangle", 2000);
    expect(savedBody(dongle).inactiveTime).toBe(30);
    expect(dongle.oledScreens.status).toBe("Reset!");
    // Wipe all slots: △ held 2 s.
    await client.pressOledPad("down");
    await client.pressOledPad("triangle", 2100);
    expect(dongle.slots).toEqual([false, false, false, false]);
  });

  it("Settings: Vibration L and Vibration R adjust each grip on its own (firmware PR #22)", async () => {
    const { dongle, client } = await setup();
    await goTo(client, dongle, SCREEN.settings);
    expect(SETTINGS_ITEMS.slice(0, 2).map((it) => it.label)).toEqual(["Vibration L", "Vibration R"]);
    const before = savedBody(dongle);
    await client.pressOledPad("cross"); // Haptics/trigger
    await client.pressOledPad("down"); // Vibration R
    await client.pressOledPad("right");
    await client.pressOledPad("triangle");
    const after = savedBody(dongle);
    expect(after.hapticsGainRight).toBe(Math.min(6, before.hapticsGainRight + 0.5));
    expect(after.hapticsGain).toBe(before.hapticsGain);
    // The screen's rows come from the screens' own copy after the save (the board is not read again).
    const board = { body: () => after, powerFlags: () => 0 } as unknown as SimBoard;
    const rows = dongle.oledScreens.lines(SCREEN.settings, board)!.rows;
    expect(rows[0]).toBe(`  Vibration L ${before.hapticsGain.toFixed(1)}x`);
    expect(rows[1]).toBe(`> Vibration R ${after.hapticsGainRight.toFixed(1)}x`);
  });

  it("Slots, Lightbar, Trigger Test and Diagnostics react to their buttons", async () => {
    const { dongle, client } = await setup();
    await goTo(client, dongle, SCREEN.slots);
    await client.pressOledPad("down");
    await client.pressOledPad("triangle");
    expect(dongle.currentSlot).toBe(1);
    await client.pressOledPad("up");
    await client.pressOledPad("square", 300); // a tap doesn't forget
    expect(dongle.slots[0]).toBe(true);
    await client.pressOledPad("square", 1500);
    expect(dongle.slots[0]).toBe(false);
    await goTo(client, dongle, SCREEN.lightbar);
    await client.pressOledPad("r1");
    expect(dongle.oledScreens.lbMode).toBe(0); // HOST -> LIVE
    await client.pressOledPad("cross");
    expect(dongle.oledScreens.lbSaved).toEqual([2]);
    await goTo(client, dongle, SCREEN.triggers);
    await client.pressOledPad("triangle");
    expect(dongle.lastTrigger).toBe(1);
    await goTo(client, dongle, SCREEN.diag);
    await client.pressOledPad("down");
    await client.pressOledPad("down");
    await client.pressOledPad("up");
    expect(dongle.oledScreens.diagScroll).toBe(1);
  });

  it("names what each button does per screen, and nothing where a screen ignores it", () => {
    expect(padAction(SCREEN.settings, "triangle")).toEqual({ key: "settings.triangle", holdMs: 2000 });
    expect(padAction(SCREEN.settings, "circle")).toBeNull();
    expect(padAction(SCREEN.slots, "square")?.holdMs).toBe(1500);
    expect(padAction(SCREEN.lightbar, "square")).toEqual({ key: "lightbar.fav", n: 3, needsController: true });
    expect(padAction(SCREEN.status, "up")).toBeNull();
    expect(padAction(SCREEN.diag, "left")).toBeNull();
  });

  it("is exposed by useDs5Bridge as supportsOledPad / pressOledPad", async () => {
    let bridge: UseDs5BridgeResult | null = null;
    function Probe() {
      bridge = useDs5Bridge();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(bridge!.supportsOledPad).toBe(false);
    expect(await bridge!.pressOledPad("up")).toBe(false); // no board: nothing to press
    act(() => root.unmount());
  });
});
