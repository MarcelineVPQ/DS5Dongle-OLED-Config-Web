// Thin TypeScript-friendly re-export wrapper around piersfinlayson/picoflash.
// The .js modules in ./picoflash/ are vendored verbatim under their original
// MIT license — see ./picoflash/LICENSE. We only re-export the surface area
// our Flasher component actually uses.
//
// Note: we deliberately do NOT use picoflash's uf2ToFlashBuffer helper —
// it builds one contiguous buffer from minAddr to maxAddr, which for our
// RP2350 UF2 (firmware at 0x10000000 + a 256-byte partition table at
// 0x10ffff00) produces a 16 MB mostly-empty buffer. parseUf2Regions() below
// returns each contiguous region separately, which we flash one at a time,
// and leaves out blocks that aren't firmware (that partition-table block).

// @ts-expect-error — vendored JS module, no .d.ts file
import { Picoboot } from "./picoflash/picoboot.js";

export interface PicoflashUsbInfo {
  vendorId: number;
  productId: number;
  serialNumber: string;
  productName?: string;
  manufacturerName?: string;
}

export interface PicoflashHandle {
  getTarget(): { toString(): string };
  getUsbDeviceInfo(): PicoflashUsbInfo;
  isConnected(): boolean;
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  flashErase(addr: number, size: number): Promise<void>;
  flashEraseAndWrite(addr: number, buf: Uint8Array): Promise<void>;
  rebootRp2350(flags: number, p0: number, p1: number, delayMs: number): Promise<void>;
  // Reads before anything is written (boardRead.ts). flashRead works on any
  // address (ROM too); getSystemInfo and otpRead need connect() first.
  flashRead(addr: number, size: number): Promise<Uint8Array>;
  getSystemInfo(flags: number): Promise<Uint8Array>;
  otpRead(row: number, count: number, ecc: boolean): Promise<Uint8Array>;
}

export interface PicoflashStatic {
  requestDevice(): Promise<PicoflashHandle>;
  // Already-permitted PICOBOOT devices (desktop: granted by the main process).
  getDevices(): Promise<PicoflashHandle[]>;
}

export const PicoflashAPI: PicoflashStatic = Picoboot as unknown as PicoflashStatic;

export interface Uf2Region {
  address: number;
  data: Uint8Array;
}

const UF2_MAGIC_START = 0x0a324655;
const UF2_MAGIC_START2 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const UF2_FLAG_NOT_MAIN_FLASH = 0x1;
const UF2_FLAG_FAMILY_ID = 0x2000;
// The RP2350's "absolute" family: SDK UF2s start with one such block at
// 0x10ffff00 (the RP2350-E10 drag-and-drop workaround). It isn't firmware:
// the bootloader and picotool skip it. Written over PICOBOOT it erased the
// sector at 0x10fff000, past a 4 MB chip's end (wrapping onto its last sector).
export const UF2_FAMILY_ABSOLUTE = 0xe48bff57;
// The RP2350's firmware families (Arm Secure, RISC-V, Arm Non-secure). Any
// other family is firmware for a different chip (an RP2040 UF2 for a Pico 1,
// say): the boot ROM would not start it, so it's refused before anything is
// written.
export const UF2_FAMILY_RP2350_ARM_S = 0xe48bff59;
const RP2350_FAMILIES = new Set([UF2_FAMILY_RP2350_ARM_S, 0xe48bff5a, 0xe48bff5b]);

// A file that isn't RP2350 firmware (bad magic, another chip's family, blocks
// missing): refused before the board is touched.
export class Uf2FileError extends Error {}

/**
 * Parse a UF2 file into the set of contiguous flash regions it specifies.
 * Each region is `{ address, data }` and can be flashed independently with
 * `Picoboot.flashEraseAndWrite(region.address, region.data)`.
 */
