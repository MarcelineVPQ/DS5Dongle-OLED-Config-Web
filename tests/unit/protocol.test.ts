import { describe, expect, it } from "vitest";
import { AUDIO_COUNTER_NAMES, decodeAudioCounters, decodeCpu, decodeIdentity, sameIdentity, TIMING_MAX_SATURATED, TIMING_STAGES } from "../../src/protocol/bridgeClient";
import {
  CONFIG_BODY_SIZE,
  CONFIG_BODY_SIZE_V13,
  CONFIG_BODY_SIZE_V16,
  DEFAULT_CONFIG,
  MIC_LEVEL_MAX,
  decodeConfigBody,
  encodeConfigBody,
  normalizeConfig,
  STATUS_GPIO_OFF,
  validateConfig,
} from "../../src/protocol/config";
import { decodeRemapFromConfigReport, encodeRemapSet, identityTable } from "../../src/protocol/remap";

describe("config codec (firmware Config_body, 37 bytes)", () => {
  it("round-trips every field", () => {
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, hapticsGain: 4.5, speakerVolume: -20, lightbarMode: 3, lbFavR: [1, 2, 3, 4], screenBrightness: 2, controllerWakesDisplay: false });
    const bytes = encodeConfigBody(cfg);
    expect(bytes.length).toBe(CONFIG_BODY_SIZE);
    // Before protocol 1.6 there is one strength for both grips.
    expect(decodeConfigBody(bytes)).toEqual({ ...cfg, hapticsGainRight: cfg.hapticsGain });
  });

  it("carries the right grip after the narrator byte from protocol 1.6", () => {
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, hapticsGain: 2, hapticsGainRight: 5.5 });
    const bytes = encodeConfigBody(cfg, true);
    expect(bytes.length).toBe(42);
    expect(bytes[37]).toBe(0xff); // the narrator byte, which a settings write never changes
    expect(decodeConfigBody(bytes)).toEqual(cfg);
  });

  it("carries the protocol 1.13 settings after the right grip (49 bytes)", () => {
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, hapticsGainRight: 3, triggerReduce: 6, speakerGain: 3, lockVolume: true, micSelect: 2, speakerSelect: 3, statusGpioPin: 22, statusGpioMode: 1 });
    const bytes = encodeConfigBody(cfg, true, true);
    expect(bytes.length).toBe(CONFIG_BODY_SIZE_V13);
    expect([...bytes.subarray(42)]).toEqual([6, 3, 1, 2, 3, 22, 1]);
    expect(decodeConfigBody(bytes)).toEqual(cfg);
    // Older firmware's body (42 bytes): the 1.13 settings read as their defaults.
    const old = decodeConfigBody(bytes.subarray(0, 42));
    expect([old.triggerReduce, old.speakerGain, old.lockVolume, old.micSelect, old.speakerSelect, old.statusGpioPin]).toEqual([0, 0, false, 0, 0, STATUS_GPIO_OFF]);
  });

  it("carries the protocol 1.16 mic level after the 1.13 settings (50 bytes)", () => {
    const cfg = normalizeConfig({ ...DEFAULT_CONFIG, triggerReduce: 2, micLevel: 40 });
    const bytes = encodeConfigBody(cfg, true, true, true);
    expect(bytes.length).toBe(CONFIG_BODY_SIZE_V16);
    expect(bytes[49]).toBe(40);
    expect(decodeConfigBody(bytes)).toEqual(cfg);
    // 1.13..1.15 firmware's body (49 bytes): the mic level reads as 0 (follow the PC).
    expect(decodeConfigBody(bytes.subarray(0, 49)).micLevel).toBe(0);
    // ...and isn't sent to it.
    expect(encodeConfigBody(cfg, true, true).length).toBe(CONFIG_BODY_SIZE_V13);
  });

  it("checks the mic level's range", () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, micLevel: MIC_LEVEL_MAX })).toEqual([]);
    expect(validateConfig({ ...DEFAULT_CONFIG, micLevel: MIC_LEVEL_MAX + 1 }).map((i) => i.field)).toEqual(["micLevel"]);
    expect(validateConfig({ ...DEFAULT_CONFIG, micLevel: 1.5 }).map((i) => i.field)).toEqual(["micLevel"]);
    expect(normalizeConfig({ ...DEFAULT_CONFIG, micLevel: 99 }).micLevel).toBe(MIC_LEVEL_MAX);
  });

  it("never takes a 63-byte read's remap block (at 42 from 1.13) for the 1.13 settings", () => {
    const report = new Uint8Array(63);
    report.set(encodeConfigBody({ ...DEFAULT_CONFIG, triggerReduce: 4 }, true, true).subarray(0, 42));
    report.set([0x52, 0x4d, 1, 0, 0, ...Array.from({ length: 16 }, (_, i) => i)], 42);
    expect(decodeConfigBody(report).triggerReduce).toBe(0);
  });

  it("checks the 1.13 settings like the firmware", () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, triggerReduce: 10, speakerGain: 7, speakerSelect: 3, statusGpioPin: 28 })).toEqual([]);
    expect(validateConfig({ ...DEFAULT_CONFIG, triggerReduce: 11 })[0]?.field).toBe("triggerReduce");
    expect(validateConfig({ ...DEFAULT_CONFIG, speakerGain: 8 })[0]?.field).toBe("speakerGain");
    expect(validateConfig({ ...DEFAULT_CONFIG, statusGpioPin: 9 })[0]?.field).toBe("statusGpioPin"); // the OLED's chip select
    expect(normalizeConfig({ ...DEFAULT_CONFIG, statusGpioPin: 25 }).statusGpioPin).toBe(STATUS_GPIO_OFF);
  });

  it("defaults to 500 Hz polling, like a fresh firmware config", () => {
    expect(DEFAULT_CONFIG.pollingRateMode).toBe(1);
  });

  it("puts haptics gain at offset 1 as little-endian float32", () => {
    const bytes = encodeConfigBody({ ...DEFAULT_CONFIG, hapticsGain: 1 });
    expect([...bytes.subarray(1, 5)]).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  it("accepts haptics gain 1.0-6.0 like the firmware, and nothing outside", () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, hapticsGain: 6 })).toEqual([]);
    expect(validateConfig({ ...DEFAULT_CONFIG, hapticsGain: 6.1 })[0]?.field).toBe("hapticsGain");
    expect(validateConfig({ ...DEFAULT_CONFIG, hapticsGain: 0.9 })[0]?.field).toBe("hapticsGain");
  });

  it("defaults Auto Haptics to Off, matching firmware v0.7.0", () => {
    expect(DEFAULT_CONFIG.autoHapticsEnable).toBe(0);
  });

  it("refuses to encode an invalid config", () => {
    expect(() => encodeConfigBody({ ...DEFAULT_CONFIG, inactiveTime: 2 })).toThrow();
  });

  it("decodes a pre-v0.6.5 19-byte body with defaults for the tail", () => {
    const full = encodeConfigBody({ ...DEFAULT_CONFIG, hapticsGain: 2 });
    const cfg = decodeConfigBody(full.subarray(0, 19));
    expect(cfg.hapticsGain).toBe(2);
    expect(cfg.lightbarMode).toBe(DEFAULT_CONFIG.lightbarMode);
  });
});

