import { describe, expect, it } from "vitest";
import { CommandError, Ds5BridgeClient, FEATURES2, IDENTITY_FEATURES, NARRATOR_LANGS, NARRATOR_LINES, NARRATOR_OFF } from "../../src/protocol/bridgeClient";
import { supportsLiveInput } from "../../src/desktop/useLiveInput";
import { DEFAULT_CONFIG, decodeConfigBody } from "../../src/protocol/config";
import { FakeDongle } from "../support/fakeDongle";

function setup(opts = {}) {
  const dongle = new FakeDongle(opts);
  return { dongle, client: new Ds5BridgeClient(dongle) };
}

describe("Ds5BridgeClient against the firmware command rules", () => {
  it("reads identity and accepts protocol 1.x", async () => {
    const { client } = setup();
    const id = await client.checkCompatible();
    expect(id.protoMajor).toBe(1);
    expect(id.configBodyLength).toBe(42); // + the narrator byte (1.3) and the right grip haptics (1.6)
    expect(id.slotCount).toBe(4);
  });

  it("refuses a dongle that speaks another protocol major", async () => {
    const { client } = setup({ protoMajor: 2 });
    await expect(client.checkCompatible()).rejects.toThrow(/not supported/);
  });

  it("applies config to RAM without touching flash", async () => {
    const { dongle, client } = setup();
    await client.applyConfig({ ...DEFAULT_CONFIG, hapticsGain: 3 });
    expect(decodeConfigBody(dongle.config).hapticsGain).toBe(3);
    expect(decodeConfigBody(dongle.flashConfig).hapticsGain).toBe(1);
  });

  it("waits through PENDING for a save and confirms it", async () => {
    const { dongle, client } = setup({ pendingPolls: 3 });
    await client.applyConfig({ ...DEFAULT_CONFIG, hapticsGain: 2.5 });
    await client.saveToFlash();
    expect(decodeConfigBody(dongle.flashConfig).hapticsGain).toBe(2.5);
  });

  it("surfaces a failed save as an error, not success", async () => {
    const { client } = setup({ saveFails: true });
    await expect(client.saveToFlash()).rejects.toBeInstanceOf(CommandError);
  });

  it("rejects out-of-range slot and trigger arguments", async () => {
    const { client } = setup();
    await expect(client.switchSlot(7)).rejects.toMatchObject({ result: "invalid" });
    await expect(client.previewTrigger(9)).rejects.toMatchObject({ result: "invalid" });
  });

  it("switches slots and reports the new current slot", async () => {
    const { dongle, client } = setup();
    await client.switchSlot(2);
    expect(dongle.currentSlot).toBe(2);
    expect((await client.identity()).currentSlot).toBe(2);
  });

  it("forgets one slot and wipes all", async () => {
    const { dongle, client } = setup();
    await client.forgetSlot(0);
    expect(dongle.slots[0]).toBe(false);
    dongle.slots = [true, true, true, true];
    await client.wipeSlots();
    expect(dongle.slots).toEqual([false, false, false, false]);
  });

  it("treats the device leaving after reboot / BOOTSEL as success", async () => {
    const { dongle, client } = setup();
    await expect(client.command(0x08)).resolves.toBe("gone");
    expect(dongle.gone).toBe(true);
  });

  it("detects another program commanding the dongle at the same time", async () => {
    const { dongle, client } = setup({ pendingPolls: 2 });
    const original = dongle.setReport.bind(dongle);
    dongle.setReport = async (id, payload) => {
      await original(id, payload);
      dongle.bumpSequenceExternally();
    };
    await expect(client.saveToFlash()).rejects.toThrow(/same time/);
  });

  it("writes a remap table and reads it back with a new revision", async () => {
    const { client } = setup();
    const table = Array.from({ length: 16 }, (_, i) => i);
    table[13] = 12; // Cross -> Circle
    await client.applyRemap(table);
    const state = await client.readRemap();
    expect(state?.table).toEqual(table);
    expect(state?.revision).toBe(1);
  });

  it("sends the trigger preview and factory reset", async () => {
    const { dongle, client } = setup();
    await client.previewTrigger(4);
    expect(dongle.lastTrigger).toBe(4);
    await client.applyConfig({ ...DEFAULT_CONFIG, hapticsGain: 5 });
    await client.factoryReset();
    expect(decodeConfigBody(dongle.flashConfig).hapticsGain).toBe(1);
  });

  it("reads version, RSSI, slots and audio counters", async () => {
    const { client } = setup();
    expect(await client.readFirmwareVersion()).toBe("0.8.0-test");
    expect(await client.readRssi()).toBe(-5);
    const slots = await client.readSlots();
    expect(slots.occupied).toEqual([true, false, false, false]);
    expect((await client.readAudioCounters()).core1Loops).toBe(1234);
  });
});

