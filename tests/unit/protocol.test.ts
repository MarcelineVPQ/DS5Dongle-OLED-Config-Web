import { describe, expect, it } from "vitest";
import { decodeIdentity } from "../../src/protocol/bridgeClient";
import { CONFIG_BODY_SIZE, DEFAULT_CONFIG, decodeConfigBody, encodeConfigBody, normalizeConfig, validateConfig } from "../../src/protocol/config";
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
    });
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
