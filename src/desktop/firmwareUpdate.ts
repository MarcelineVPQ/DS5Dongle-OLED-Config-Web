// One-click firmware update, no drive mounting and no unplugging:
//   1. the main process downloads the UF2 and verifies size + SHA-256;
//   2. the dongle reboots into BOOTSEL on command (0xF6 0x08);
//   3. the RP2350 boot device is flashed over PICOBOOT (WebUSB, the same
//      vendored flasher as the web tool) and rebooted;
//   4. the app reconnects on its own and the caller confirms the version.
// A new (or non-dongle) Pico plugged in with BOOTSEL held skips step 2:
// installFirmware() flashes it directly (first-run setup).
import type { Ds5BridgeClient } from "../protocol/bridgeClient";
import { PicoflashAPI, parseUf2Regions, Uf2FileError, type PicoflashHandle } from "../flash";
import i18n from "../i18n";
import { simulatedBoard } from "./devPreview";
import type { DesktopApi, LatestFirmware } from "./api";

export type FirmwareStep = "downloading" | "rebooting" | "waiting-bootloader" | "flashing" | "restarting";

export interface FirmwareProgress {
  step: FirmwareStep;
  fraction?: number; // 0..1 while flashing
}

const BOOTLOADER_TIMEOUT_MS = 20_000;
const REBOOT_DELAY_MS = 500;

// Every firmware write goes through here: from the reboot into BOOTSEL until
// the board restarts, the app can't restart, quit or install its own update
// (the main process holds them; electron/main/firmwareHold.ts).
export async function whileWriting<T>(run: () => Promise<T>): Promise<T> {
  window.desktop?.setFirmwareWriting(true);
  try {
    return await run();
  } finally {
    window.desktop?.setFirmwareWriting(false);
  }
}

// Exactly the firmware the user was shown and confirmed (`shown`), or a
// plain reason why not: the feed changed since (check again), or the file
// didn't match.
async function shownFirmware(desktop: DesktopApi, shown: LatestFirmware): Promise<{ version: string; bytes: Uint8Array }> {
  const r = await desktop.downloadFirmware(shown);
  if (!r.ok) throw new Error(i18n.t(r.reason === "changed" ? "desktop.firmware.feedChanged" : "desktop.firmware.hashMismatch"));
  return r;
}

export async function updateFirmware(client: Ds5BridgeClient, shown: LatestFirmware, onProgress: (p: FirmwareProgress) => void): Promise<string> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("Firmware updates need the desktop app.");

  onProgress({ step: "downloading" });
  const { version, bytes } = await shownFirmware(desktop, shown);
  // Parse before touching the device: a malformed file must fail here, while
  // the dongle is still running its current firmware.
  const regions = firmwareRegions(bytes);

  return whileWriting(async () => {
    onProgress({ step: "rebooting" });
    await client.enterBootsel();

    onProgress({ step: "waiting-bootloader" });
    const device = await waitForBootloader();

    await flash(device, regions, onProgress);
    return version;
  });
}

// First-run setup: a Pico already in BOOTSEL mode gets the app's firmware.
export async function installFirmware(device: PicoflashHandle, shown: LatestFirmware, onProgress: (p: FirmwareProgress) => void): Promise<string> {
  const desktop = window.desktop;
  if (!desktop) throw new Error("Installing firmware needs the desktop app.");
  onProgress({ step: "downloading" });
  const { version, bytes } = await shownFirmware(desktop, shown);
  const regions = firmwareRegions(bytes);
  await whileWriting(() => flash(device, regions, onProgress));
  return version;
}

// The firmware file's flash regions, or a plain reason it isn't firmware for
// this board (another chip's UF2, a cut-off or damaged file): nothing is written.
function firmwareRegions(bytes: Uint8Array): ReturnType<typeof parseUf2Regions> {
  try {
    return parseUf2Regions(bytes.slice().buffer);
  } catch (cause) {
    // error: SHOWN — desktop.firmware.wrongFile: rethrown in plain words (the parser's reason kept as its cause); the firmware banner and the setup screen show it
    if (cause instanceof Uf2FileError) throw new Error(i18n.t("desktop.firmware.wrongFile"), { cause });
    throw cause;
  }
}

// A Pico in BOOTSEL mode (PICOBOOT), if one is plugged in. Dev builds with
// the simulated board: its RP2350 bootloader while it is in BOOTSEL.
export async function findBootloader(): Promise<PicoflashHandle | null> {
  const sim = simulatedBoard();
  if (sim) return sim.bootloader();
  return (await PicoflashAPI.getDevices())[0] ?? null;
}

const FLASH_CHUNK = 0x10000; // 64 KB: 16 flash sectors

// Writes the firmware over one PICOBOOT session and restarts the board. The
// session (the board's claimed USB interface) is always released, also when a
// write fails: otherwise the board stays claimed until it is unplugged and a
// retry can't open it. A failure is reported in plain words (the board is in
// BOOTSEL with no firmware: Setup offers to install it again), with the USB
// error kept as the cause for the log.
export async function flash(device: PicoflashHandle, regions: ReturnType<typeof parseUf2Regions>, onProgress: (p: FirmwareProgress) => void): Promise<void> {
  onProgress({ step: "flashing", fraction: 0 });
  const total = regions.reduce((n, r) => n + r.data.byteLength, 0);
  // The simulated bootloader (dev builds) fails "at N %" of this; real boards have no such call.
  (device as { expectBytes?: (n: number) => void }).expectBytes?.(total);
  let done = 0;
  try {
    // lifetime: OK — released in the finally below (disconnect), on success and on every failure
    await device.connect();
    // In pieces, so the progress moves (the firmware is usually one region).
    // Regions are whole flash sectors (alignRegionToSector), and a piece is a
    // whole number of sectors, so every write stays sector-aligned.
    // loop: SERIAL-REQUIRED — one PICOBOOT session: regions are erased and written in order
    for (const region of regions) {
      // loop: SERIAL-REQUIRED — one PICOBOOT session: 64 KB erase+write pieces in order, for the progress
      for (let offset = 0; offset < region.data.byteLength; offset += FLASH_CHUNK) {
        const piece = region.data.subarray(offset, offset + FLASH_CHUNK);
        await device.flashEraseAndWrite(region.address + offset, piece);
        done += piece.byteLength;
        onProgress({ step: "flashing", fraction: done / total });
      }
    }

    onProgress({ step: "restarting" });
    await device.rebootRp2350(0, 0, 0, REBOOT_DELAY_MS);
  } catch (cause) {
    // error: SHOWN — desktop.firmware.writeFailed: rethrown in plain words (the USB error kept as its cause); the firmware card and the setup screen show it
    throw new Error(i18n.t("desktop.firmware.writeFailed"), { cause });
  } finally {
    // Never throws (picoflash logs a failed release). After the restart
    // request it only lets go of the interface before the board resets.
    await device.disconnect();
  }
}

async function waitForBootloader(): Promise<PicoflashHandle> {
  const deadline = Date.now() + BOOTLOADER_TIMEOUT_MS;
  // loop: SERIAL-REQUIRED — polls until a deadline (300 ms apart) for the board in BOOTSEL
  while (Date.now() < deadline) {
    const device = await findBootloader();
    if (device) return device;
    // lifetime: OK — fires once (300 ms between bootloader looks, bounded by the deadline)
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(i18n.t("desktop.firmware.noBootsel"));
}