describe("live input (0xF0, protocol 1.2)", () => {
  it("advertises the live-input feature and reads a neutral controller", async () => {
    const { client } = setup();
    const id = await client.identity();
    expect(supportsLiveInput(id)).toBe(true);
    const input = (await client.readInput())!;
    expect(input.leftStick).toEqual({ x: 128, y: 128 });
    expect(input.dpad).toBe(8);
    expect(input.cross || input.l1 || input.r2 || input.home).toBe(false);
    expect(input.batteryPct).toBe(80);
  });

  it("decodes every button, the analog triggers, touches and trigger effects", async () => {
    const { dongle, client } = setup();
    dongle.input[4] = 200; // L2 analog
    dongle.input[5] = 37; // R2 analog
    dongle.input[7] = 0xf0 | 2; // all face buttons, d-pad east
    dongle.input[8] = 0xff; // L1 R1 L2 R2 Create Options L3 R3
    dongle.input[9] = 0x07; // PS, touchpad click, mute
    // Finger 0 touching at (960, 540): bit 7 clear = touching
    const f = (0 & 0x7f) | (960 << 8) | (540 << 20);
    new DataView(dongle.input.buffer).setUint32(32, f >>> 0, true);
    new DataView(dongle.input.buffer).setUint32(36, 0x80, true); // finger 1 not touching
    dongle.input[47] = (2 << 4) | 1; // L weapon, R feedback
    const i = (await client.readInput())!;
    expect([i.triggerLeft, i.triggerRight, i.dpad]).toEqual([200, 37, 2]);
    expect([i.square, i.cross, i.circle, i.triangle]).toEqual([true, true, true, true]);
    expect([i.l1, i.r1, i.l2, i.r2, i.create, i.options, i.l3, i.r3]).toEqual(Array(8).fill(true));
    expect([i.home, i.pad, i.mute]).toEqual([true, true, true]);
    expect(i.fingers[0]).toMatchObject({ touching: true, x: 960, y: 540 });
    expect(i.fingers[1].touching).toBe(false);
    expect([i.triggerEffectLeft, i.triggerEffectRight]).toEqual([2, 1]);
  });

  it("treats older firmware (no feature bit) as no live input", () => {
    expect(supportsLiveInput(null)).toBe(false);
    expect(supportsLiveInput({ features: 0x1f } as never)).toBe(false);
  });
});

describe("DualSense Edge extras", () => {
  it("decodes the Fn buttons and back paddles", async () => {
    const { dongle, client } = setup();
    dongle.input[9] = 0xf0;
    const i = (await client.readInput())!;
    expect([i.fnLeft, i.fnRight, i.backLeft, i.backRight]).toEqual([true, true, true, true]);
    expect([i.home, i.pad, i.mute]).toEqual([false, false, false]);
  });
});

describe("mute light", () => {
  it("reports the mic as muted from input byte 53 bit 2", async () => {
    const { dongle, client } = setup();
    expect((await client.readInput())!.micMuted).toBe(false);
    dongle.input[53] = 0x04;
    expect((await client.readInput())!.micMuted).toBe(true);
  });
});

describe("live input without a controller", () => {
  it("reads as no input, not a phantom press", async () => {
    const { dongle, client } = setup();
    dongle.input.fill(0); // what the dongle answers with no controller
    expect(await client.readInput()).toBeNull();
  });
});

