import { describe, expect, it } from "vitest";
import {
  CommandError,
  CORE1_MIC_FAILED,
  CORE1_STAGE_RUNNING,
  CORE1_SPEAKER_FAILED,
  Ds5BridgeClient,
  decodeAudioCounters,
  FEATURES2,
  FEATURES3,
  IDENTITY_FEATURES,
  NARRATOR_LANGS,
  NARRATOR_LINES,
  NARRATOR_OFF,
  POWER_FLAGS,
  TIMING_STAGES,
} from "../../src/protocol/bridgeClient";
import { supportsLiveInput } from "../../src/desktop/useLiveInput";
import { DEFAULT_CONFIG, decodeConfigBody, encodeConfigBody } from "../../src/protocol/config";
import { DEFAULT_CURVES, DEFAULT_CUSTOM_POINTS, encodeCurve, type StickCurve } from "../../src/protocol/stickCurve";
import { CTRL_TEST, decodeTelemetry } from "../../src/protocol/controllerInfo";
import { loadControllerInfo } from "../../src/desktop/live/loadControllerInfo";
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

describe("upstream's settings batch (protocol 1.13)", () => {
  it("writes and reads the 1.13 settings, keeps the narrator and the remap block", async () => {
    const dongle = new FakeDongle({ protoMinor: 13 });
    dongle.narrator = 3;
    const client = new Ds5BridgeClient(dongle);
    const id = await client.identity();
    expect(id.configBodyLength).toBe(49);
    expect(id.features3 & FEATURES3.configTail).toBe(FEATURES3.configTail);
    expect(client.configTail).toBe(true);
    await client.applyConfig({ ...(await client.readConfig()), hapticsGainRight: 2, triggerReduce: 5, lockVolume: true, speakerSelect: 2, statusGpioPin: 16 });
    const back = await client.readConfig();
    expect([back.hapticsGainRight, back.triggerReduce, back.lockVolume, back.speakerSelect, back.statusGpioPin]).toEqual([2, 5, true, 2, 16]);
    expect(dongle.narrator).toBe(3);
    expect(await client.readRemap()).not.toBeNull();
    expect((await client.identity()).unsaved).toBe(true);
    await client.saveToFlash();
    expect((await client.identity()).unsaved).toBe(false);
  });

  it("an older app's 42-byte write leaves the 1.13 settings alone", async () => {
    const dongle = new FakeDongle({ protoMinor: 13 });
    const client = new Ds5BridgeClient(dongle);
    await client.identity();
    await client.applyConfig({ ...(await client.readConfig()), triggerReduce: 7 });
    const before = await client.readConfig();
    await client.command(0x01, [...encodeConfigBody({ ...before, inactiveTime: 45 }, true)]);
    const after = await client.readConfig();
    expect([after.inactiveTime, after.triggerReduce]).toEqual([45, 7]);
  });

  it("sends 1.12 firmware the 42-byte body and reads the 1.13 settings as defaults", async () => {
    const dongle = new FakeDongle({ protoMinor: 12 });
    const client = new Ds5BridgeClient(dongle);
    await client.identity();
    expect(client.configTail).toBe(false);
    const sets = dongle.sets.length;
    await client.applyConfig({ ...(await client.readConfig()), triggerReduce: 4 });
    expect(dongle.sets.slice(sets).find((p) => p[0] === 0x01)?.length).toBe(1 + 42);
    expect((await client.readConfig()).triggerReduce).toBe(0);
    expect(await client.readRemap()).not.toBeNull();
  });
});

