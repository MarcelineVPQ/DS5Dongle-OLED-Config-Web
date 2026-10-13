import type { TFunction } from "i18next";
import type { BridgeIdentity } from "../protocol/bridgeClient";
import { readPref, writePref } from "./storage";

// What the app calls the connected hardware: the board the firmware reports
// ("Pico 2 W", "Pico W", or whatever a future build names), else the generic
// word. Used for labels and headings; running text keeps "the dongle".
export function hardwareName(identity: BridgeIdentity | null | undefined, t: TFunction): string {
  return identity?.boardName ?? t("desktop.hardware.generic");
}

// The last board that identified itself, for wording shown before the device
// does (the rail's "Waiting for the Pico 2 W…"). null = never connected.
const LAST_BOARD_KEY = "ds5.lastBoard";
export const lastBoardName = (): string | null => readPref(LAST_BOARD_KEY);
export function rememberBoard(identity: BridgeIdentity | null | undefined): void {
  const name = identity?.boardName;
  if (name && name !== lastBoardName()) writePref(LAST_BOARD_KEY, name);
}
