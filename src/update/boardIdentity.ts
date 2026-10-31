// Which board a firmware image is for (DESIGN_FIRMWARE_IDENTITY §1, §2): an
// image is offered only to the board it was built for, never another board's.
// The ids are the firmware repo's feed builder's (tools/manifest_lib.mjs).
import { z } from "zod";
import { isNewer, type Manifest } from "./manifest";

const Id = z.string().regex(/^[a-z0-9_]{1,32}$/);

// The connected board as far as offers go: its board type, chip, flash size
// and the controller persona it runs (DualSense = "ds5").
export const BoardIdentity = z.strictObject({ board: Id, chip: Id, flashBytes: z.number().int().positive(), persona: Id });
export type BoardIdentity = z.infer<typeof BoardIdentity>;

const MB = 1024 * 1024;
export const PICO2_W: BoardIdentity = { board: "pico2_w", chip: "rp2350a", flashBytes: 4 * MB, persona: "ds5" };
const PICO_W: BoardIdentity = { board: "pico_w", chip: "rp2040", flashBytes: 2 * MB, persona: "ds5" };

// What every image published so far (schema 1's `firmware`, and the bundled
// build until its firmware.json names a board) is built for.
export const PICO2_W_IMAGE = { board: "pico2_w", chip: "rp2350a", flash_min: 4 * MB, personas: ["ds5"], displays: ["none", "pico_oled_1_3"] };

// Firmware without its own identity report (all of it today: 0xEA comes with
// protocol 1.21): the identity from the board's name (design §1.1). null =
// unknown, nothing is offered. Only for offers: the write-time check in
// BOOTSEL is separate (design §1.2).
export function boardIdentity(id: { boardName: string | null; protoMinor: number } | null | undefined): BoardIdentity | null {
  if (!id) return null;
  if (id.boardName === "Pico 2 W") return PICO2_W;
  if (id.boardName === "Pico W") return PICO_W; // no image in the feed: "no firmware update for {{device}}"
  // No name: protocol before 1.7, when every published image was the Pico 2 W's.
  if (id.boardName === null && id.protoMinor < 7) return PICO2_W;
  return null;
}

export type FirmwareImage = NonNullable<Manifest["firmwares"]>[number];

// The feed's images: schema 2's `firmwares[]` only; a schema 1 feed's one
// `firmware` is the Pico 2 W / DualSense image (the only one ever published).
export function feedImages(m: Manifest): FirmwareImage[] {
  if ((m.schema ?? 1) >= 2) return m.firmwares ?? [];
  return m.firmware ? [{ ...m.firmware, ...PICO2_W_IMAGE }] : [];
}

// Built for this board: same board type and chip, enough flash, its persona.
export const fitsBoard = (image: Pick<FirmwareImage, "board" | "chip" | "flash_min" | "personas">, b: BoardIdentity): boolean =>
  image.board === b.board && image.chip === b.chip && image.flash_min <= b.flashBytes && image.personas.includes(b.persona);

// The newest image built for this board, or null.
export function newestFor(images: readonly FirmwareImage[], b: BoardIdentity): FirmwareImage | null {
  let best: FirmwareImage | null = null;
  // loop: NOT-WORTH — N ≤ 32 feed images, once per firmware lookup
  for (const image of images) if (fitsBoard(image, b) && (!best || isNewer(image.version, best.version))) best = image;
  return best;
}
