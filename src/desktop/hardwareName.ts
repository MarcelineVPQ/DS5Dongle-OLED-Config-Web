import type { TFunction } from "i18next";
import type { BridgeIdentity } from "../protocol/bridgeClient";

// What the app calls the connected hardware: the board the firmware reports
// ("Pico 2 W", "Pico W", or whatever a future build names), else the generic
// word. Used for labels and headings; running text keeps "the dongle".
export function hardwareName(identity: BridgeIdentity | null | undefined, t: TFunction): string {
  return identity?.boardName ?? t("desktop.hardware.generic");
}
