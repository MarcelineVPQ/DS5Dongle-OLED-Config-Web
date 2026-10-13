import i18n, { setDeviceBoard } from "../i18n";
import type { BridgeIdentity } from "../protocol/bridgeClient";
import { readPref, writePref } from "./storage";

// What the app calls the connected hardware, everywhere: the board the
// firmware reports ("Pico 2 W", "Pico W", or whatever a future build names),
// else the last board that identified itself, else "your board". Strings get
// it through the {{device…}} variables (src/i18n/deviceForms.ts), which
// trackBoard() keeps current; nothing passes the name by hand.

// The last board that identified itself. null = never connected.
const LAST_BOARD_KEY = "ds5.lastBoard";
export const lastBoardName = (): string | null => readPref(LAST_BOARD_KEY);

/** The board's name as strings use it: connected, else last known, else null. */
export const boardName = (identity: BridgeIdentity | null | undefined): string | null => identity?.boardName ?? lastBoardName();

/** The name for headings and labels ("Pico 2 W", or "Your board" translated). */
export const hardwareName = (identity: BridgeIdentity | null | undefined): string => identity?.boardName ?? deviceText("{{deviceName}}");

/** Called whenever the bridge identity changes: remembers the board and renames it in every string. */
export function trackBoard(identity: BridgeIdentity | null | undefined): void {
  const name = identity?.boardName;
  if (name && name !== lastBoardName()) writePref(LAST_BOARD_KEY, name);
  setDeviceBoard(boardName(identity));
}

/** Fills the {{device…}} variables in text that isn't a locale string (the Guide, Coming soon). */
export const deviceText = (text: string): string => i18n.services.interpolator.interpolate(text, {}, i18n.resolvedLanguage ?? "en", {});

// Before the first identity: the last board, if any.
setDeviceBoard(lastBoardName());
