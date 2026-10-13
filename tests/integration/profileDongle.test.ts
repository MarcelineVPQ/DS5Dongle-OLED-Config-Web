// A game profile on the (simulated) dongle and off again: RAM only, never a
// save to flash, and leaving puts back exactly what was there.
import { describe, expect, it } from "vitest";
import { Ds5BridgeClient } from "../../src/protocol/bridgeClient";
import { DEFAULT_CONFIG, decodeConfigBody, normalizeConfig, type ConfigBody } from "../../src/protocol/config";
import { DEFAULT_CURVES, encodeCurve, type StickCurve } from "../../src/protocol/stickCurve";
import { applyGameProfile, ProfileNotApplied, profileCaps, restoreNormal, type GameParts } from "../../src/desktop/library/profileDongle";
import { settingsFrom } from "../../src/desktop/library/profileValues";
import type { ProfileSettings } from "../../src/desktop/games/library";
import { FakeDongle } from "../support/fakeDongle";

const FLASH_WRITES = new Set([0x02, 0x04, 0x09, 0x0b, 0x0d, 0x10]); // save, slot switch (saves), factory reset, narrator, calibration, saved remap

async function setup(protoMinor: number) {
  const dongle = new FakeDongle({ protoMinor });
  dongle.edge = true;
  const client = new Ds5BridgeClient(dongle);
  await client.checkCompatible(); // as the app does first (decides the config layout)
  // The player's normal (saved) settings.
  const saved: ConfigBody = { ...DEFAULT_CONFIG, hapticsGain: 1.5, hapticsGainRight: 1.5, speakerVolume: -6, audioBufferLength: 48, lightbarMode: 2 };
  await client.applyConfig(saved);
  await client.saveToFlash();
  dongle.flashRemap = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0 : i));
  dongle.remap = dongle.flashRemap.slice();
  dongle.sets = [];
  const identity = await client.identity();
  // What the bridge hook does: config to RAM (0xF6 0x01), its copy kept.
  let config = await client.readConfig();
  const applyConfig = async (c: ConfigBody) => {
    await client.applyConfig(normalizeConfig(c));
    config = normalizeConfig(c);
    return true;
  };
  return { dongle, client, caps: profileCaps(identity), applyConfig, config: () => config, normal: settingsFrom(config) };
}

const precise: StickCurve = { type: "precise", points: DEFAULT_CURVES[0].points };
const profile: ProfileSettings = {
  format: 2,
  hapticsGain: 4,
  hapticsGainRight: 2.5,
  speakerVolume: 6,
  audioBufferLength: 96,
  autoHapticsEnable: 2,
  autoHapticsGain: 150,
  lightbarMode: 6,
  btMicEnable: false,
};
const parts: GameParts = { layout: { table: Array.from({ length: 16 }, (_, i) => (i === 3 ? 0xff : i)), extra: [5, 0xff, 0xfe, 0xff] }, curves: [precise, undefined] };

