// The controller's power where the app shows it: the battery tile (a bolt
// while charging, a plug on a cable that isn't charging, its label saying
// which), fed by chargeState(); Controller info's Power says only a charge
// fault (each fact once on the page). The owner's case: a USB cable in, 80%,
// the controller reporting state 2 ("full").
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

  it("labels the tile Charging / Plugged in / Fully charged / Battery (state 2 at 80% is plugged in, at 100% full)", () => {
    expect(tile(chargeState(1, 80, true))).toContain(">Charging<");
    expect(tile(chargeState(2, 80, true))).toContain(">Plugged in<");
    expect(tile(chargeState(2, 80, true))).toContain('class="plug"');
    expect(tile(chargeState(2, 100, true))).toContain(">Fully charged<");
    expect(tile(chargeState(0, 80, false))).toContain(">Battery<");
  });

  it("the Signal tile carries the dB; the Player tile names the player indicator, not the pairing slot", () => {
    const strip = (rssi: number | null) =>
      renderToStaticMarkup(createElement(LiveStrip, { id: identity, power: null, playerWiring: "individual", rssi, lightbarMode: null, lightbar: null, onLightbar: () => undefined }));
    expect(strip(-5)).toContain("Signal · -5 dB");
    expect(strip(0)).toContain(`Signal · ${i18n.t("desktop.liveData.inRange")}`);
    expect(strip(-5)).toContain(">Player indicator<");
    expect(strip(-5)).not.toContain(i18n.t("desktop.overview.slot"));
  });
});

describe("Controller info's Power", () => {
  const bridge = { client: {}, identity } as unknown as UseDs5BridgeResult;
  // The block's body with the page's read (nothing read yet in a static render).
  function Info({ power }: { power: ReturnType<typeof chargeState> }) {
    return createElement(ControllerInfo, { data: useControllerInfo(bridge), power });
  }
  const card = (power: ReturnType<typeof chargeState>) => renderToStaticMarkup(createElement(Info, { power }));
  it("leaves the level and charging to the tile; says a charge fault", () => {
    expect(card(chargeState(2, 80, true))).toContain(i18n.t("desktop.ctrlInfo.power"));
    expect(card(chargeState(2, 80, true))).not.toContain("Plugged in");
    expect(card(chargeState(1, 80, true))).not.toContain(">Charging<");
    expect(card("voltageError")).toContain(i18n.t("desktop.ctrlInfo.chargeState.voltageError"));
    expect(card(chargeState(2, 80, true))).not.toContain("80%");
  });
});
