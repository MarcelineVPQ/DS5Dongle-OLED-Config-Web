import { describe, expect, it } from "vitest";
import { CommandError, Ds5BridgeClient } from "../../src/protocol/bridgeClient";
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
    expect(id.configBodyLength).toBe(37);
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
