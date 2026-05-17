// Thin TypeScript-friendly re-export wrapper around piersfinlayson/picoflash.
// The .js modules in ./picoflash/ are vendored verbatim under their original
// MIT license — see ./picoflash/LICENSE. We only re-export the surface area
// our Flasher component actually uses.

// @ts-expect-error — vendored JS module, no .d.ts file
import { Picoboot } from "./picoflash/picoboot.js";
// @ts-expect-error — vendored JS module, no .d.ts file
import { uf2ToFlashBuffer } from "./picoflash/uf2.js";

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

export function parseUf2(buffer: ArrayBuffer): { address: number; data: Uint8Array } {
  const u8 = new Uint8Array(buffer);
  return uf2ToFlashBuffer(u8) as { address: number; data: Uint8Array };
}
