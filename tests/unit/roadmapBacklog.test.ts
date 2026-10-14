// Gate: About → Coming soon (src/desktop/about/roadmap.ts) is the public copy
// of docs/BACKLOG.md, so every roadmap entry maps to a BACKLOG row, and its
// column matches that row's status (quality pass dev.6, F36: the shipped OLED
// Status screen was still "planned").
//
// When a roadmap entry is added or renamed, add it to BACKLOG_ROW below (the
// start of its row's Item cell). When a row changes status, move the entry's
// column in the same commit (BACKLOG.md "Keeping it current").
//
// Both ways: every row that is still to do (any status but Done / Fixed /
// Superseded) has a Coming soon entry too, unless its Item cell ends with
// "(internal)" (tooling, tests, hosting, naming, anything a user never sees).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROADMAP, type RoadmapColumn } from "../../src/desktop/about/roadmap";

/** Roadmap title → the start of its BACKLOG row's Item cell. */
const BACKLOG_ROW: Record<string, string> = {
  "Lighter on your PC": "App runs lean when hidden",
  "Our own color picker": "Our own color picker",
  "Your controller's colors": "My controller's colors",
  "Mic muted and headset indicators": "Mic muted and headset indicators",
  "Cooler, in-spec Pico 2 W": "Pico 2 W at stock 150 MHz",
  "DualSense Edge fixes": "Edge parity (",
  "Edge profiles in PlayStation Accessories": "Edge parity (",
  "DualSense V2 reconnects": "SDK 2.3 / TinyUSB 0.21",
  "Quicker OLED buttons, Fallback haptics come back": "CLF184's OLED and audio fixes",
  "Your board by its name": '"Waiting for the dongle…" and other leftovers',
  "Your board's specs": "Board page: Waveshare Pico-OLED-1.3",
  "No restart during a firmware update": "No restart or quit while firmware is being written",
  "Update checks only when you allow them": "Updates: the automatic-checks switch is kept, and firmware installs the version shown",
  "Lighter haptic feedback processing": "Haptics: upstream 16:1",
  "Sony's names for everything": "Sony's official naming",
  "More controller colors": "My controller's colors",
  "Is your controller's firmware up to date?": "Official controller firmware check",
  "Controller health and info": "Controller health & info",
  "Profiles hold every setting": "Profiles hold every setting",
  "Community game database": "Community game database",
  "Per-trigger resistance strength": "Per-trigger resistance strength",
  "Trigger Lab": "Trigger Lab",
  "Per-controller settings": "Per-controller settings",
  "Edge on-controller profiles": "Edge on-controller profiles",
  "Limited-edition looks": "Limited-edition looks",
  "A whole tune for the speaker test": "Speaker test: a whole tune",
  "Printed colorways": "Colorways with a print",
  "3D audio for the headset": "3D audio for the headset",
  "Live controller widget": "DS5 widget: a live controller view",
  "Notifications in the app": "Toast system",
  "Desktop notifications": "System notifications",
  "Share a profile": "Share a profile with a share code",
  "Thank-you wall": "Thank-you wall in About",
  "What's new": "What's new and community link",
  "Controller plugins": "Controller plugins: an API",
  "One Update button": "One Update flow",
  "The board's OLED settings in the app": "Board's OLED settings in the app",
  "OLED screens in Sony's words": "OLED screens use Sony's names",
  "Bluetooth rests when idle": "Firmware: idle Bluetooth scan stops",
  "DLSS and Reflex on NVIDIA": "Games: DLSS and Reflex",
  "PlayStation button prompts": "Games: PlayStation button prompts",
  "Gyro aiming outside Steam": "Games: gyro aiming",
  "Anti-cheat warnings": "Games: anti-cheat warnings",
  "GameMode switch": "Games: GameMode switch",
  "Proton changes": 'About → "Proton changes" tab',
  "Quicker second start on Windows": "Windows: second launch slow",
  "Lighter game check on Windows": "Windows: running-game check",
  "More controller tests": "Small test extras",
  "Diagnostics in the app": "Diagnostics report in the app",
  "Share button layouts": "Public button layouts",
  "Trigger strength and more audio settings": "Upstream settings batch",
  "Controller off when the PC sleeps": "PC sleep: controller off",
  "Microphone level": "Mic level: the controller's own microphone level",
  "Mic echo cancellation": "Mic echo cancellation: the controller's own, with a switch",
  "Faster firmware for {{device}}": "Firmware: OLED flush and Opus encoder speedups",
  "Better OLED status screen": "OLED Status screen controller drawing",
  "XInput games find the controller": "XInput-only games: set the Proton option automatically",
  "HDR for games": "Games: Turn on HDR for HDR games",
  "Play keeps the launcher in the background": "Games: Play keeps the launcher in the background",
  "Ray Tracing in more games": "Games: the right graphics mode",
  "Clearer message when {{device}} is busy": '{{device}} busy: "Unable to claim interface"',
  "Desktop accent color on Windows": 'Windows: Accent color "Desktop"',
  "Guide in every language": "Translate the Guide and changelogs",
  "A new welcome tour": "Welcome tour rebuild",
  "Other controllers": "Other controllers",
  "In-game overlay": "In-game overlay",
  "Controller switcher in the side bar": "Controller switcher in the rail",
  "Simpler layout and wording": "Streamline pass",
  "Settings that unfold in place": "Side panel as an accordion",
  "Compact layout": "Compact UI mode",
  "Play stats": "Play stats from the controller",
  "KEY0 and KEY1 in the app": "KEY0 / KEY1 buttons in the Pico console",
  "OLED boot animation": "OLED boot logo animation",
  "Overview at a glance": "Overview health at a glance",
  "Low / Medium / High presets": "Low / Medium / High presets",
  "Tips on each page": "Per-page Tips card",
  "All button assignments at a glance": "Remap overview with callouts",
  "Button combos": "Chords (button combos run actions)",
  "Stick curves in layouts": "Stick curves: custom points per game",
  "Light bar modes as favorites": "Lightbar modes as favorites",
  "Power saving with headphones": "Power saving with headphones",
  "Act as a DualShock 4 or Xbox controller": "Controller personas (DS4 / Xbox)",
  "No driver setup on Windows": "Config interface over HID, not WinUSB",
  "BOOTSEL button shortcuts": "BOOTSEL button gestures",
  "Wipe {{device}}'s flash": "Firmware: Nuke (wipe flash)",
  "Clearer pairing slot tile": "Pairing slot tile shows",
  "Brighter colors from game art": "Brighter art color on game pages",
  "Square covers in tall windows": "Square cover art for tall windows",
  "Right controls on the standard-gamepad route": "Ghostrunner on the standard-gamepad route",
  "Launchers stay open": "Launchers outlive the app",
  "Easier DualSense Proton upgrades": "DualSense Proton: a smoother way to upgrade",
  "Games on macOS": "macOS: the Games area",
  "Heroic games on Windows and macOS": "Heroic games on Windows and macOS",
  "Launcher check on every OS": '"Is the launcher installed?" check on every OS',
  "Controller buttons as keyboard keys": "Controller buttons as keyboard keys",
  "OLED mirror in HDR": "OLED mirror in HDR",
  "Whole narrator lines": "Narrator line drops pieces",
  "Speaker buffer that can't break up": "Firmware: speaker buffer minimum",
  "Launchers close cleanly": "Launchers: Heroic crashes when the app closes it",
  "Full speaker volume after a headset unplug": "Firmware: noise cancellation stays on after a headset plug or unplug",
  "Headset sound in both ears": "Headset: both ears on Linux's default sound profile",
  "Stereo when headphones go in": "Linux: stereo headset profile follows the jack",
  "Full headset mic and volume": "Linux: controller volume and mic gain restored low",
  "Headphones up to full volume": "Firmware: headphone volume reaches full",
  "Clearer highs on speaker and headset": "Firmware: speaker resampler with a filter",
  "Steady mic delay": "Firmware: mic buffer that doesn't grow",
  "Less headset delay": "Firmware: one speaker frame per report",
  "Speaker plays both channels": "Firmware: speaker plays both channels",
  "Stereo setup on Windows": "Guide: Windows controller sound set to Stereo",
  "Self-update on macOS": "macOS: self-update",
  "Desktop shortcut on Linux": 'Linux: "Create desktop shortcut"',
  "Start minimized on macOS": "macOS: start minimized at login",
  "Match desktop everywhere": '"Match desktop" theme on macOS and Windows',
  "Menu bar icon on macOS": "macOS: tray icon as a Template image",
  "No board needed (experiment)": "Dongle-free mode",
  "Lifelike controller drawing": "Realistic (PBR) controller",
};

