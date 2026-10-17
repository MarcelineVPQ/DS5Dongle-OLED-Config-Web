// The Pico 2 W page's Signal graph (DiagnosticsBody): the RSSI is dB from the
// ideal range, so 0 is "Excellent", and no reading (null: no link, none yet,
// a failed read, firmware's -128) shows "—" with no word and a gap in the
// line, never 0.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { DiagnosticsBody, type Telemetry } from "../../src/desktop/dongle/DongleDashboard";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

type Sample = NonNullable<Telemetry["sample"]>;
const sample = (at: number, rssi: number | null): Sample => ({
  at,
  tempC: 30,
  setMhz: 150,
  realMhz: 150,
  vcore: 1.1,
  uptime: at,
  usbFps: 0,
  btPps: 0,
  micFps: 0,
  rated: true,
  rssi,
  peaks: [0, 0],
  hciErrors: 0,
  counters: null,
  core1Alive: true,
  oled: null,
  timings: null,
});

function signalCard(history: Sample[]): string {
  const bridge = { client: {}, identity: null } as unknown as UseDs5BridgeResult;
  const telemetry: Telemetry = { sample: history[history.length - 1], history, longHistory: history, error: null, frame: null };
  const html = renderToStaticMarkup(createElement(DiagnosticsBody, { bridge, telemetry }));
  // loop: NOT-WORTH — test only, 4 graph cards
  const card = html.split('<div class="dash-card dash-graph">').find((c) => c.includes("<h4>Signal</h4>"));
  expect(card).toBeDefined();
  return card!;
}

describe("the Signal graph", () => {
  it("shows 0 dB as Excellent", () => {
    const card = signalCard([sample(1, -8), sample(2, 0)]);
    expect(card).toContain("0<span>dB</span><em>Excellent</em>");
    expect(card.match(/<polyline/g)).toHaveLength(1);
  });

  it("shows no reading as — without a word, and breaks the line there", () => {
    const card = signalCard([sample(1, -8), sample(2, -9), sample(3, null), sample(4, -10), sample(5, -12), sample(6, null)]);
    expect(card).toContain("—<span>dB</span>");
    expect(card).not.toContain("<em>");
    expect(card.match(/<polyline/g)).toHaveLength(2);
  });
});