describe("remap codec", () => {
  it("encodes the 0x10 SET with magic and version", () => {
    const report = encodeRemapSet(identityTable());
    expect([...report.subarray(0, 4)]).toEqual([0x10, 0x52, 0x4d, 1]);
    expect([...report.subarray(4, 20)]).toEqual(identityTable());
  });

  it("rejects tables with bad entries", () => {
    const bad = identityTable();
    bad[3] = 16;
    expect(() => encodeRemapSet(bad)).toThrow();
  });

  it("finds the remap block right after the 37-byte body", () => {
    const report = new Uint8Array(58);
    report.set([0x52, 0x4d, 1, 7, 0, ...identityTable()], CONFIG_BODY_SIZE);
    expect(decodeRemapFromConfigReport(report)).toEqual({ version: 1, revision: 7, table: identityTable() });
  });

  it("returns null when the firmware has no remap block", () => {
    expect(decodeRemapFromConfigReport(new Uint8Array(37))).toBeNull();
  });
});

describe("identity report (0xF1)", () => {
  const sample = () => {
    const b = new Uint8Array(20);
    b.set([0x44, 0x53, 0x35, 0x4f, 1, 2, 37, 0x1f, 0x34, 0x12, 0x0a, 1, 9, 0, 0, 0, 4, 2, 1]);
    return b;
  };

  it("decodes every field", () => {
    expect(decodeIdentity(sample())).toEqual({
      protoMajor: 1,
      protoMinor: 2,
      configBodyLength: 37,
      features: 0x1f,
      sequence: 0x1234,
      lastFunction: 0x0a,
      lastResult: "pending",
      hostConfigGeneration: 9,
      slotCount: 4,
      currentSlot: 2,
      controllerConnected: true,
      unsaved: null, // feature bit 0x40 not set
      charging: false,
      batteryFull: false,
      lightbar: null,
      battery: null,
      playerLeds: 0,
      model: null,
      colorwayCode: null,
      features2: 0,
      boardName: null,
      remapTemporary: null,
      curvesTemporary: null,
      features3: 0,
      powerFlags: null,
      pcMicLevel: null,
    });
  });

  it("tells a repeated identity read from a changed one (no 1 Hz re-render)", () => {
    const lit = () => {
      const b = new Uint8Array(29);
      b.set(sample());
      b.set([0, 10, 20, 30], 20);
      return b;
    };
    expect(sameIdentity(decodeIdentity(lit()), decodeIdentity(lit()))).toBe(true);
    const other = lit();
    other[22] = 21; // the lightbar's green
    expect(sameIdentity(decodeIdentity(lit()), decodeIdentity(other))).toBe(false);
    const seq = lit();
    seq[8] = 0x35;
    expect(sameIdentity(decodeIdentity(lit()), decodeIdentity(seq))).toBe(false);
    expect(sameIdentity(null, decodeIdentity(lit()))).toBe(false);
    expect(sameIdentity(null, null)).toBe(true);
  });

  it("reads the third feature byte (protocol 1.12) only from a 47-byte identity", () => {
    const b = new Uint8Array(47);
    b.set(sample());
    b[46] = 0x01;
    expect(decodeIdentity(b).features3).toBe(1);
    expect(decodeIdentity(b.subarray(0, 46)).features3).toBe(0);
  });

  it("reads the PC sleep options (protocol 1.14) only from a 48-byte identity with bit 2", () => {
    const b = new Uint8Array(48);
    b.set(sample());
    b[5] = 14;
    b[46] = 0x07;
    b[47] = 0x02;
    expect(decodeIdentity(b).powerFlags).toBe(0x02);
    expect(decodeIdentity(b.subarray(0, 47)).powerFlags).toBeNull(); // 1.12 / 1.13 answer 47 bytes
    expect(decodeIdentity(b.subarray(0, 47)).features3).toBe(0x07);
    const noBit = b.slice();
    noBit[46] = 0x03;
    expect(decodeIdentity(noBit).powerFlags).toBeNull();
    const older = b.slice();
    older[5] = 13;
    expect(decodeIdentity(older).powerFlags).toBeNull();
  });

  it("reads the PC's mic level (protocol 1.16) only from a 49-byte identity with bit 4", () => {
    const b = new Uint8Array(49);
    b.set(sample());
    b[5] = 16;
    b[46] = 0x1f;
    b[48] = 0;
    expect(decodeIdentity(b).pcMicLevel).toBe(0);
    b[48] = 0x40;
    expect(decodeIdentity(b).pcMicLevel).toBe(0x40);
    expect(decodeIdentity(b.subarray(0, 48)).pcMicLevel).toBeNull(); // 1.14 / 1.15 answer 48 bytes
    const noBit = b.slice();
    noBit[46] = 0x0f;
    expect(decodeIdentity(noBit).pcMicLevel).toBeNull();
    const older = b.slice();
    older[5] = 15;
    expect(decodeIdentity(older).pcMicLevel).toBeNull();
  });

  it("reads the board name (protocol 1.7) only when the firmware announces it", () => {
    const b = new Uint8Array(46);
    b.set(sample());
    b.set(
      [..."Pico 2 W"].map((c) => c.charCodeAt(0)),
      30,
    );
    expect(decodeIdentity(b).boardName).toBeNull(); // FEATURES2 bit 3 not set
    b[29] = 0x08;
    expect(decodeIdentity(b).boardName).toBe("Pico 2 W");
    expect(decodeIdentity(b.subarray(0, 30)).boardName).toBeNull(); // older firmware: short report
    b[31] = 0x07; // not printable
    expect(decodeIdentity(b).boardName).toBeNull();
  });

  it("reports unsaved settings only when the firmware has the flag", () => {
    const b = sample();
    b[19] = 1;
    expect(decodeIdentity(b).unsaved).toBeNull();
    b[7] |= 0x40;
    expect(decodeIdentity(b).unsaved).toBe(true);
    b[19] = 0;
    expect(decodeIdentity(b).unsaved).toBe(false);
  });

  it("reports no model until the dongle knows it (0xFF)", () => {
    const b = new Uint8Array(29);
    b.set(sample());
    b[26] = 0xff;
    expect(decodeIdentity(b).model).toBeNull();
    b[26] = 1;
    expect(decodeIdentity(b).model).toBe("edge");
  });

  it("decodes the protocol 1.1 controller fields when present", () => {
    const b = new Uint8Array(25);
    b.set(sample());
    b.set([0x01, 170, 15, 97, 7], 20);
    const id = decodeIdentity(b);
    expect(id).toMatchObject({ charging: true, batteryFull: false, lightbar: [170, 15, 97], battery: 70, playerLeds: 0 });
  });

  it("reports no lightbar or battery without a controller", () => {
    const b = new Uint8Array(25);
    b.set(sample());
    b[18] = 0;
    b[24] = 0xff;
    expect(decodeIdentity(b)).toMatchObject({ lightbar: null, battery: null, charging: false });
  });

  it("rejects a report without the DS5O magic", () => {
    const b = sample();
    b[3] = 0;
    expect(() => decodeIdentity(b)).toThrow(/DS5O/);
  });

  it("maps an unknown result code to failed rather than ok", () => {
    const b = sample();
    b[11] = 99;
    expect(decodeIdentity(b).lastResult).toBe("failed");
  });
});

