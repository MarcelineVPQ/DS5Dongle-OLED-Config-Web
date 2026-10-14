// Reads the desktop's colors for the "Match desktop" theme and watches for
// changes so the open app follows along.
// Also the accent for App settings -> Accent color -> Desktop, in any theme.
//   KDE Plasma: the full color scheme from ~/.config/kdeglobals (else just its
//   accent).
//   Windows / macOS: the system accent color + light/dark.
//   Other Linux desktops: the accent from the XDG settings portal, if any.
//   Last: Electron's system accent (also on Linux).
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nativeTheme, systemPreferences } from "electron";
import { kdeAccent, parseKdeGlobals, type DesktopPalette, type Rgb } from "../../src/desktop/theme/desktopPalette";

const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const kdeGlobals = join(configDir, "kdeglobals");

// KDE Plasma, also when the app was started without XDG_CURRENT_DESKTOP
// (systemd-run, some autostart entries, Flatpak/AppImage launchers): the
// session variables KDE sets, else a kdeglobals plus a running Plasma shell or
// KWin. `kdeRunning` is only asked when no variable answers.
export function isKdeSession(env: NodeJS.ProcessEnv, hasKdeGlobals: boolean, kdeRunning: () => boolean): boolean {
  if (/kde/i.test(env.XDG_CURRENT_DESKTOP ?? "")) return true;
  if (env.KDE_FULL_SESSION === "true") return true;
  if (/^(kde|plasma)/i.test(env.XDG_SESSION_DESKTOP ?? "") || /(^|\/)(kde|plasma)/i.test(env.DESKTOP_SESSION ?? "")) return true;
  return hasKdeGlobals && kdeRunning();
}

// Whether plasmashell or KWin runs (one pass over /proc; Linux only).
function plasmaRunning(): boolean {
  try {
    // loop: NOT-WORTH — one pass over the process list, once per app run (isKde caches it)
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        if (/^(plasmashell|kwin_wayland|kwin_x11)$/.test(readFileSync(`/proc/${pid}/comm`, "utf8").trim())) return true;
      } catch {
        // error: NOT-WORTH — the process ended meanwhile: skip it
      }
    }
  } catch {
    // error: NOT-WORTH — no /proc: not KDE; the portal and the system accent are tried next
  }
  return false;
}

// cache: OK — key=none (the desktop session); invalidated=never, the session can't change under a running app; bound=1 entry
let kde: boolean | null = null;
function isKde(): boolean {
  if (process.platform !== "linux") return false;
  kde ??= isKdeSession(process.env, existsSync(kdeGlobals), plasmaRunning);
  return kde && existsSync(kdeGlobals);
}

// Electron's system accent ("rrggbbaa"; empty where the system has none).
function systemAccent(): Rgb | null {
  try {
    return hexAccent(systemPreferences.getAccentColor() ?? "");
  } catch {
    // error: NOT-WORTH — not available here: null, and the Accent color row says the desktop's accent couldn't be read
    return null;
  }
}

function hexAccent(hex: string): Rgb | null {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// The XDG desktop portal's accent (GNOME 47+, others). Doubles 0..1.
function portalAccent(): Promise<Rgb | null> {
  return new Promise((resolve) => {
    // lifetime: OK — exits on its own; the 2 s timeout kills a hung gdbus
    // error: NOT-WORTH — no portal or no gdbus answers null: the system accent is tried next, else the Accent color row says it couldn't be read
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

function readKdeGlobals(): string | null {
  try {
    return readFileSync(kdeGlobals, "utf8");
  } catch {
    // error: NOT-WORTH — no readable kdeglobals: the portal and the system accent are tried next
    return null;
  }
}

// Null only when no accent can be read at all (the renderer says so).
export async function readDesktopPalette(): Promise<DesktopPalette | null> {
  const isDark = nativeTheme.shouldUseDarkColors;
  const text = isKde() ? readKdeGlobals() : null;
  if (text) {
    const full = parseKdeGlobals(text);
    if (full) return full;
    const accent = kdeAccent(text);
    if (accent) return { source: "accent", isDark, accent };
  }
  const accent = (process.platform === "linux" ? await portalAccent() : null) ?? systemAccent();
  return accent ? { source: "accent", isDark, accent } : null;
}

// Calls `onChange` (debounced) whenever the desktop's colors may have changed.
export function watchDesktopPalette(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 300); // lifetime: OK — one-shot 300 ms debounce, cleared by the next fire()
  };
  let watcher: FSWatcher | null = null;
  if (isKde()) {
    // KDE rewrites kdeglobals atomically (new file + rename), so watch the folder.
    try {
      // lifetime: NOT-WORTH — one watcher per app, closed by the returned stop (index.ts keeps it to quit)
      watcher = watch(configDir, (_event, file) => {
        if (file === "kdeglobals") fire();
      });
    } catch {
      // error: NOT-WORTH — no KDE config folder to watch: an accent change is picked up at the next start
      watcher = null;
    }
  }
  nativeTheme.on("updated", fire); // lifetime: OK — removed by the returned stop; one per app, lives until quit
  // lifetime: OK — removed by the returned stop; one per app, lives until quit
  if (process.platform === "win32") systemPreferences.on("accent-color-changed", fire);
  return () => {
    watcher?.close();
    nativeTheme.removeListener("updated", fire);
    if (process.platform === "win32") systemPreferences.removeListener("accent-color-changed", fire);
  };
}