describe("narrator firmware lines (protocol 1.3)", () => {
  it("reads the narrator byte after the config body and sets it without saving anything else", async () => {
    const dongle = new FakeDongle();
    const client = new Ds5BridgeClient(dongle);
    const id = await client.identity();
    expect(id.features & IDENTITY_FEATURES.narrator).toBeTruthy();
    expect(await client.readNarrator()).toBe(NARRATOR_OFF);
    // An unsaved edit stays unsaved when she's turned on.
    await client.applyConfig({ ...DEFAULT_CONFIG, hapticsGain: 3 });
    const flashBefore = dongle.flashConfig.slice();
    await client.setNarrator(1 + NARRATOR_LANGS.indexOf("de"));
    expect(await client.readNarrator()).toBe(2);
    expect(dongle.flashNarrator).toBe(2);
    expect(dongle.flashConfig).toEqual(flashBefore);
    await client.setNarrator(NARRATOR_OFF);
    expect(await client.readNarrator()).toBe(NARRATOR_OFF);
  });

  it("still finds the remap table after the longer body", async () => {
    const client = new Ds5BridgeClient(new FakeDongle());
    await client.applyRemap([1, 0, ...Array.from({ length: 14 }, (_, i) => i + 2)]);
    const remap = await client.readRemap();
    expect(remap?.table.slice(0, 2)).toEqual([1, 0]);
  });

  it("previews a line and refuses bad arguments", async () => {
    const dongle = new FakeDongle();
    const client = new Ds5BridgeClient(dongle);
    await client.sayNarratorLine(NARRATOR_LINES.batteryLow, 6);
    expect(dongle.said).toEqual([[5, 6]]);
    await expect(client.sayNarratorLine(6, 0)).rejects.toThrow();
    await expect(client.setNarrator(9)).rejects.toThrow();
  });

  it("is off on older firmware (no byte after the body)", async () => {
    const dongle = new FakeDongle();
    const client = new Ds5BridgeClient(dongle);
    dongle.getReport = async () => new Uint8Array(37);
    expect(await client.readNarrator()).toBeNull();
  });
});

describe("OLED screen mirror (0xEF, protocol 1.4)", () => {
  it("reads identity [29] and decodes the frame header", async () => {
    const { client } = setup();
    const id = await client.identity();
    expect(id.features2 & FEATURES2.oledMirror).toBe(FEATURES2.oledMirror);
    const frame = await client.readOledFrame();
    expect(frame).not.toBeNull();
    expect(frame!.power).toBe("on");
    expect(frame!.screen).toBe(2);
    expect(frame!.pixels.length).toBe(1024);
  });
});

describe("left / right grip haptics (protocol 1.6)", () => {
  it("writes and reads both strengths, keeps the narrator, and still finds the remap block", async () => {
    const dongle = new FakeDongle();
    dongle.narrator = 3;
    const client = new Ds5BridgeClient(dongle);
    await client.identity();
    expect(client.splitHaptics).toBe(true);
    await client.applyConfig({ ...(await client.readConfig()), hapticsGain: 2, hapticsGainRight: 4.5 });
    const back = await client.readConfig();
    expect([back.hapticsGain, back.hapticsGainRight]).toEqual([2, 4.5]);
    expect(dongle.narrator).toBe(3);
    expect(await client.readRemap()).not.toBeNull();
  });

  it("sends older firmware only the 37-byte body (byte 37 would be its narrator)", async () => {
    const dongle = new FakeDongle({ protoMinor: 5 });
    dongle.narrator = 3;
    const client = new Ds5BridgeClient(dongle);
    await client.identity();
    expect(client.splitHaptics).toBe(false);
    const cfg = await client.readConfig();
    expect(cfg.hapticsGainRight).toBe(cfg.hapticsGain);
    await client.applyConfig({ ...cfg, hapticsGain: 3 });
    expect(dongle.narrator).toBe(3);
    expect(await client.readRemap()).not.toBeNull();
  });
});

describe("grip test (protocol 1.6)", () => {
  it("announces it and sends the side", async () => {
    const dongle = new FakeDongle();
    const client = new Ds5BridgeClient(dongle);
    expect((await client.identity()).features2 & FEATURES2.gripTest).toBe(FEATURES2.gripTest);
    await client.gripTest("right");
    expect(dongle.lastGripTest).toBe(1);
    expect((await new Ds5BridgeClient(new FakeDongle({ protoMinor: 5 })).identity()).features2 & FEATURES2.gripTest).toBe(0);
  });
});
