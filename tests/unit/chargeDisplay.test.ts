// The controller's power where the app shows it: the battery tile (a bolt
// while charging, a plug on a cable that isn't charging) and Controller info's
// Charging row, both fed by chargeState(). The owner's case: a USB cable in,
// 80%, the controller reporting state 2 ("full").
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { FEATURES3, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { chargeState } from "../../src/protocol/controllerInfo";
import ControllerInfo, { useControllerInfo } from "../../src/desktop/live/ControllerInfo";
import LiveStrip, { BatteryIcon } from "../../src/desktop/live/LiveStrip";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const identity = { protoMajor: 1, protoMinor: 12, features3: FEATURES3.controllerInfo, controllerConnected: true, battery: 80, playerLeds: 0, currentSlot: 0 } as BridgeIdentity;

function tile(power: ReturnType<typeof chargeState>): string {
  return renderToStaticMarkup(createElement(LiveStrip, { id: identity, power, playerWiring: "individual", rssi: null, lightbarMode: null, lightbar: null, onLightbar: () => undefined }));
}

describe("battery tile", () => {
  it("draws a bolt while charging, a plug on a cable that isn't, nothing on battery", () => {
    const icon = (power: ReturnType<typeof chargeState> | null) => renderToStaticMarkup(createElement(BatteryIcon, { level: 80, power }));
    expect(icon("charging")).toContain('class="bolt"');
    expect(icon("charging")).not.toContain('class="plug"');
    expect(icon("pluggedIn")).toContain('class="plug"');
    expect(icon("pluggedIn")).not.toContain('class="bolt"');
    for (const none of ["discharging", "full", null] as const) {
      expect(icon(none)).not.toContain('class="bolt"');
      expect(icon(none)).not.toContain('class="plug"');
    }
  });

  it("labels the tile Charging / Plugged in / Battery", () => {
    expect(tile(chargeState(1, 80, true))).toContain(">Charging<");
    expect(tile(chargeState(2, 80, true))).toContain(">Plugged in<");
    expect(tile(chargeState(2, 80, true))).toContain('class="plug"');
    expect(tile(chargeState(0, 80, false))).toContain(">Battery<");
  });
});

describe("Controller info's Charging row", () => {
  const bridge = { client: {}, identity } as unknown as UseDs5BridgeResult;
  // The section's body with the page's read (nothing read yet in a static render).
  function Info({ level }: { level: number }) {
    return createElement(ControllerInfo, { data: useControllerInfo(bridge), batteryPct: level, power: chargeState(2, level, true) });
  }
  const card = (level: number) => renderToStaticMarkup(createElement(Info, { level }));
  it("state 2 at 80% is plugged in, not charging; at 100% fully charged", () => {
    expect(card(80)).toContain("Plugged in, not charging");
    expect(card(80)).not.toContain("Fully charged");
    expect(card(100)).toContain("Fully charged");
  });
});