export function parseUf2Regions(buffer: ArrayBuffer): Uf2Region[] {
  const u8 = new Uint8Array(buffer);
  if (u8.length === 0 || u8.length % 512 !== 0) {
    throw new Uf2FileError(`UF2 size ${u8.length} is not a multiple of 512 bytes`);
  }

  interface Block {
    address: number;
    payload: Uint8Array;
  }
  const blocks: Block[] = [];
  // Per family: the block numbers seen and the count the blocks claim (each
  // block says how many the file has; a cut-off download has fewer).
  const counts = new Map<number, { seen: Set<number>; total: number }>();
  // loop: NOT-WORTH — once per firmware install: one pass over the file's 512-byte blocks
  for (let offset = 0; offset < u8.length; offset += 512) {
    const view = new DataView(u8.buffer, u8.byteOffset + offset, 512);
    if (view.getUint32(0, true) !== UF2_MAGIC_START || view.getUint32(4, true) !== UF2_MAGIC_START2 || view.getUint32(508, true) !== UF2_MAGIC_END) {
      throw new Uf2FileError(`Invalid UF2 magic at offset ${offset}`);
    }
    const flags = view.getUint32(8, true);
    const family = flags & UF2_FLAG_FAMILY_ID ? view.getUint32(28, true) : null;
    if (family === UF2_FAMILY_ABSOLUTE) continue;
    if (family !== null && !RP2350_FAMILIES.has(family)) throw new Uf2FileError(`UF2 family 0x${family.toString(16)} is not an RP2350 one`);
    const blockNo = view.getUint32(20, true);
    const total = view.getUint32(24, true);
    const count = counts.get(family ?? 0) ?? { seen: new Set<number>(), total };
    counts.set(family ?? 0, count);
    if (total !== count.total || blockNo >= total || count.seen.has(blockNo)) throw new Uf2FileError(`UF2 block ${blockNo} of ${total} doesn't fit the file`);
    count.seen.add(blockNo);
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) continue;
    const address = view.getUint32(12, true);
    const payloadSize = view.getUint32(16, true);
    const payload = new Uint8Array(u8.buffer, u8.byteOffset + offset + 32, payloadSize);
    blocks.push({ address, payload });
  }

  // loop: NOT-WORTH — once per firmware install; N = the file's families (one or two)
  for (const { seen, total } of counts.values()) if (seen.size !== total) throw new Uf2FileError(`The UF2 has ${seen.size} of its ${total} blocks`);
  if (blocks.length === 0) throw new Uf2FileError("The UF2 has no blocks to write to flash");
  blocks.sort((a, b) => a.address - b.address);

  // Walk sorted blocks, grouping contiguous runs.
  type Plan = { start: number; end: number; idxs: number[] };
  const plans: Plan[] = [];
  let cur: Plan | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (cur && b.address === cur.end) {
      cur.end += b.payload.length;
      cur.idxs.push(i);
    } else {
      if (cur) plans.push(cur);
      cur = { start: b.address, end: b.address + b.payload.length, idxs: [i] };
    }
  }
  if (cur) plans.push(cur);

  return plans.map(({ start, end, idxs }) => {
    const data = new Uint8Array(end - start);
    // loop: NOT-WORTH — UF2 blocks copied once per firmware install, linear overall
    for (const idx of idxs) {
      const block = blocks[idx];
      data.set(block.payload, block.address - start);
    }
    return alignRegionToSector({ address: start, data });
  });
}

const FLASH_SECTOR_SIZE = 0x1000; // RP2040 + RP2350

/**
 * Align a region to flash-sector boundaries so picoflash's flashEraseAndWrite
 * accepts it. A region that starts or ends off a sector boundary gets
 * pre-padded with 0xFF (the
 * erased-flash value) at the start, post-pad to the next sector boundary
 * at the end. The flash sectors we overwrite that aren't covered by the
 * payload are effectively erased — correct behavior for a fresh-flash UF2.
 */
function alignRegionToSector({ address, data }: Uf2Region): Uf2Region {
  const alignedStart = address & ~(FLASH_SECTOR_SIZE - 1);
  const startPad = address - alignedStart;
  const totalLen = startPad + data.byteLength;
  const alignedTotal = Math.ceil(totalLen / FLASH_SECTOR_SIZE) * FLASH_SECTOR_SIZE;

  if (startPad === 0 && data.byteLength === alignedTotal) {
    return { address, data };
  }
  const padded = new Uint8Array(alignedTotal);
  padded.fill(0xff);
  padded.set(data, startPad);
  return { address: alignedStart, data: padded };
}