describe("PC sleep options (protocol 1.14)", () => {
  it("reads the bits from identity [47] and saves them with 0xF6 0x17", async () => {
    const dongle = new FakeDongle({ protoMinor: 14, pendingPolls: 2 });
    const client = new Ds5BridgeClient(dongle);
    const id = await client.identity();
    expect(id.features3 & FEATURES3.pcSleep).toBe(FEATURES3.pcSleep);
    expect(id.powerFlags).toBe(POWER_FLAGS.sleepControllerOff); // the firmware's defaults: off on sleep, no wake
    await client.setPowerFlags(POWER_FLAGS.sleepControllerOff | POWER_FLAGS.psWakesPc);
    expect(dongle.sets.at(-1)).toEqual(new Uint8Array([0x17, 0x03]));
    expect((await client.identity()).powerFlags).toBe(0x03); // resolved after PENDING, saved
    expect((await client.identity()).unsaved).toBe(false); // nothing else was saved or changed
    await client.setPowerFlags(0);
    expect((await client.identity()).powerFlags).toBe(0);
  });

  it("reports a failed save, and older firmware has none", async () => {
    const failing = new Ds5BridgeClient(new FakeDongle({ protoMinor: 14, saveFails: true }));
    await expect(failing.setPowerFlags(POWER_FLAGS.psWakesPc)).rejects.toBeInstanceOf(CommandError);
    const older = new FakeDongle({ protoMinor: 13 });
    const id = await new Ds5BridgeClient(older).identity();
    expect(id.powerFlags).toBeNull();
    expect(id.features3 & FEATURES3.pcSleep).toBe(0);
    await expect(new Ds5BridgeClient(older).setPowerFlags(POWER_FLAGS.psWakesPc)).rejects.toThrow(/rejected \(invalid\)/);
  });

  it("a factory reset puts them back to the defaults", async () => {
    const dongle = new FakeDongle({ protoMinor: 14 });
    const client = new Ds5BridgeClient(dongle);
    await client.setPowerFlags(POWER_FLAGS.psWakesPc);
    await client.factoryReset();
    expect((await client.identity()).powerFlags).toBe(POWER_FLAGS.sleepControllerOff);
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

describe("temporary remap (protocol 1.8)", () => {
  const swapped = [1, 0, ...Array.from({ length: 14 }, (_, i) => i + 2)];
  const identity = Array.from({ length: 16 }, (_, i) => i);

  it("applies a table in RAM only and goes back to the saved one", async () => {
    const dongle = new FakeDongle({ protoMinor: 8 });
    const client = new Ds5BridgeClient(dongle);
    expect((await client.identity()).remapTemporary).toBe(false);
    await client.applyRemapTemporary(swapped);
    expect((await client.readRemap())?.table).toEqual(swapped);
    expect((await client.identity()).remapTemporary).toBe(true);
    expect(dongle.flashRemap).toEqual(identity); // flash untouched
    await client.revertRemap();
    expect((await client.readRemap())?.table).toEqual(identity);
    expect((await client.identity()).remapTemporary).toBe(false);
  });

  it("a normal remap write saves and ends the temporary one", async () => {
    const dongle = new FakeDongle({ protoMinor: 8 });
    const client = new Ds5BridgeClient(dongle);
    await client.applyRemapTemporary(swapped);
    await client.applyRemap(identity);
    expect((await client.identity()).remapTemporary).toBe(false);
    expect(dongle.flashRemap).toEqual(identity);
  });

  it("older firmware doesn't report it and refuses the command", async () => {
    const client = new Ds5BridgeClient(new FakeDongle({ protoMinor: 7 }));
    const id = await client.identity();
    expect(id.remapTemporary).toBeNull();
    expect((id.features2 & FEATURES2.temporaryRemap) !== 0).toBe(false);
    await expect(client.applyRemapTemporary(swapped)).rejects.toBeInstanceOf(CommandError);
  });
});

describe("core1 health in the audio counters (issue #15)", () => {
  it("reads the speaker-encoder failure when the firmware reports it", async () => {
    const c = await new Ds5BridgeClient(new FakeDongle({ speakerEncoderFailed: true })).readAudioCounters();
    expect(c.core1Flags).toBe(0x03);
    expect(c.core1FreeHeap).toBe(12 * 1024);
  });
  it("reads the mic-decoder failure, on its own and with the speaker's", async () => {
    const mic = await new Ds5BridgeClient(new FakeDongle({ micDecoderFailed: true })).readAudioCounters();
    expect(mic.core1Flags).toBe(0x01 | CORE1_MIC_FAILED);
    expect((mic.core1Flags ?? 0) & CORE1_SPEAKER_FAILED).toBe(0);
    const both = await new Ds5BridgeClient(new FakeDongle({ micDecoderFailed: true, speakerEncoderFailed: true })).readAudioCounters();
    expect(both.core1Flags).toBe(0x01 | CORE1_SPEAKER_FAILED | CORE1_MIC_FAILED);
  });
  it("a healthy core1: started, its free heap, and loops that move", async () => {
    const client = new Ds5BridgeClient(new FakeDongle());
    const a = await client.readAudioCounters();
    const b = await client.readAudioCounters();
    expect(a.core1Flags).toBe(0x01);
    expect(a.core1FreeHeap).toBe(184 * 1024);
    expect(b.core1Loops).not.toBe(a.core1Loops);
  });
  it("asks for no more than the 63 bytes a reply can carry", async () => {
    const dongle = new FakeDongle();
    const lengths: number[] = [];
    const get = dongle.getReport.bind(dongle);
    dongle.getReport = (id, length) => (lengths.push(length), get(id, length));
    await new Ds5BridgeClient(dongle).readAudioCounters();
    expect(lengths).toEqual([63]);
  });
  for (const legacy of ["none", "cut"] as const) {
    it(`older firmware (${legacy}): no health fields, the counters still read`, async () => {
      const c = await new Ds5BridgeClient(new FakeDongle({ audioCountersLegacy: legacy, speakerEncoderFailed: true })).readAudioCounters();
      expect(c.core1Loops).toBe(1234);
      expect(c.core1Flags).toBeUndefined();
      expect(c.core1FreeHeap).toBeUndefined();
      expect(c.core1Stage).toBeUndefined();
    });
  }
  it("a running core1 reports start-up stage 9, apart from the flags", async () => {
    const c = await new Ds5BridgeClient(new FakeDongle({ speakerEncoderFailed: true })).readAudioCounters();
    expect(c.core1Stage).toBe(CORE1_STAGE_RUNNING);
    expect(c.core1Flags).toBe(0x03);
  });
  it("a core1 stuck in start-up: the stage, loops that never move, heap only once read", async () => {
    for (let stage = 0; stage <= 8; stage++) {
      const client = new Ds5BridgeClient(new FakeDongle({ core1StuckStage: stage }));
      const a = await client.readAudioCounters();
      const b = await client.readAudioCounters();
      expect(a.core1Stage).toBe(stage);
      expect(a.core1Loops).toBe(0);
      expect(b.core1Loops).toBe(0);
      expect(a.core1Flags).toBe(stage >= 3 ? 0x01 : 0);
      expect(a.core1FreeHeap).toBe(stage >= 4 ? 184 * 1024 : undefined);
    }
  });
  it("decodes every stage from raw [60] bytes, flags untouched", () => {
    for (let stage = 0; stage < 16; stage++) {
      const bytes = new Uint8Array(63);
      bytes[60] = 0x80 | (stage << 3) | 0x05;
      const c = decodeAudioCounters(bytes);
      expect(c.core1Stage).toBe(stage);
      expect(c.core1Flags).toBe(0x05);
    }
    // Without bit7 (0.9.4 to 0.9.5-dev.5) the same bits are not a stage.
    const old = new Uint8Array(63);
    old[60] = 0x01 | (4 << 3);
    expect(decodeAudioCounters(old).core1Stage).toBeUndefined();
  });
});

describe("Edge extra-button remap (protocol 1.9)", () => {
  it("saves and reads the four entries; temporary ones revert", async () => {
    const dongle = new FakeDongle({ protoMinor: 9 });
    const client = new Ds5BridgeClient(dongle);
    expect(await client.readRemapExtra()).toEqual([0xff, 0xff, 0xff, 0xff]);
    await client.applyRemapExtra([13, 0xfe, 0xff, 12], false); // Fn L → Cross, Fn R off, right paddle → Circle
    expect(await client.readRemapExtra()).toEqual([13, 0xfe, 0xff, 12]);
    await client.applyRemapExtra([0, 0, 0, 0], true);
    expect((await client.identity()).remapTemporary).toBe(true);
    await client.revertRemap();
    expect(await client.readRemapExtra()).toEqual([13, 0xfe, 0xff, 12]);
  });

  it("refuses invalid entries; older firmware doesn't announce it", async () => {
    const client = new Ds5BridgeClient(new FakeDongle({ protoMinor: 9 }));
    await expect(client.applyRemapExtra([16, 0xff, 0xff, 0xff], false)).rejects.toThrow();
    const old = await new Ds5BridgeClient(new FakeDongle({ protoMinor: 8 })).identity();
    expect((old.features2 & FEATURES2.remapExtra) !== 0).toBe(false);
  });
});

describe("stick response curves (protocol 1.10)", () => {
  const precise: StickCurve = { type: "precise", points: DEFAULT_CUSTOM_POINTS };
  const custom: StickCurve = {
    type: "custom",
    points: [
      [0, 40],
      [64, 64],
      [128, 200],
      [255, 255],
    ],
  };

  it("reads Linear by default, saves per slot, and announces the feature", async () => {
    const dongle = new FakeDongle({ protoMinor: 10 });
    const client = new Ds5BridgeClient(dongle);
    const id = await client.identity();
    expect(id.features2 & FEATURES2.stickCurves).toBe(FEATURES2.stickCurves);
    expect(id.curvesTemporary).toBe(false);
    const first = await client.readStickCurves();
    expect(first?.saved).toEqual(DEFAULT_CURVES);
    expect(first?.temporary).toBe(false);
    await client.applyStickCurves(0, precise, custom, false);
    const back = await client.readStickCurves();
    expect(back?.slot).toBe(0);
    expect(back?.saved).toEqual([precise, custom]);
    expect(back?.active).toEqual([precise, custom]);
    expect(dongle.curves[1]).toEqual(DEFAULT_CURVES.map(encodeCurve)); // other slots untouched
  });

  it("temporary curves stay in RAM and end with the revert; a saved set ends them too", async () => {
    const dongle = new FakeDongle({ protoMinor: 10 });
    const client = new Ds5BridgeClient(dongle);
    await client.applyStickCurves(0, custom, custom, true);
    let r = await client.readStickCurves();
    expect(r?.temporary).toBe(true);
    expect(r?.active).toEqual([custom, custom]);
    expect(r?.saved).toEqual(DEFAULT_CURVES); // never saved
    expect((await client.identity()).curvesTemporary).toBe(true);
    await client.revertRemap();
    r = await client.readStickCurves();
    expect(r?.temporary).toBe(false);
    expect(r?.active).toEqual(DEFAULT_CURVES);
    await client.applyStickCurves(0, custom, custom, true);
    await client.applyStickCurves(0, precise, precise, false);
    r = await client.readStickCurves();
    expect(r?.temporary).toBe(false);
    expect(r?.active).toEqual([precise, precise]);
  });

  it("refuses decreasing custom points; older firmware refuses the command and doesn't announce it", async () => {
    const client = new Ds5BridgeClient(new FakeDongle({ protoMinor: 10 }));
    const bad: StickCurve = { type: "custom", points: [custom.points[1], custom.points[0], custom.points[2], custom.points[3]] };
    await expect(client.applyStickCurves(0, bad, precise, false)).rejects.toThrow();
    const dongle = new FakeDongle({ protoMinor: 10 });
    await dongle.setReport(0xf6, new Uint8Array([0x14, 0x43, 0x56, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, ...encodeCurve(precise), 0]));
    expect((await new Ds5BridgeClient(dongle).identity()).lastResult).toBe("invalid"); // type 6
    const old = new Ds5BridgeClient(new FakeDongle({ protoMinor: 9 }));
    const oldId = await old.identity();
    expect(oldId.features2 & FEATURES2.stickCurves).toBe(0);
    expect(oldId.curvesTemporary).toBeNull();
    await expect(old.applyStickCurves(0, precise, precise, false)).rejects.toBeInstanceOf(CommandError);
  });
});

describe("per-stage timings (protocol 1.11)", () => {
  it("reads the timings from 0xFC and resets them with 0xF6 0x15", async () => {
    const dongle = new FakeDongle({ protoMinor: 11 });
    const client = new Ds5BridgeClient(dongle);
    const id = await client.checkCompatible();
    expect(id.features2 & FEATURES2.timings).toBe(FEATURES2.timings);
    dongle.timingsResetAt -= 30_000;
    const before = await client.readCpu(true);
    expect(before.setKhz).toBe(150000);
    expect(before.timings?.stages).toHaveLength(TIMING_STAGES.length);
    expect(before.timings?.sinceResetSeconds).toBeGreaterThanOrEqual(30);
    expect(before.timings?.stages.every((s) => s.avgNs > 0 && s.maxUs > 0)).toBe(true);
    await client.resetTimings();
    expect(dongle.sets.at(-1)?.[0]).toBe(0x15);
    const after = await client.readCpu(true);
    expect(after.timings?.sinceResetSeconds).toBeLessThan(2);
    expect(after.timings!.stages[0].maxUs).toBeLessThan(before.timings!.stages[0].maxUs);
  });

  it("asks older firmware for 11 bytes and reports no timings", async () => {
    const dongle = new FakeDongle({ protoMinor: 10, live: true });
    const client = new Ds5BridgeClient(dongle);
    const id = await client.checkCompatible();
    expect(id.features2 & FEATURES2.timings).toBe(0);
    const cpu = await client.readCpu();
    expect(cpu.timings).toBeNull();
    expect(cpu.tempRaw).toBe(844);
    await expect(client.resetTimings()).rejects.toBeInstanceOf(CommandError);
  });
});

describe("controller health & info (protocol 1.12)", () => {
  it("announces it in identity [46], and older firmware doesn't", async () => {
    expect((await setup({ protoMinor: 12 }).client.identity()).features3 & FEATURES3.controllerInfo).toBe(FEATURES3.controllerInfo);
    expect((await setup({ protoMinor: 11 }).client.identity()).features3).toBe(0);
    await expect(setup({ protoMinor: 11 }).client.readControllerHeader()).rejects.toThrow(/refused/);
  });

  it("runs the counters command and returns its pages", async () => {
    const { dongle, client } = setup({ protoMinor: 12 });
    const block = await client.runControllerTest(CTRL_TEST.telemetry.dev, CTRL_TEST.telemetry.action, 4);
    expect(dongle.sets.at(-1)).toEqual(new Uint8Array([0x16, 0x70, 1, 4]));
    expect(block?.length).toBe(4 * 56);
    expect(decodeTelemetry(block!, false)?.bluetoothConnects).toBe(1204);
    expect(block!.subarray(1, 18).every((b) => b === 0)).toBe(true); // the serial's place is blank
  });

  it("loads everything for the card, DualSense and Edge", async () => {
    const ds = await loadControllerInfo(setup({ protoMinor: 12 }).client);
    expect(ds.millivolts).toBe(3868);
    expect(ds.firmware?.buildDate).toBe("Jun 13 2024 10:22:31");
    expect(ds.btPatch).toBe(0xa1b);
    expect(ds.telemetry?.activeTime).toBe(412345);
    expect(ds.telemetry?.buttons.mute).toBeGreaterThan(0);
    expect(ds.tooOld).toBe(false);
    expect(ds.edge).toBe(false);
    const edgeDongle = new FakeDongle({ protoMinor: 12 });
    edgeDongle.edge = true;
    const edge = await loadControllerInfo(new Ds5BridgeClient(edgeDongle));
    expect(edge.telemetry?.buttons.paddleRight).toBeGreaterThan(0);
    expect(edge.telemetry?.sticks[1].roundTripsX).toBe(120000);
    expect(edge.edge).toBe(true);
  });

  it("says when the controller's firmware is too old, keeping the play time", async () => {
    const info = await loadControllerInfo(setup({ protoMinor: 12, controllerUpdateVersion: 1106 }).client);
    expect(info.tooOld).toBe(true);
    expect(info.telemetry).toBeNull();
    expect(info.activeOnly).toBe(412345);
  });

  it("returns null when the controller doesn't answer, and refuses other commands", async () => {
    const { client } = setup({ protoMinor: 12, controllerAnswers: false });
    expect(await client.runControllerTest(CTRL_TEST.battery.dev, CTRL_TEST.battery.action, 1)).toBeNull();
    await expect(client.runControllerTest(0x01, 0x13, 1)).rejects.toBeInstanceOf(CommandError); // serial number: never
    const info = await loadControllerInfo(client);
    expect(info.millivolts).toBeNull();
    expect(info.telemetry).toBeNull();
  });
});
