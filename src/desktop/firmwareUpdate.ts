// One-click firmware update, no drive mounting and no unplugging:
//   1. the main process downloads the UF2 and verifies size + SHA-256;
//   2. the dongle reboots into BOOTSEL on command (0xF6 0x08);
//   3. the RP2350 boot device is flashed over PICOBOOT (WebUSB, the same
//      vendored flasher as the web tool) and rebooted;
//   4. the app reconnects on its own and the caller confirms the version.
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

  onProgress({ step: "flashing", fraction: 0 });
  const total = regions.reduce((n, r) => n + r.data.byteLength, 0);
  let done = 0;
  await device.connect();
  for (const region of regions) {
    await device.flashEraseAndWrite(region.address, region.data);
    done += region.data.byteLength;
    onProgress({ step: "flashing", fraction: done / total });
  }

  onProgress({ step: "restarting" });
  await device.rebootRp2350(0, 0, 0, REBOOT_DELAY_MS);
  return version;
}

async function waitForBootloader(): Promise<PicoflashHandle> {
  const deadline = Date.now() + BOOTLOADER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const devices = await PicoflashAPI.getDevices();
    if (devices.length > 0) return devices[0];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("The dongle didn't come back in BOOTSEL mode. Unplug it, hold BOOTSEL while plugging it in, and try again.");
}
