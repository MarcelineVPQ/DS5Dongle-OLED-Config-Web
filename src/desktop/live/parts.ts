// Parts of the controller you can select in the live view. The ids match the
// data-part attributes in src/assets/dualsense.svg, plus "body" (the grips:
// haptics) which is any click on the controller's shell.

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
] as const;

export type PartId = (typeof PART_IDS)[number] | "body";

// Which remap slot a part is (firmware remap table order, src/protocol/remap.ts).
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
