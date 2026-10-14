// Parts of the controller you can select in the live view. The ids match the
// data-part attributes in src/assets/dualsense.svg and
// src/assets/dualsense-edge.svg, plus "body" (the grips: haptics) which is any
// click on the controller's shell.

export const PART_IDS = [
  "l1",
  "l2",
  "r1",
  "r2",
  "lightbar",
  "touchpad",
  "create",
  "options",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "triangle",
  "circle",
  "cross",
  "square",
  "stick-l",
  "stick-r",
  "ps",
  "mute",
  "speaker",
  // DualSense Edge only: the Fn buttons under the sticks and the back paddles.
  "fn-l",
  "fn-r",
  "paddle-l",
  "paddle-r",
] as const;

export type PartId = (typeof PART_IDS)[number] | "body";

// The Edge's own parts (only its drawing has them). Not remappable yet: their
// panel says what they are (PartPanel).
export const EDGE_PARTS: ReadonlySet<PartId> = new Set<PartId>(["fn-l", "fn-r", "paddle-l", "paddle-r"]);

// Which remap slot a part is (firmware remap table order, src/protocol/remap.ts).
// Buttons whose panel would be nothing but Remap: a click on the drawing
// opens the Buttons list at their row instead (one place for buttons).
export const REMAP_ONLY: ReadonlySet<PartId> = new Set<PartId>(["l1", "r1", "create", "options", "dpad-up", "dpad-down", "dpad-left", "dpad-right", "triangle", "circle", "cross", "square"]);
// Rows 16..19 of the Buttons list are the Edge's Fn buttons and paddles (protocol 1.9).
export const EDGE_REMAP_ROWS: readonly PartId[] = ["fn-l", "fn-r", "paddle-l", "paddle-r"];
export const partForRemapIndex = (i: number): PartId | null =>
  // loop: HOT-PATH-OK — N = 16 entries, on Buttons-list hover/focus render
  i >= 16 ? (EDGE_REMAP_ROWS[i - 16] ?? null) : ((Object.entries(REMAP_INDEX).find(([, v]) => v === i)?.[0] as PartId | undefined) ?? null);

export const REMAP_INDEX: Partial<Record<PartId, number>> = {
  l2: 0,
  l1: 1,
  create: 2,
  "dpad-up": 3,
  "dpad-left": 4,
  "dpad-down": 5,
  "dpad-right": 6,
  "stick-l": 7,
  r2: 8,
  r1: 9,
  options: 10,
  triangle: 11,
  circle: 12,
  cross: 13,
  square: 14,
  "stick-r": 15,
};
