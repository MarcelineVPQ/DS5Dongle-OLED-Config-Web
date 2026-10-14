// Windows: the app is installed per user by its NSIS installer (no admin,
// %LOCALAPPDATA%\Programs\ds5-dongle-configurator, a Start menu entry and an
// uninstaller; electron-builder.yml). Updates download the new installer,
// verify it against the signed feed, and run it silently (updater.ts).
import { dirname, join } from "node:path";

// The installer the release publishes (the feed's Windows entry).
export const WINDOWS_SETUP_NAME = /^DS5Dongle-OLED-Edition-Configurator-\d+\.\d+\.\d+(?:-dev\.\d+)?-win-x64-setup\.exe$/;

// Silent, per-user, as an update (keeps the shortcuts the user has); with
// `relaunch` the installer starts the new version when it's done.
export const installerArgs = (relaunch: boolean): string[] => ["/S", "--updated", ...(relaunch ? ["--force-run"] : [])];

// Whether this copy is the installed app: the installer puts its uninstaller
// next to the program. A build run from a folder (win-unpacked) can't update itself.
export const isInstalledApp = (execPath: string, productName: string, exists: (path: string) => boolean): boolean => exists(join(dirname(execPath), `Uninstall ${productName}.exe`));

// The first start of the installed app. "moved": settings from before exist,
// so this replaced the portable exe (the user installed it over one): say once
// that the old file can go. "new": a fresh install, nothing to say. null:
// not the first start. `marker` is written so it's asked only once.
export function firstInstalledStart(settingsFile: string, marker: string, exists: (path: string) => boolean, write: (path: string) => void): "moved" | "new" | null {
  if (exists(marker)) return null;
  const moved = exists(settingsFile);
  write(marker);
  return moved ? "moved" : "new";
}
