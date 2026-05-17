// Thin TypeScript-friendly re-export wrapper around piersfinlayson/picoflash.
// The .js modules in ./picoflash/ are vendored verbatim under their original
// MIT license — see ./picoflash/LICENSE. We only re-export the surface area
// our Flasher component actually uses.
//
// Note: we deliberately do NOT use picoflash's uf2ToFlashBuffer helper —
// it builds one contiguous buffer from minAddr to maxAddr, which for our
// RP2350 UF2 (firmware at 0x10000000 + a 256-byte partition table at
// 0x10ffff00) produces a 16 MB mostly-empty buffer. The bootloader can't
// receive a 16 MB write in one bulk transfer. parseUf2Regions() below
// returns each contiguous region separately, which we flash one at a time.

// @ts-expect-error — vendored JS module, no .d.ts file
import { Picoboot } from "./picoflash/picoboot.js";

export interface PicoflashHandle {
  getTarget(): { toString(): string };
  isConnected(): boolean;
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  flashEraseAndWrite(addr: number, buf: Uint8Array): Promise<void>;
  rebootRp2350(flags: number, p0: number, p1: number, delayMs: number): Promise<void>;
}

export interface PicoflashStatic {
  requestDevice(): Promise<PicoflashHandle>;
}

export const PicoflashAPI: PicoflashStatic = Picoboot as unknown as PicoflashStatic;

export interface Uf2Region {
  address: number;
  data: Uint8Array;
}

const UF2_MAGIC_START = 0x0a324655;
const UF2_MAGIC_START2 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;

/**
 * Parse a UF2 file into the set of contiguous flash regions it specifies.
 * Each region is `{ address, data }` and can be flashed independently with
 * `Picoboot.flashEraseAndWrite(region.address, region.data)`.
 */
export function parseUf2Regions(buffer: ArrayBuffer): Uf2Region[] {
  const u8 = new Uint8Array(buffer);
  if (u8.length === 0 || u8.length % 512 !== 0) {
    throw new Error(`UF2 size ${u8.length} is not a multiple of 512 bytes`);
  }

  interface Block { address: number; payload: Uint8Array }
  const blocks: Block[] = [];
  for (let offset = 0; offset < u8.length; offset += 512) {
    const view = new DataView(u8.buffer, u8.byteOffset + offset, 512);
    if (
      view.getUint32(0, true) !== UF2_MAGIC_START ||
      view.getUint32(4, true) !== UF2_MAGIC_START2 ||
      view.getUint32(508, true) !== UF2_MAGIC_END
    ) {
      throw new Error(`Invalid UF2 magic at offset ${offset}`);
    }
    const address = view.getUint32(12, true);
    const payloadSize = view.getUint32(16, true);
    const payload = new Uint8Array(u8.buffer, u8.byteOffset + offset + 32, payloadSize);
    blocks.push({ address, payload });
  }

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
 * accepts it. Some UF2 blocks (e.g. RP2350 absolute partition table at
 * 0x10ffff00) land at non-sector-aligned addresses; pre-pad with 0xFF (the
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
