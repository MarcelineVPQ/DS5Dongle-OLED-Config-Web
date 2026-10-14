// Desktop integration without an installer.
//
// Linux (AppImage): keep a stable `DS5Dongle-OLED-Edition-Configurator.AppImage` symlink next
// to the versioned file, and point an XDG menu entry and icon at the symlink.
// Self-updates download a new versioned AppImage and repoint the symlink, so
// the menu entry, autostart and pinned launchers never go stale (Sonata's
// lesson: a versioned Exec= path broke after every update).
//
// Windows: the per-user installer adds the Start menu entry and the
// uninstaller (electron-builder.yml); the tray menu can add a desktop shortcut.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { app, shell } from "electron";
import { APP_ID } from "./autostart";
import { execArg } from "./desktopEntry";

const STABLE_APPIMAGE = "DS5Dongle-OLED-Edition-Configurator.AppImage";
const SHORTCUT_NAME = "DS5 Dongle OLED Edition Configurator.lnk";

// The path launchers should run: the stable AppImage symlink, or the
// executable itself (installed on Windows; in development the plain one).
export function launchPath(): string {
  if (process.env.APPIMAGE) {
    const stable = join(dirname(realpathOrSelf(process.env.APPIMAGE)), STABLE_APPIMAGE);
    return existsSync(stable) ? stable : process.env.APPIMAGE;
  }
  return process.execPath;
}

export function integrateDesktop(resourcesDir: string): void {
  try {
    if (process.platform === "linux" && process.env.APPIMAGE) integrateAppImage(resourcesDir);
  } catch (cause) {
    // error: LOGGED-OK — start-up desktop integration (menu entry, Start menu shortcut): nothing the user asked for, and the app works without it
    console.error("desktop integration failed:", cause instanceof Error ? cause.message : cause);
  }
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // error: NOT-WORTH — no real path: the path itself
    return path;
  }
}

function integrateAppImage(resourcesDir: string): void {
  const installed = realpathOrSelf(process.env.APPIMAGE!);
  const stable = join(dirname(installed), STABLE_APPIMAGE);
  let launch = installed;
  if (stable !== installed) {
    try {
      if (lstatSync(stable, { throwIfNoEntry: false })) rmSync(stable, { force: true });
      symlinkSync(installed, stable);
      launch = stable;
    } catch {
      // error: NOT-WORTH — Read-only folder: fall back to the versioned path.
    }
  }

  const share = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const iconPath = join(share, "icons", "hicolor", "512x512", "apps", `${APP_ID}.png`);
  mkdirSync(dirname(iconPath), { recursive: true });
  copyFileSync(join(resourcesDir, "icon.png"), iconPath);

  const entry =
    "[Desktop Entry]\nType=Application\nName=DS5 Dongle OLED Edition Configurator\n" +
    "Comment=Configure the DS5 Dongle OLED Edition\n" +
    `Exec=${execArg(launch)} %U\n` +
    `Icon=${APP_ID}\nTerminal=false\nCategories=Utility;Settings;\n` +
    `StartupWMClass=${APP_ID}\n`;
  const appsDir = join(share, "applications");
  const desktopPath = join(appsDir, `${APP_ID}.desktop`);
  mkdirSync(appsDir, { recursive: true });
  let current = "";
  try {
    current = readFileSync(desktopPath, "utf8");
  } catch {
    // error: NOT-WORTH — First run.
  }
  if (current !== entry) {
    writeFileSync(desktopPath, entry);
    // lifetime: OK — exits on its own; only when the desktop entry changed
    // Refresh the menu caches (no-ops where the tool doesn't exist).
    // error: NOT-WORTH — menu cache refresh, a no-op where the tool doesn't exist
    execFile("update-desktop-database", [appsDir], () => undefined);
    // lifetime: OK — each exits on its own; only when the desktop entry changed
    // error: NOT-WORTH — menu cache refresh, a no-op where the tool doesn't exist
    execFile("kbuildsycoca6", () => execFile("kbuildsycoca5", () => undefined));
  }
}

// Windows only: offered from the tray menu.
export function createDesktopShortcut(): boolean {
  if (process.platform !== "win32") return false;
  const target = process.execPath;
  return shell.writeShortcutLink(join(app.getPath("desktop"), SHORTCUT_NAME), "create", { target, appUserModelId: APP_ID, icon: target, iconIndex: 0 });
}