/**
 * Known mismatches, each with the review finding and batch that fixes it.
 * The test fails when one of these starts to match (fixed: take it out).
 */
const KNOWN_MISMATCH: Record<string, string> = {};

interface Row {
  item: string;
  status: string;
  section: string;
}

const backlog = readFileSync(new URL("../../docs/BACKLOG.md", import.meta.url), "utf8");
const rows: Row[] = [];
let section = "";
for (const line of backlog.split("\n")) {
  const heading = /^### (.+)$/.exec(line);
  if (heading) section = heading[1];
  if (!section || !line.startsWith("| ") || /^\| (Item|---) /.test(line)) continue;
  const [item, status] = line
    .slice(1)
    .split(" | ")
    .map((c) => c.trim());
  rows.push({ item, status: status ?? "", section });
}

/** The roadmap column a row's status means (BACKLOG.md's status words). */
function columnOf(row: Row): RoadmapColumn {
  const word = /^\*\*([^*.(:]+)/.exec(row.status)?.[1].trim() ?? "";
  if (/^(Done|Fixed)\b/.test(word)) return "next";
  if (/^(In progress|Built)\b/.test(word)) return "progress";
  if (/^(Agreed|Planned|Backlog|Open|Question|Blocked)\b/.test(word)) return "planned";
  if (/\bidea\b/i.test(word)) return "ideas";
  // No status word (the Ideas table's notes): the section says it.
  if (row.section.startsWith("In progress")) return "progress";
  if (row.section.startsWith("Ideas")) return "ideas";
  return "planned";
}

/** "next" also covers the shipped part of a row still in progress. */
const matches = (column: RoadmapColumn, row: Row) => columnOf(row) === column || (column === "next" && /\bshipped\b/.test(row.status));

/** Still to do: not shipped (Done / Fixed) and not replaced (Superseded). */
const toDo = (row: Row) => columnOf(row) !== "next" && !/^\*\*Superseded\b/.test(row.status);
const internal = (row: Row) => /\(internal\)$/.test(row.item);

const rowFor = (title: string) => rows.filter((r) => r.item.startsWith(BACKLOG_ROW[title]));

describe("roadmap ↔ BACKLOG", () => {
  it("reads the BACKLOG tables", () => {
    expect(rows.length).toBeGreaterThan(40);
  });

  it("BACKLOG has one row per item (no duplicate rows)", () => {
    const items = rows.map((r) => r.item);
    expect(items.filter((item, i) => items.indexOf(item) !== i)).toEqual([]);
  });

  it("every roadmap entry is mapped, and every mapping is a roadmap entry", () => {
    const titles = ROADMAP.map((r) => r.title);
    expect(titles.filter((t) => !(t in BACKLOG_ROW))).toEqual([]);
    expect(Object.keys(BACKLOG_ROW).filter((t) => !titles.includes(t))).toEqual([]);
  });

  it('every user-facing row still to do has a Coming soon entry (or ends with "(internal)")', () => {
    const starts = Object.values(BACKLOG_ROW);
    const missing = rows.filter((r) => toDo(r) && !internal(r) && !starts.some((start) => r.item.startsWith(start)));
    expect(missing.map((r) => `${r.section}: ${r.item}`)).toEqual([]);
  });

  it('"(internal)" rows have no Coming soon entry', () => {
    const starts = Object.values(BACKLOG_ROW);
    expect(rows.filter((r) => internal(r) && starts.some((start) => r.item.startsWith(start))).map((r) => r.item)).toEqual([]);
  });

  for (const entry of ROADMAP) {
    it(`"${entry.title}" maps to one BACKLOG row with a matching status`, () => {
      const found = rowFor(entry.title);
      expect(found.map((r) => r.item).length, `BACKLOG row starting "${BACKLOG_ROW[entry.title]}"`).toBe(1);
      const ok = matches(entry.column, found[0]);
      if (entry.title in KNOWN_MISMATCH) expect(ok, `known mismatch now matches: take it out of KNOWN_MISMATCH`).toBe(false);
      else expect(ok, `roadmap says "${entry.column}", the row's status means "${columnOf(found[0])}"`).toBe(true);
    });
  }
});
