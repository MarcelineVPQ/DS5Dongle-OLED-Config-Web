// One-click firmware update, no drive mounting and no unplugging:
//   1. the main process downloads the UF2 and verifies size + SHA-256;
//   2. the dongle reboots into BOOTSEL on command (0xF6 0x08);
//   3. the RP2350 boot device is flashed over PICOBOOT (WebUSB, the same
//      vendored flasher as the web tool) and rebooted;
//   4. the app reconnects on its own and the caller confirms the version.
// A new (or non-dongle) Pico plugged in with BOOTSEL held skips step 2:
// installFirmware() flashes it directly (first-run setup).
//
// Several boards (any number): the board being updated flashes its "THIS
// ONE" screen first (protocol 1.20), and only a bootloader known to be it is
// written: the one whose USB serial is its board id, else the one BOOTSEL
// device that appeared after it rebooted. Several new ones, or several and
// none identifiable: nothing is written, and the message says to unplug the
// boards that shouldn't be updated (chooseBootTarget, hooks/boards.ts).
import { type Ds5BridgeClient, sleep } from "../protocol/bridgeClient";
import { chooseBootTarget } from "../hooks/boards";
import { KeyedError, logged } from "../errorText";
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
// The board's identify screen shows at least this long before it reboots.
const IDENTIFY_BEFORE_UPDATE_MS = 2000;
// A bootloader that looks like the target is checked again after this, so a
// second board entering BOOTSEL at the same moment can't be mistaken for it.
const BOOTLOADER_SETTLE_MS = 500;
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

  // Which board this is, and which bootloaders are on USB already: only one
  // that is this board, or that appears after it reboots, is written.
  const boardId = client.boardId;
  const before = new Set((await findBootloaders()).map(serialOf));
  // The board being updated shows itself (with several boards on the desk).
  const shownAt = Date.now();
  if (client.identifies) await client.identify().catch(logged("flashing the identify screen before an update (the update itself goes on)"));

  onProgress({ step: "downloading" });
  const { version, bytes } = await shownFirmware(desktop, shown);
  // Parse before touching the device: a malformed file must fail here, while
  // the dongle is still running its current firmware.
  const regions = firmwareRegions(bytes);
  if (client.identifies) await sleep(Math.max(0, shownAt + IDENTIFY_BEFORE_UPDATE_MS - Date.now()));

  return whileWriting(async () => {
    onProgress({ step: "rebooting" });
    await client.enterBootsel();

    onProgress({ step: "waiting-bootloader" });
    const device = await waitForBootloader(boardId, before);

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

// Every Pico in BOOTSEL mode (PICOBOOT) on USB. Dev builds with the
// simulated board: its RP2350 bootloader too while it is in BOOTSEL.
export async function findBootloaders(): Promise<PicoflashHandle[]> {
  const sim = simulatedBoard()?.bootloader();
  const real = await PicoflashAPI.getDevices();
  return sim ? [sim, ...real] : real;
}

// A Pico in BOOTSEL mode, if one is plugged in (the setup screen's look).
export async function findBootloader(): Promise<PicoflashHandle | null> {
  return (await findBootloaders())[0] ?? null;
}

const serialOf = (d: PicoflashHandle): string => d.getUsbDeviceInfo().serialNumber ?? "";

// The bootloader to write now when nothing rebooted into it first (the
// setup screen's Install, Install again): the board with this id if known,
// else the only one. Several and none identifiable: the keyed "unplug the
// others" message; none: noBootsel.
export async function onlyBootloader(boardId: string | null = null): Promise<PicoflashHandle> {
  const devices = await findBootloaders();
  if (devices.length === 0) throw new Error(i18n.t("desktop.firmware.noBootsel"));
  const choice = chooseBootTarget(devices.map(serialOf), boardId, new Set());
  // error: SHOWN — desktop.firmware.severalBootsel: the firmware banner / setup screen says to unplug the boards that shouldn't be updated
  if (typeof choice === "string") throw new KeyedError("desktop.firmware.severalBootsel", { count: devices.length });
  return devices[choice.pick];
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

// The rebooted board's bootloader (chooseBootTarget): never a guess.
export async function waitForBootloader(boardId: string | null, before: ReadonlySet<string>, timeoutMs = BOOTLOADER_TIMEOUT_MS): Promise<PicoflashHandle> {
  const deadline = Date.now() + timeoutMs;
  // loop: SERIAL-REQUIRED — polls until a deadline (300 ms apart) for the board in BOOTSEL
  while (Date.now() < deadline) {
    const devices = await findBootloaders();
    // loop: NOT-WORTH — N = BOOTSEL devices on USB (a few); one look every 300 ms during an update
    const choice = chooseBootTarget(devices.map(serialOf), boardId, before);
    // error: SHOWN — desktop.firmware.severalBootsel: the firmware banner says to unplug the boards that shouldn't be updated; nothing was written
    if (choice === "ambiguous") throw new KeyedError("desktop.firmware.severalBootsel", { count: devices.length });
    if (choice !== "wait") {
      // Look again a moment later: still the one (and only one new one)?
      const picked = serialOf(devices[choice.pick]);
      await sleep(BOOTLOADER_SETTLE_MS);
      const again = await findBootloaders();
      // loop: NOT-WORTH — N = BOOTSEL devices on USB (a few); once per candidate
      const second = chooseBootTarget(again.map(serialOf), boardId, before);
      // error: SHOWN — desktop.firmware.severalBootsel: a second board entered BOOTSEL at the same moment; nothing was written
      if (second === "ambiguous") throw new KeyedError("desktop.firmware.severalBootsel", { count: again.length });
      if (second !== "wait" && serialOf(again[second.pick]) === picked) return again[second.pick];
      continue;
    }
    await sleep(300);
  }
  throw new Error(i18n.t("desktop.firmware.noBootsel"));
}