describe("game profiles on the dongle (RAM only)", () => {
  it("puts every part of a profile on without a save, and leaving restores exactly the saved state", async () => {
    const s = await setup(10);
    const flash = {
      config: s.dongle.flashConfig.slice(),
      remap: s.dongle.flashRemap.slice(),
      extra: s.dongle.flashExtra.slice(),
      curves: JSON.stringify(s.dongle.curves),
      rightGain: s.dongle.rightGain.slice(),
    };

    await applyGameProfile({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal, profile, parts });
    const ram = decodeConfigBody(s.dongle.config);
    expect(ram.hapticsGain).toBe(4);
    expect(ram.speakerVolume).toBe(6);
    expect(ram.audioBufferLength).toBe(96);
    expect(ram.autoHapticsEnable).toBe(2);
    expect(ram.lightbarMode).toBe(6);
    expect(ram.btMicEnable).toBe(false);
    expect(new Float32Array(s.dongle.rightGain.slice().buffer)[0]).toBe(2.5);
    expect(s.dongle.remap[3]).toBe(0xff);
    expect(s.dongle.remapTemporary).toBe(true);
    expect(s.dongle.extra).toEqual([5, 0xff, 0xfe, 0xff]);
    // Left stick: the game's curve; right: the saved one.
    expect(s.dongle.tempCurves?.pair).toEqual([encodeCurve(precise), s.dongle.curves[0][1]]);

    await restoreNormal({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal });
    // Never written to flash, and back to exactly what's saved.
    expect(s.dongle.sets.map((p) => p[0]).filter((f) => FLASH_WRITES.has(f))).toEqual([]);
    expect(s.dongle.flashConfig).toEqual(flash.config);
    expect(s.dongle.config).toEqual(flash.config);
    expect(s.dongle.rightGain).toEqual(flash.rightGain);
    expect(s.dongle.remap).toEqual(flash.remap);
    expect(s.dongle.flashRemap).toEqual(flash.remap);
    expect(s.dongle.extra).toEqual(flash.extra);
    expect(s.dongle.flashExtra).toEqual(flash.extra);
    expect(JSON.stringify(s.dongle.curves)).toBe(flash.curves);
    expect(s.dongle.tempCurves).toBeNull();
    expect(s.dongle.remapTemporary).toBe(false);
    // The dongle agrees: nothing unsaved, no game layout or curves on.
    const id = await s.client.identity();
    expect(id.unsaved).toBe(false);
    expect(id.remapTemporary).toBe(false);
    expect(id.curvesTemporary).toBe(false);
  });

  it("switching straight to another game's profile ends the first one's layout and curves", async () => {
    const s = await setup(10);
    await applyGameProfile({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal, profile, parts });
    await applyGameProfile({
      client: s.client,
      caps: s.caps,
      applyConfig: s.applyConfig,
      config: s.config(),
      normal: s.normal,
      profile: { format: 2, hapticsGain: 3 },
      parts: { layout: null, curves: null },
    });
    const ram = decodeConfigBody(s.dongle.config);
    expect(ram.hapticsGain).toBe(3);
    expect(ram.speakerVolume).toBe(-6); // the normal value, not the first game's
    expect(ram.audioBufferLength).toBe(48);
    expect(s.dongle.remap).toEqual(s.dongle.flashRemap);
    expect(s.dongle.tempCurves).toBeNull();
    expect(s.dongle.sets.map((p) => p[0]).filter((f) => FLASH_WRITES.has(f))).toEqual([]);
  });

  it("a layout that fails after the config landed puts the normal values back, never saving", async () => {
    const s = await setup(10);
    s.client.applyStickCurves = async () => {
      throw new Error("curves refused");
    };
    const failure = await applyGameProfile({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal, profile, parts }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProfileNotApplied);
    expect((failure as ProfileNotApplied).left).toBe("normal");
    expect(s.dongle.config).toEqual(s.dongle.flashConfig);
    expect(s.dongle.remap).toEqual(s.dongle.flashRemap);
    expect(s.dongle.sets.map((p) => p[0]).filter((f) => FLASH_WRITES.has(f))).toEqual([]);
  });

  it("older firmware gets the parts it reports and nothing else, without errors", async () => {
    for (const minor of [6, 8, 9]) {
      const s = await setup(minor);
      await applyGameProfile({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal, profile, parts });
      const sent = new Set(s.dongle.sets.map((p) => p[0]));
      expect(sent.has(0x11), `1.${minor} layout`).toBe(minor >= 8);
      expect(sent.has(0x13), `1.${minor} Edge extras`).toBe(minor >= 9);
      expect(sent.has(0x14), `1.${minor} curves`).toBe(false);
      expect(decodeConfigBody(s.dongle.config).speakerVolume).toBe(6);
      await restoreNormal({ client: s.client, caps: s.caps, applyConfig: s.applyConfig, config: s.config(), normal: s.normal });
      expect(s.dongle.config).toEqual(s.dongle.flashConfig);
      expect(s.dongle.remap).toEqual(s.dongle.flashRemap);
      expect([...s.dongle.sets.map((p) => p[0])].filter((f) => FLASH_WRITES.has(f))).toEqual([]);
    }
  });
});
