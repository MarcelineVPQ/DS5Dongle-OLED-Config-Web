// One-click firmware update, no drive mounting and no unplugging:
//   1. the main process downloads the UF2 and verifies size + SHA-256;
//   2. the dongle reboots into BOOTSEL on command (0xF6 0x08);
//   3. the RP2350 boot device is flashed over PICOBOOT (WebUSB, the same
//      vendored flasher as the web tool) and rebooted;
//   4. the app reconnects on its own and the caller confirms the version.
// A new (or non-dongle) Pico plugged in with BOOTSEL held skips step 2:
// installFirmware() flashes it directly (first-run setup).
import type { Ds5BridgeClient } from "../protocol/bridgeClient";
import { PicoflashAPI, parseUf2Regions, type PicoflashHandle } from "../flash";

export type FirmwareStep = "downloading" | "rebooting" | "waiting-bootloader" | "flashing" | "restarting";

export interface FirmwareProgress {
  step: FirmwareStep;
  fraction?: number; // 0..1 while flashing
}

const BOOTLOADER_TIMEOUT_MS = 20_000;
const REBOOT_DELAY_MS = 500;

export async function updateFirmware(client: Ds5BridgeClient, onProgress: (p: FirmwareProgress) => void): Promise<string> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("Firmware updates need the desktop app.");

  onProgress({ step: "downloading" });
  const { version, bytes } = await desktop.downloadFirmware();
  // Parse before touching the device: a malformed file must fail here, while
  // the dongle is still running its current firmware.
  const regions = parseUf2Regions(bytes.slice().buffer);

  onProgress({ step: "rebooting" });
  await client.enterBootsel();

  onProgress({ step: "waiting-bootloader" });
  const device = await waitForBootloader();

  await flash(device, regions, onProgress);
  return version;
}

// First-run setup: a Pico already in BOOTSEL mode gets the app's firmware.
export async function installFirmware(device: PicoflashHandle, onProgress: (p: FirmwareProgress) => void): Promise<string> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("Installing firmware needs the desktop app.");
  onProgress({ step: "downloading" });
  const { version, bytes } = await desktop.downloadFirmware();
  const regions = parseUf2Regions(bytes.slice().buffer);
  await flash(device, regions, onProgress);
  return version;
}

// A Pico in BOOTSEL mode (PICOBOOT), if one is plugged in.
export async function findBootloader(): Promise<PicoflashHandle | null> {
  return (await PicoflashAPI.getDevices())[0] ?? null;
}

const FLASH_CHUNK = 0x10000; // 64 KB: 16 flash sectors

export async function flash(device: PicoflashHandle, regions: ReturnType<typeof parseUf2Regions>, onProgress: (p: FirmwareProgress) => void): Promise<void> {
  onProgress({ step: "flashing", fraction: 0 });
  const total = regions.reduce((n, r) => n + r.data.byteLength, 0);
  let done = 0;
  await device.connect();
  // In pieces, so the progress moves (the firmware is usually one region).
  // Regions are whole flash sectors (alignRegionToSector), and a piece is a
  // whole number of sectors, so every write stays sector-aligned.
  for (const region of regions) {
    for (let offset = 0; offset < region.data.byteLength; offset += FLASH_CHUNK) {
      const piece = region.data.subarray(offset, offset + FLASH_CHUNK);
      await device.flashEraseAndWrite(region.address + offset, piece);
      done += piece.byteLength;
      onProgress({ step: "flashing", fraction: done / total });
    }
  }

  onProgress({ step: "restarting" });
  await device.rebootRp2350(0, 0, 0, REBOOT_DELAY_MS);
}

async function waitForBootloader(): Promise<PicoflashHandle> {
  const deadline = Date.now() + BOOTLOADER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const device = await findBootloader();
    if (device) return device;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Your board didn't come back in BOOTSEL mode. Unplug it, hold BOOTSEL while plugging it in, and try again.");
}
