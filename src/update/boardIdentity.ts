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

// What an offered image needs from the board in BOOTSEL (the write rule,
// desktop/firmwareUpdate.ts), by the board it is built for. Main offers only
// a feed entry that fitsBoard() this board type, so for pico2_w the entry's
// chip is rp2350a and its flash_min at most this. A board type missing here
// is never written.
export const IMAGE_NEEDS: Readonly<Record<string, { name: string; chip: string; flash_min: number }>> = {
  pico2_w: { name: "Pico 2 W", chip: PICO2_W_IMAGE.chip, flash_min: PICO2_W_IMAGE.flash_min },
};

// 0xEA's numbers (firmware src/fw_identity.h, display_table.h) as the feed's
// ids. A number missing here is a board, chip, persona or display this app
// doesn't know: no offer for it.
export const FW_BOARD_TYPES: Readonly<Record<number, string>> = { 1: "pico2_w", 2: "pico_w" };
export const FW_CHIPS: Readonly<Record<number, string>> = { 0: "rp2040", 1: "rp2350a", 2: "rp2350b" };
export const FW_PERSONAS: Readonly<Record<number, string>> = { 0: "ds5" };
export const FW_DISPLAYS: Readonly<Record<number, string>> = { 0: "none", 1: "pico_oled_1_3" };

// The parts of 0xEA (src/protocol/bridgeClient.ts, FirmwareIdentity) an offer needs.
export type FirmwareIdentityFacts = { boardType: number; chip: number; persona: number; flashBuiltBytes: number | null; flashMeasuredBytes: number | null };

// The identity from the board's own 0xEA report (protocol 1.21). The flash
// size is the one measured at start-up when the chip told it, else the one
// the running image was built for. null when any part is unknown here.
export function identityFromFirmware(fw: FirmwareIdentityFacts): BoardIdentity | null {
  const board = FW_BOARD_TYPES[fw.boardType];
  const chip = FW_CHIPS[fw.chip];
  const persona = FW_PERSONAS[fw.persona];
  const flashBytes = fw.flashMeasuredBytes ?? fw.flashBuiltBytes;
  if (!board || !chip || !persona || !flashBytes) return null;
  return { board, chip, flashBytes, persona };
}

// The connected board's identity for offers: from its own 0xEA report when
// the firmware has one (protocol 1.21), else from the board's name (design
// §1.1). null = unknown, nothing is offered. Only for offers: the write-time
// check in BOOTSEL is separate (design §1.2).
export function boardIdentity(id: { boardName: string | null; protoMinor: number } | null | undefined, fw?: FirmwareIdentityFacts | null): BoardIdentity | null {
  if (fw) return identityFromFirmware(fw);
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
