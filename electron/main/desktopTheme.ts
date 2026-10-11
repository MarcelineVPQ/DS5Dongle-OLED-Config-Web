// Reads the desktop's colors for the "Match desktop" theme and watches for
// changes so the open app follows along.
//   KDE Plasma: the full color scheme from ~/.config/kdeglobals.
//   Windows / macOS: the system accent color + light/dark.
//   Other Linux desktops: the accent from the XDG settings portal, if any.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nativeTheme, systemPreferences } from "electron";
import { parseKdeGlobals, type DesktopPalette, type Rgb } from "../../src/desktop/theme/desktopPalette";

const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const kdeGlobals = join(configDir, "kdeglobals");

function isKde(): boolean {
  return process.platform === "linux" && /kde/i.test(process.env.XDG_CURRENT_DESKTOP ?? "") && existsSync(kdeGlobals);
}

function hexAccent(hex: string): Rgb | null {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// The XDG desktop portal's accent (GNOME 47+, others). Doubles 0..1.
function portalAccent(): Promise<Rgb | null> {
  return new Promise((resolve) => {
    execFile(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.portal.Desktop",
        "--object-path",
        "/org/freedesktop/portal/desktop",
        "--method",
        "org.freedesktop.portal.Settings.ReadOne",
        "org.freedesktop.appearance",
        "accent-color",
      ],
      { timeout: 2000 },
      (error, stdout) => {
        const m = !error && /\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/.exec(stdout);
        if (!m) return resolve(null);
        const c = [m[1], m[2], m[3]].map((v) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255)) as Rgb;
        resolve(c);
      },
    );
  });
}

export async function readDesktopPalette(): Promise<DesktopPalette | null> {
  if (isKde()) {
    try {
      return parseKdeGlobals(readFileSync(kdeGlobals, "utf8"));
    } catch {
      return null;
    }
  }
  const isDark = nativeTheme.shouldUseDarkColors;
  if (process.platform === "win32" || process.platform === "darwin") {
    const accent = hexAccent(systemPreferences.getAccentColor());
    return accent ? { source: "accent", isDark, accent } : null;
  }
  const accent = await portalAccent();
  return accent ? { source: "accent", isDark, accent } : null;
}

// Calls `onChange` (debounced) whenever the desktop's colors may have changed.
export function watchDesktopPalette(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 300);
  };
  let watcher: FSWatcher | null = null;
  if (isKde()) {
    // KDE rewrites kdeglobals atomically (new file + rename), so watch the folder.
    try {
      watcher = watch(configDir, (_event, file) => {
        if (file === "kdeglobals") fire();
      });
    } catch {
      watcher = null;
    }
  }
  nativeTheme.on("updated", fire);
  if (process.platform === "win32") systemPreferences.on("accent-color-changed", fire);
  return () => {
    watcher?.close();
    nativeTheme.removeListener("updated", fire);
    if (process.platform === "win32") systemPreferences.removeListener("accent-color-changed", fire);
  };
}
