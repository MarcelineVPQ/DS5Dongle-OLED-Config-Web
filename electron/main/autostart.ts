// Launch at login. Electron's setLoginItemSettings works on Windows and macOS
// but is a no-op on Linux, so there we write an XDG autostart entry ourselves
// (same approach as Sonata). `--hidden` starts in the tray.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { execArg } from "./desktopEntry";
import { launchPath } from "./integration";

export const APP_ID = "io.github.MarcelineVPQ.DS5DongleConfigurator";
export const HIDDEN_FLAG = "--hidden";

function linuxExec(): string {
  // The stable AppImage symlink (integration.ts); never process.execPath, which
  // inside an AppImage is the FUSE mount and gone after exit.
  return execArg(launchPath());
}

// Throws when the autostart entry can't be written or removed: a change from
// App settings or the tray is then put back and shown (updateSetting); the
// start-up re-apply only logs it.
export function applyAutostart(enabled: boolean, startMinimized: boolean): void {
  if (process.platform === "linux") {
    const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "autostart");
    const file = join(dir, `${APP_ID}.desktop`);
    if (enabled) {
      mkdirSync(dir, { recursive: true });
      const exec = linuxExec() + (startMinimized ? ` ${HIDDEN_FLAG}` : "");
      writeFileSync(file, `[Desktop Entry]\nType=Application\nName=DS5 Dongle OLED Edition Configurator\nExec=${exec}\nIcon=${APP_ID}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
    } else if (existsSync(file)) {
      unlinkSync(file);
    }
    return;
  }
  // Windows: the installed exe (launchPath). Applied at every start, so an
  // entry written by an older build (the portable exe's path) is corrected.
  // The uninstaller removes it (build/installer.nsh).
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: startMinimized ? [HIDDEN_FLAG] : [],
    ...(process.platform === "win32" ? { path: launchPath() } : {}),
  });
}
