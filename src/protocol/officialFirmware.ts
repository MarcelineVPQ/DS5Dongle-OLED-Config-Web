// Sony's official DualSense / DualSense Edge firmware: is the connected
// controller up to date? Check only: the app never downloads or installs
// Sony firmware, it points to Sony's own updater.
//
// Source of truth: https://fwupdater.dl.playstation.net/fwupdater/info.json,
// the feed Sony's PlayStation Accessories app (formerly "Firmware updater for
// DualSense wireless controller") reads. As of 2026-10 it returns
//   { "ApplicationLatestVersion": "2.2.1.2",
//     "FwUpdate0004LatestVersion": "0x0630", "FwUpdate000BLatestVersion": "0x0630",
//     "FwUpdate000ELatestVersion": "0x0641", "FwUpdate0044LatestVersion": "0x0217" }
// One key per firmware line ("update target"). The value is the same 16-bit
// number the controller reports as its update version (feature report 0x20,
// bytes 44-45; 0x0630 shows as "6.30"); Sony's images carry the line and the
// version in their headers next to each other, which is how the lines below
// were identified: 0004, 000B and 000E are DualSense hardware lines, 0044 is
// the Edge.
import { z } from "zod";

export const OFFICIAL_FIRMWARE_URL = "https://fwupdater.dl.playstation.net/fwupdater/info.json";

// Which lines belong to which model. A key not listed here is ignored.
export const FIRMWARE_LINES = { dualsense: ["0004", "000B", "000E"], edge: ["0044"] } as const;

// The dongle doesn't pass on the part of report 0x20 that might name the line,
// so the line is narrowed down by version: a controller can't be on a line
// whose first published version is newer than its own. 000E (the newer SoC)
// started at 0x0633; Sony never published 0x0630 or below for it.
const LINE_FLOOR: Record<string, number> = { "000E": 0x0633 };

const VERSION = /^0x[0-9A-Fa-f]{4}$/;
const KEY = /^FwUpdate([0-9A-Fa-f]{4})LatestVersion$/;

// Lenient about extra keys (Sony adds lines), strict about the values we use.
export const OfficialInfoSchema = z.record(z.string().max(64), z.unknown()).refine((o) => Object.keys(o).length <= 64);

// The latest version per line, e.g. { "0004": 0x0630, "0044": 0x0217 }.
export type OfficialFirmware = Record<string, number>;

export function parseOfficialInfo(raw: unknown): OfficialFirmware | null {
  // error: SHOWN — desktop.ctrlInfo.officialUnavailable (null makes the lookup "unavailable", said after Refresh)
  const parsed = OfficialInfoSchema.safeParse(raw);
  if (!parsed.success || Array.isArray(raw)) return null;
  const out: OfficialFirmware = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    const line = KEY.exec(key)?.[1]?.toUpperCase();
    if (!line) continue;
    if (typeof value !== "string" || !VERSION.test(value)) return null; // a line we can't read: trust none of it
    out[line] = parseInt(value.slice(2), 16);
  }
  const known = [...FIRMWARE_LINES.dualsense, ...FIRMWARE_LINES.edge];
  return known.some((line) => line in out) ? out : null;
}

// The controller's own update version is "major.minor" in hex digits (0x0630
// = 6.30); anything that isn't (blank, erased flash) can't be compared.
export function isComparableVersion(v: number): boolean {
  if (!Number.isInteger(v) || v <= 0 || v > 0xffff) return false;
  return (v & 0xff) <= 0x99 && (v & 0x0f) <= 9 && v >> 8 > 0;
}

export type OfficialStatus = { status: "current" } | { status: "newer"; version: number };

// Up to date, or which newer version Sony publishes; null when it can't be
// told for sure (unknown format, a version newer than anything listed, or
// lines that disagree), so the card shows nothing rather than a guess.
export function compareOfficial(current: number, edge: boolean, official: OfficialFirmware): OfficialStatus | null {
  if (!isComparableVersion(current)) return null;
  // loop: HOT-PATH-OK — N ≤ 3 firmware lines
  const candidates = FIRMWARE_LINES[edge ? "edge" : "dualsense"].filter((line) => line in official && current >= (LINE_FLOOR[line] ?? 0) && official[line] >= current).map((line) => official[line]);
  if (candidates.length === 0) return null;
  // loop: HOT-PATH-OK — N ≤ 3 firmware lines
  if (candidates.every((v) => v === current)) return { status: "current" };
  // loop: HOT-PATH-OK — N ≤ 3 firmware lines
  if (candidates.every((v) => v === candidates[0])) return { status: "newer", version: candidates[0] };
  return null;
}