describe("player indicator (protocol 1.2)", () => {
  it("decodes byte 25 and names the standard player patterns", async () => {
    const { decodeIdentity, playerNumber } = await import("../../src/protocol/bridgeClient");
    const b = new Uint8Array(26);
    b.set([0x44, 0x53, 0x35, 0x4f, 1, 2]);
    b[18] = 1;
    b[25] = 0x0a;
    expect(decodeIdentity(b).playerLeds).toBe(0x0a);
    expect([0x04, 0x0a, 0x15, 0x1b, 0x1f].map(playerNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(playerNumber(0)).toBeNull();
    expect(playerNumber(0x01)).toBeNull();
  });
});

describe("controller model and colorway (protocol 1.2)", () => {
  it("decodes the model and the colorway code, and names known colorways", async () => {
    const { decodeIdentity } = await import("../../src/protocol/bridgeClient");
    const { colorway } = await import("../../src/desktop/live/colorways");
    const b = new Uint8Array(29);
    b.set([0x44, 0x53, 0x35, 0x4f, 1, 2]);
    b[18] = 1;
    b[26] = 1;
    b.set([0x30, 0x32], 27); // "02"
    const id = decodeIdentity(b);
    expect([id.model, id.colorwayCode]).toEqual(["edge", "02"]);
    expect(colorway(id.colorwayCode)?.name).toBe("Cosmic Red");
    expect(colorway("Z2")?.name).toBe("Marvel's Spider-Man 2");
    expect(colorway("QQ")).toBeNull();
    b.set([0, 0], 27);
    expect(decodeIdentity(b).colorwayCode).toBeNull();
  });
});

describe("CPU report (0xFC) and its timings (protocol 1.11)", () => {
  // The 11 bytes every firmware sends: 320 MHz set, 319.9 MHz measured, vreg 13, temp raw 844.
  function cpuBytes(length: number): Uint8Array {
    const b = new Uint8Array(length);
    const v = new DataView(b.buffer);
    v.setUint32(0, 320000, true);
    v.setUint32(4, 319900, true);
    b[8] = 13;
    v.setUint16(9, 844, true);
    return b;
  }
  function withTimings(flags = 1, stages: [number, number][] = TIMING_STAGES.map((_, i) => [1000 * (i + 1), 10 * (i + 1)]), since = 125): Uint8Array {
    const b = cpuBytes(63);
    const v = new DataView(b.buffer);
    b[11] = flags;
    b[12] = stages.length;
    v.setUint16(13, since, true);
    stages.forEach(([avg, max], i) => {
      v.setUint32(15 + 6 * i, avg, true);
      v.setUint16(19 + 6 * i, max, true);
    });
    return b;
  }

  it("reads the old 11-byte reply with no timings", () => {
    const c = decodeCpu(cpuBytes(11));
    expect(c).toEqual({ setKhz: 320000, measuredKhz: 319900, vregCode: 13, tempRaw: 844, timings: null });
  });

  it("refuses a reply shorter than 11 bytes", () => {
    expect(() => decodeCpu(cpuBytes(11).subarray(0, 10))).toThrow(/Short report/);
  });

  it("reads all eight stages of the full 63-byte reply", () => {
    const c = decodeCpu(withTimings());
    expect(c.tempRaw).toBe(844);
    expect(c.timings?.timerFallback).toBe(false);
    expect(c.timings?.sinceResetSeconds).toBe(125);
    expect(c.timings?.stages).toHaveLength(8);
    expect(c.timings?.stages[0]).toEqual({ avgNs: 1000, maxUs: 10 });
    expect(c.timings?.stages[6]).toEqual({ avgNs: 7000, maxUs: 70 });
    expect(c.timings?.stages[7]).toEqual({ avgNs: 8000, maxUs: 80 });
  });

  it("reads the microsecond-timer fallback flag (bit 7 of the layout byte)", () => {
    const c = decodeCpu(withTimings(0x81));
    expect(c.timings?.timerFallback).toBe(true);
    expect(c.timings?.stages).toHaveLength(8);
  });

  it("keeps saturated values as the firmware sends them", () => {
    const c = decodeCpu(withTimings(1, [[0xffffffff, TIMING_MAX_SATURATED], ...TIMING_STAGES.slice(1).map((): [number, number] => [1, 1])], 0xffff));
    expect(c.timings?.sinceResetSeconds).toBe(65535);
    expect(c.timings?.stages[0]).toEqual({ avgNs: 4294967295, maxUs: 65535 });
  });

  it("reads all-zero stages (nothing since the reset) and a zero stage count", () => {
    const zero = decodeCpu(
      withTimings(
        1,
        TIMING_STAGES.map(() => [0, 0]),
        0,
      ),
    );
    expect(zero.timings?.stages.every((s) => s.avgNs === 0 && s.maxUs === 0)).toBe(true);
    expect(zero.timings?.sinceResetSeconds).toBe(0);
    const none = decodeCpu(withTimings(1, []));
    expect(none.timings?.stages).toEqual([]);
  });

  it("ignores an unknown layout version and never reads past the reply", () => {
    expect(decodeCpu(withTimings(2)).timings).toBeNull();
    const short = withTimings().subarray(0, 15 + 6 * 3); // claims 8 stages, carries 3
    expect(decodeCpu(short).timings?.stages).toHaveLength(3);
  });
});

describe("0xF5 audio counters and core1 health", () => {
  // The 15 u32 counters hold 100 + i, so a shifted offset shows.
  const counters = (len: number) => {
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    for (let i = 0; i < 15 && i * 4 + 4 <= len; i++) v.setUint32(i * 4, 100 + i, true);
    return b;
  };
  const expectCounters = (c: ReturnType<typeof decodeAudioCounters>) => AUDIO_COUNTER_NAMES.forEach((name, i) => expect(c[name]).toBe(100 + i));

  it("reads the 63-byte layout: flags at [60], free heap in KiB at [61..62]", () => {
    const b = counters(63);
    b[60] = 0x80 | 0x01 | 0x02;
    b[61] = 12;
    b[62] = 0; // 12 KiB
    const c = decodeAudioCounters(b);
    expectCounters(c);
    expect(c.core1Flags).toBe(0x03);
    expect(c.core1FreeHeap).toBe(12 * 1024);
  });

  it("reads a large free heap from both bytes", () => {
    const b = counters(63);
    b[60] = 0x81;
    b[61] = 0x2c;
    b[62] = 0x01; // 300 KiB
    expect(decodeAudioCounters(b).core1FreeHeap).toBe(300 * 1024);
  });

  it("free heap 0 = not known yet (core1 hasn't started)", () => {
    const b = counters(63);
    b[60] = 0x80;
    const c = decodeAudioCounters(b);
    expect(c.core1Flags).toBe(0);
    expect(c.core1FreeHeap).toBeUndefined();
  });

  it("0.9.4 to 0.9.5-dev.5: the 68-byte reply cut to 63 reads as before (no health fields)", () => {
    const b = counters(63);
    b[60] = 0x03; // the old u32 flags' low byte, no layout bit
    const c = decodeAudioCounters(b);
    expectCounters(c);
    expect(c.core1Flags).toBeUndefined();
    expect(c.core1FreeHeap).toBeUndefined();
  });

  it("before 0.9.4: 60 bytes, the counters only", () => {
    const c = decodeAudioCounters(counters(60));
    expectCounters(c);
    expect(c.core1Flags).toBeUndefined();
  });

  it("refuses a reply shorter than the counters", () => {
    expect(() => decodeAudioCounters(counters(59))).toThrow(/Short report/);
  });
});
