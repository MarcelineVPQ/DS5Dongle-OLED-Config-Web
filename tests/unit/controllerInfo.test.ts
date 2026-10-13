// Controller health & info parsers (protocol 1.12), on hand-built bytes laid
// out like the firmware's GET 0xEB replies and the controller's own reports.
import { describe, expect, it } from "vitest";
import {
  chargeState,
  ctrlInfoReport,
  decodeActiveTimeOnly,
  decodeBatteryMillivolts,
  decodeControllerFirmware,
  decodeCtrlHeader,
  decodeTelemetry,
  formatDspVersion,
  formatHex32,
  formatThreePart,
  formatUpdateVersion,
  litPlayerLights,
  playerLightWiring,
  telemetryPages,
  telemetrySupported,
} from "../../src/protocol/controllerInfo";

// A counters block: [0] status byte, then the structure (offsets below are the structure's).
function block(edge: boolean, fill = 0): { bytes: Uint8Array; d: DataView } {
  const bytes = new Uint8Array(telemetryPages(edge) * 56).fill(fill);
  return { bytes, d: new DataView(bytes.buffer, 1) };
}

function firmware(updateVersion: number): Uint8Array {
  const b = new Uint8Array(60);
  const v = new DataView(b.buffer);
  b[0] = 1;
  b.set(
    [..."Jun 13 2024"].map((c) => c.charCodeAt(0)),
    1,
  );
  b.set(
    [..."10:22:31"].map((c) => c.charCodeAt(0)),
    12,
  );
  v.setUint16(20, 3, true);
  v.setUint32(24, 0x313, true);
  v.setUint32(28, 0x01000025, true);
  v.setUint16(44, updateVersion, true);
  v.setUint32(48, 0x01020003, true);
  v.setUint32(52, 0x00340006, true);
  v.setUint32(56, 0x01000007, true);
  return b;
}

describe("GET 0xEB framing", () => {
  it("puts the selector in wValue's high byte", () => {
    expect(ctrlInfoReport(0)).toBe(0x00eb);
    expect(ctrlInfoReport(1)).toBe(0x01eb);
    expect(ctrlInfoReport(0x15)).toBe(0x15eb);
  });

  it("decodes the header", () => {
    const b = new Uint8Array([0x43, 0x48, 1, 2, 0x70, 1, 4, 9, 1, 0x03, 0x78, 0x56, 0x34, 0x12]);
    expect(decodeCtrlHeader(b)).toEqual({ state: "done", dev: 0x70, action: 1, pages: 4, request: 9, model: "edge", hasFirmware: true, btPatch: 0x12345678 });
    b[9] = 0x01; // no 0x22 cached
    b[8] = 0xff;
    expect(decodeCtrlHeader(b)).toMatchObject({ model: null, btPatch: null });
    expect(decodeCtrlHeader(b.subarray(0, 13))).toBeNull();
    expect(decodeCtrlHeader(new Uint8Array(14))).toBeNull(); // no magic
  });
});

describe("controller firmware (report 0x20)", () => {
  it("decodes and formats the versions", () => {
    const fw = decodeControllerFirmware(firmware(0x0630))!;
    expect(fw.buildDate).toBe("Jun 13 2024 10:22:31");
    expect(formatUpdateVersion(fw.updateVersion)).toBe("6.30");
    expect(formatThreePart(fw.mainFw)).toBe("1.0.37");
    expect(formatThreePart(fw.sbl)).toBe("1.2.3");
    expect(formatDspVersion(fw.dsp)).toBe("0034_0006");
    expect(formatHex32(fw.hwInfo)).toBe("0x00000313");
  });

  it("is null when the controller hasn't sent it", () => {
    const b = firmware(0x0630);
    b[0] = 0;
    expect(decodeControllerFirmware(b)).toBeNull();
    expect(decodeControllerFirmware(new Uint8Array(59))).toBeNull();
  });

  it("gates the full counters on the controller's firmware (DualSense > 1106, Edge > 374)", () => {
    expect(telemetrySupported(decodeControllerFirmware(firmware(1106))!, false)).toBe(false);
    expect(telemetrySupported(decodeControllerFirmware(firmware(1107))!, false)).toBe(true);
    expect(telemetrySupported(decodeControllerFirmware(firmware(374))!, true)).toBe(false);
    expect(telemetrySupported(decodeControllerFirmware(firmware(375))!, true)).toBe(true);
  });
});

