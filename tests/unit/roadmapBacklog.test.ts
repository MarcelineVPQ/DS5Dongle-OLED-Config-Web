// Gate: About → Coming soon (src/desktop/about/roadmap.ts) is the public copy
// of docs/BACKLOG.md, so every roadmap entry maps to a BACKLOG row, and its
// column matches that row's status (quality pass dev.6, F36: the shipped OLED
// Status screen was still "planned").
//
// When a roadmap entry is added or renamed, add it to BACKLOG_ROW below (the
// start of its row's Item cell). When a row changes status, move the entry's
// column in the same commit (BACKLOG.md "Keeping it current").
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
  "DualSense Edge fixes": "Edge parity: detection",
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
  "Louder speaker test": "Louder speaker test chime",
  "More controller tests": "Small test extras",
  "Diagnostics in the app": "Diagnostics report in the app",
  "Share button layouts": "Public button layouts",
  "Trigger strength and more audio settings": "Upstream settings batch",
  "Controller off when the PC sleeps": "PC sleep: controller off",
  "Faster dongle firmware": "Firmware: OLED flush and Opus encoder speedups",
  "Better OLED status screen": "OLED Status screen controller drawing",
  "Clearer message when the dongle is busy": 'Linux: "Unable to claim interface"',
  "Desktop accent color on Windows": 'Windows: Accent color "Desktop"',
  "Guide in every language": "Translate the Guide and changelogs",
  "A new welcome tour": "Welcome tour rebuild",
  "Other controllers": "Other controllers",
  "In-game overlay": "In-game overlay",
  "Controller switcher in the side bar": "Controller switcher in the rail",
  "Simpler layout and wording": "Streamline pass",
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
  "Wipe the dongle's flash": "Firmware: Nuke (wipe flash)",
  "Clearer pairing slot tile": "Pairing slot tile shows",
  "Brighter colors from game art": "Brighter art color on game pages",
  "Square covers in tall windows": "Square cover art for tall windows",
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

const backlog = readFileSync(new URL("../../docs/BACKLOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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
