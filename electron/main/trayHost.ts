// GNOME shows no tray icons unless an AppIndicator extension provides a
// StatusNotifier host (2026-10-31 app review S6). There, close-to-tray would
// hide the window with nothing to bring it back, so the app treats the tray
// as missing: closing quits, it never starts hidden, and App settings leaves
// those two switches out. Other desktops keep a tray (an SNI host, or the
// XEmbed tray Electron falls back to on XFCE, MATE, Cinnamon), so only GNOME
// is asked. Any failure to ask counts as "has a tray" (the behaviour before).
import { execFile } from "node:child_process";

// gdbus's answer to NameHasOwner: "(false,)" when no StatusNotifier host runs.
export const saysNoOwner = (stdout: string): boolean => /^\(false,?\)\s*$/.test(stdout.trim());

export function trayHostMissing(desktop = process.env.XDG_CURRENT_DESKTOP ?? ""): Promise<boolean> {
  if (process.platform !== "linux" || !/gnome/i.test(desktop)) return Promise.resolve(false);
  return new Promise((resolve) => {
    // lifetime: OK — exits on its own; the 1 s timeout kills a hung gdbus
    // error: NOT-WORTH — no gdbus or no session bus answers "has a tray": the behaviour before this check
    execFile(
      "gdbus",
      ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", "org.kde.StatusNotifierWatcher"],
      { timeout: 1000 },
      (error, stdout) => resolve(!error && saysNoOwner(stdout)),
    );
  });
}