describe("lifetime counters (test command 0x70/1)", () => {
  it("decodes a DualSense block", () => {
    const { bytes, d } = block(false);
    d.setUint32(21, 412345, true); // active time
    d.setUint32(25, 0xffffffff, true); // erased flash reads as 0
    d.setUint16(41, 212, true); // charge cycles
    d.setUint8(57, 2); // voltage errors
    d.setUint16(60, 180, true);
    d.setUint16(68, 1204, true);
    d.setUint16(70, 7, true);
    d.setUint32(86, 101000, true); // left stick X round trips
    d.setUint32(130, 0x0001_0005, true); // cross: low half when the high half is junk
    d.setUint32(182, 77, true); // PS
    d.setUint32(186, 0xffffffff, true); // mute: erased
    const t = decodeTelemetry(bytes, false)!;
    expect(t.activeTime).toBe(412345);
    expect(t.chargeTime).toBe(0);
    expect(t.chargeCycles).toBe(212);
    expect(t.chargeErrors).toEqual({ voltage: 2, temperature: 0, pmic: 0 });
    expect(t.fullCharges).toBe(180);
    expect(t.bluetoothConnects).toBe(1204);
    expect(t.bluetoothTimeouts).toBe(7);
    expect(t.sticks[0].roundTripsX).toBe(101000);
    expect(t.buttons.cross).toBe(5);
    expect(t.buttons.ps).toBe(77);
    expect(t.buttons.mute).toBe(0);
    expect(t.buttons.paddleLeft).toBeUndefined();
  });

  it("decodes an Edge block (stroke depths summed, paddles, stick modules)", () => {
    const { bytes, d } = block(true);
    d.setUint32(106, 900, true); // cross
    d.setUint32(122, 10, true);
    d.setUint32(126, 20, true);
    d.setUint32(130, 30, true); // L2 short / middle / full
    d.setUint16(176, 41, true); // left paddle (high half at 174)
    d.setUint32(199, 88000, true); // left module X round trips
    d.setUint32(211, 2400, true); // left module click
    d.setUint32(248, 0xffffffff, true); // right module click: erased
    const t = decodeTelemetry(bytes, true)!;
    expect(t.buttons.cross).toBe(900);
    expect(t.buttons.l2).toBe(60);
    expect(t.buttons.paddleLeft).toBe(41);
    expect(t.buttons.l3).toBe(2400);
    expect(t.buttons.r3).toBe(0);
    expect(t.sticks[0].roundTripsX).toBe(88000);
  });

  it("needs the whole structure", () => {
    expect(decodeTelemetry(new Uint8Array(190), false)).toBeNull();
    expect(decodeTelemetry(new Uint8Array(191), false)).not.toBeNull();
    expect(decodeTelemetry(new Uint8Array(4 * 56), true)).toBeNull();
  });

  it("reads only the play time from an older controller", () => {
    const { bytes, d } = block(false);
    d.setUint32(21, 3600, true);
    expect(decodeActiveTimeOnly(bytes)).toBe(3600);
    expect(decodeActiveTimeOnly(block(false, 0xff).bytes)).toBeNull();
  });
});

describe("battery", () => {
  it("decodes the voltage in millivolts, rejecting garbage", () => {
    expect(decodeBatteryMillivolts(new Uint8Array([0x1c, 0x0f]))).toBe(3868);
    expect(decodeBatteryMillivolts(new Uint8Array([0, 0]))).toBeNull();
    expect(decodeBatteryMillivolts(new Uint8Array([0xff, 0xff]))).toBeNull();
    expect(decodeBatteryMillivolts(new Uint8Array([1]))).toBeNull();
  });

  it("names the input report's power states", () => {
    expect([0, 1, 2, 10, 11, 15, 7].map(chargeState)).toEqual(["discharging", "charging", "full", "voltageError", "temperatureError", "chargeError", "unknown"]);
  });
});

describe("player light wiring", () => {
  it("reads the generation (hardware info bits 8..15): 0x03 individual, later boards paired", () => {
    expect(playerLightWiring(0x00000313)).toBe("individual");
    expect(playerLightWiring(0x00000300)).toBe("individual");
    expect(playerLightWiring(0x00000100)).toBe("individual");
    expect(playerLightWiring(0x00000400)).toBe("paired");
    expect(playerLightWiring(0x00000711)).toBe("paired"); // a real DualSense: 0x01 lights both outer lights
    expect(playerLightWiring(0x00010711)).toBe("paired"); // the variation byte doesn't matter
    expect(playerLightWiring(0x00010311)).toBe("individual");
  });

  it("is paired when unknown", () => {
    expect(playerLightWiring(null)).toBe("paired");
    expect(playerLightWiring(undefined)).toBe("paired");
    expect(playerLightWiring(0)).toBe("paired");
  });

  it("reads the hardware info from the firmware report", () => {
    const b = firmware(1200);
    new DataView(b.buffer).setUint32(24, 0x00000711, true);
    expect(playerLightWiring(decodeControllerFirmware(b)!.hwInfo)).toBe("paired");
  });

  it("lights each bit's own light when individual", () => {
    for (let p = 0; p < 0x20; p++) expect(litPlayerLights(p, "individual")).toBe(p);
    expect(litPlayerLights(0xff, "individual")).toBe(0x1f);
  });

  it("lights mirrored pairs when paired", () => {
    const cases: Array<[number, number]> = [
      [0x00, 0x00],
      [0x01, 0x11],
      [0x02, 0x0a],
      [0x04, 0x04],
      [0x08, 0x0a],
      [0x10, 0x11],
      [0x11, 0x11],
      [0x03, 0x1b],
      [0x0a, 0x0a],
      [0x15, 0x15],
      [0x1b, 0x1b],
      [0x1f, 0x1f],
      [0x24, 0x04], // the fade bit is not a light
    ];
    for (const [pattern, lit] of cases) expect(litPlayerLights(pattern, "paired"), pattern.toString(16)).toBe(lit);
  });

  it("draws the standard player patterns the same on both wirings", () => {
    for (const p of [0x04, 0x0a, 0x15, 0x1b, 0x1f]) expect(litPlayerLights(p, "paired")).toBe(litPlayerLights(p, "individual"));
  });
});
