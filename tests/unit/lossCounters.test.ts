// Firmware re-review D5 (owner 2026-11-15): 0xFD's loss counters (firmware
// src/cmd.cpp, the bridge-diagnostics report: [50..53] u32 "BT drop", [54..61]
// four u16 "Mic i b u" and "USB ovr"), decoded with their bounds checked, read
// only from protocol 1.22 (firmware 0.9.5-dev.21, the first release with
// them), and shown in the Pico 2 W page's Diagnostics under the OLED's labels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { BRIDGE_DIAG_BYTES, decodeLossCounters, Ds5BridgeClient, REPORT, type LossCounters } from "../../src/protocol/bridgeClient";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { DiagnosticsBody, type Telemetry } from "../../src/desktop/dongle/DongleDashboard";
import { FakeDongle } from "../support/fakeDongle";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

// A 62-byte 0xFD answer as firmware 0.9.5-dev.21 builds it, little-endian.
function report(): Uint8Array {
  const out = new Uint8Array(BRIDGE_DIAG_BYTES);
  out.fill(0xee, 0, 50); // sections 1-3: not read here
  out.set([0x04, 0x03, 0x02, 0x01], 50); // BT drop 0x01020304
  out.set([0x01, 0x00], 54); // Mic i 1
  out.set([0x02, 0x01], 56); // Mic b 258
  out.set([0xff, 0xff], 58); // Mic u 65535
  out.set([0x00, 0x80], 60); // USB ovr 32768
  return out;
}

describe("0xFD loss counters", () => {
  it("decodes [50..61] at the firmware's offsets", () => {
    expect(BRIDGE_DIAG_BYTES).toBe(62);
    expect(REPORT.bridgeDiag).toBe(0xfd);
    expect(decodeLossCounters(report())).toEqual({ btSendDrops: 0x01020304, inside: { micInDrops: 1, micBufDrops: 258, micUnderruns: 65535, usbOutOverruns: 32768 } });
  });

  it("checks its bounds: an older answer gives nothing rather than zeros", () => {
    // 0.9.5-dev.20 and older answer 50 bytes (44 before the mic buffer's section).
    expect(decodeLossCounters(report().subarray(0, 50))).toBeNull();
    expect(decodeLossCounters(report().subarray(0, 44))).toBeNull();
    expect(decodeLossCounters(new Uint8Array(0))).toBeNull();
    // Section 4 alone (a 54-byte answer): BT drop, no Mic / USB counters.
    expect(decodeLossCounters(report().subarray(0, 54))).toEqual({ btSendDrops: 0x01020304, inside: null });
    expect(decodeLossCounters(report().subarray(0, 61))?.inside).toBeNull();
  });

  it("reads them only from protocol 1.22", async () => {
    const old = new FakeDongle({ protoMinor: 21 });
    const asked: number[] = [];
    const getReport = old.getReport.bind(old);
    old.getReport = async (id: number, length: number) => {
      asked.push(id);
      return getReport(id, length);
    };
    const oldClient = new Ds5BridgeClient(old);
    await oldClient.identity();
    expect(await oldClient.readLossCounters()).toBeNull();
    expect(asked).not.toContain(0xfd);

    const dongle = new FakeDongle({ lossCounters: { btSendDrops: 7, micInDrops: 1, micBufDrops: 2, micUnderruns: 70000, usbOutOverruns: 4 } });
    const client = new Ds5BridgeClient(dongle);
    await client.identity();
    // The u16 counters come as their low 16 bits, as the firmware sends them (70000 - 65536).
    expect(await client.readLossCounters()).toEqual({ btSendDrops: 7, inside: { micInDrops: 1, micBufDrops: 2, micUnderruns: 4464, usbOutOverruns: 4 } });
  });
});

type Sample = NonNullable<Telemetry["sample"]>;
const sample = (lost: LossCounters | null): Sample => ({
  at: 1,
  tempC: 30,
  setMhz: 150,
  realMhz: 150,
  vcore: 1.1,
  uptime: 1,
  usbFps: 0,
  btPps: 0,
  micFps: 0,
  rated: true,
  rssi: null,
  peaks: [0, 0],
  hciErrors: 0,
  counters: null,
  lost,
  core1Alive: true,
  oled: null,
  timings: null,
});

function diagnostics(lost: LossCounters | null): string {
  const bridge = { client: {}, identity: null } as unknown as UseDs5BridgeResult;
  const s = sample(lost);
  const telemetry: Telemetry = { sample: s, history: [s], longHistory: [s], error: null, frame: null };
  return renderToStaticMarkup(createElement(DiagnosticsBody, { bridge, telemetry }));
}

describe("Diagnostics: Lost on the way", () => {
  it("shows each counter under the OLED's own label, the overrun count as a lower bound", () => {
    const html = diagnostics({ btSendDrops: 0, inside: { micInDrops: 0, micBufDrops: 3, micUnderruns: 120, usbOutOverruns: 0 } });
    expect(html).toContain("Lost on the way");
    // loop: NOT-WORTH — test only, 5 labels
    for (const label of ["(BT drop)", "(Mic i)", "(Mic b)", "(Mic u)", "(USB ovr)"]) expect(html).toContain(label);
    expect(html).toContain("PC speaker audio overruns, at least (USB ovr)");
    expect(html).toContain("A lower bound, not an exact count");
    // The u16 counters' ⓘ says they wrap; BT drop (a u32) doesn't.
    expect(html.match(/Counts up to 65,535, then starts again at 0\./g)).toHaveLength(4);
    // A count above 0 is marked, 0 isn't.
    expect(html).toContain('<b title="120">⚠ 120</b>');
    expect(html).toContain('<b title="0">0</b>');
  });

  it("shows only BT drop when the answer stops before [54..61]", () => {
    const html = diagnostics({ btSendDrops: 5, inside: null });
    expect(html).toContain("(BT drop)");
    expect(html).not.toContain("(Mic u)");
    expect(html).not.toContain("(USB ovr)");
  });

  it("shows nothing on firmware without the counters, never zeros", () => {
    expect(diagnostics(null)).not.toContain("Lost on the way");
  });
});
