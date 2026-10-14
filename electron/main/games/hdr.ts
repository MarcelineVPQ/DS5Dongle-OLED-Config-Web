// What the "Turn on HDR" fix needs on this computer (Games page, Linux): the
// game runs inside gamescope (Valve's compositor) as a Wayland window with
// --hdr-enabled, on a screen the desktop runs in HDR. One read-only check,
// every program run with a fixed argv, no shell and a 5 s timeout:
//   - the screens: KDE Plasma `kscreen-doctor -o`; GNOME (48+) Mutter's
//     DisplayConfig.GetCurrentState over `gdbus call`; other desktops have no
//     read-only check we can rely on, so the fix isn't offered there and the
//     page says why. Each screen's current mode gives gamescope's -W / -H.
//   - gamescope: found on PATH (no program run for that), then
//     `gamescope --version` (it only prints its version and exits).
//   - its WSI Vulkan layer (VkLayer_FROG_gamescope_wsi.<arch>.json) in the
//     Vulkan loader's implicit layer folders, and the Flatpak extension
//     org.freedesktop.Platform.VulkanLayer.gamescope for Flatpak launchers.
import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
// Linux-only paths: POSIX joins on any machine (the tests run on Windows too).
import { join } from "node:path/posix";
import { promisify } from "node:util";
import type { HdrDesktop, HdrScreen, HdrSystem } from "../../../src/desktop/games/types";
import { FLATPAK_GAMESCOPE, GAMESCOPE_MIN } from "../../../src/desktop/games/hdrSetup";

const run = promisify(execFile);

// kscreen-doctor colours its output (ANSI codes) even into a pipe.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export interface KscreenOutput extends HdrScreen {
  enabled: boolean;
  connected: boolean;
  hdrState: string; // "enabled", "disabled", "incapable", or "" when not listed
}

// Parse `kscreen-doctor -o`: one "Output: <id> <connector> <uuid>" block per
// output, with "enabled"/"disabled", "connected"/"disconnected", "HDR: <state>",
// "Modes:  <id>:<w>x<h>@<hz>[*][!] …" (* = current, ! = preferred) and
// "Rotation: <n>" (2 and 8 are portrait: width and height swap) lines.
export function parseKscreenOutputs(text: string): KscreenOutput[] {
  const clean = text.replace(ANSI, "");
  return clean
    .split(/^Output:/m)
    .slice(1)
    .flatMap((block) => {
      const name = /^\s*\d+\s+(\S+)/.exec(block)?.[1];
      if (!name) return [];
      // loop: NOT-WORTH — lines of one kscreen output block
      const lines = block.split("\n").map((l) => l.trim());
      const joined = lines.join("\n");
      const modes = /^Modes:(.*)$/m.exec(joined)?.[1] ?? "";
      const current = /\d+:(\d+)x(\d+)@([\d.]+)!?\*/.exec(modes);
      const portrait = ["2", "8"].includes(/^Rotation:\s*(\d+)/m.exec(joined)?.[1] ?? "1");
      const [w, h] = current ? [Number(current[1]), Number(current[2])] : [0, 0];
      const hdrState = /^HDR:\s*(\S+)/m.exec(joined)?.[1]?.toLowerCase() ?? "";
      return [
        {
          name,
          enabled: lines.includes("enabled"),
          connected: lines.includes("connected"),
          hdrState,
          hdr: hdrState === "enabled",
          width: portrait ? h : w,
          height: portrait ? w : h,
          refresh: current ? Number(current[3]) : 0,
        },
      ];
    });
}

// Connected, enabled screens (HDR on or not), with their current mode.
export const kscreenScreens = (text: string): HdrScreen[] =>
  parseKscreenOutputs(text)
    .filter((o) => o.enabled && o.connected)
    .map(({ name, hdr, width, height, refresh }) => ({ name, hdr, width, height, refresh }));

// Parse Mutter's DisplayConfig.GetCurrentState as `gdbus call` prints it
// (GVariant text). Each physical monitor is "(('<connector>', '<vendor>',
// '<product>', '<serial>'), [modes…], {properties})"; a mode is
// "('<id>', <w>, <h>, <hz>, <scale>, [scales], {'is-current': <true>, …})";
// the monitor's "color-mode" property is 1 for BT.2100 (HDR), GNOME 48+.
export function gnomeScreens(text: string): HdrScreen[] {
  const starts = [...text.matchAll(/\(\('([^']*)', '[^']*', '[^']*', '[^']*'\), \[/g)];
  return starts.flatMap((m, i) => {
    const chunk = text.slice(m.index, starts[i + 1]?.index ?? text.length);
    // loop: NOT-WORTH — modes of one GNOME monitor
    const mode = [...chunk.matchAll(/\('[^']*', (\d+), (\d+), ([\d.]+), [\d.]+, \[[^\]]*\], (?:@a\{sv\} )?\{([^}]*)\}\)/g)].find((x) => /'is-current': <true>/.test(x[4]));
    if (!mode) return []; // not lit up
    return [{ name: m[1], hdr: /'color-mode': <uint32 1>/.test(chunk), width: Number(mode[1]), height: Number(mode[2]), refresh: Number(mode[3]) }];
  });
}

// "gamescope version 3.16.20+ds-1 (gcc 15.2.0)" -> "3.16.20"
export function parseGamescopeVersion(text: string): string | null {
  return /gamescope version v?(\d+(?:\.\d+)+)/i.exec(text.replace(ANSI, ""))?.[1] ?? null;
}

export function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(":").filter((d) => d.startsWith("/"))) {
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      if (statSync(file).isFile()) return file;
    } catch {
      // not here
    }
  }
  return null;
}

// The folders the Vulkan loader reads implicit layers from (Linux).
export function layerDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const list = (v: string | undefined, fallback: string) => (v || fallback).split(":").filter((d) => d.startsWith("/"));
  return [
    ...list(env.XDG_CONFIG_HOME, join(home, ".config")),
    ...list(env.XDG_CONFIG_DIRS, "/etc/xdg"),
    "/etc",
    ...list(env.XDG_DATA_HOME, join(home, ".local/share")),
    ...list(env.XDG_DATA_DIRS, "/usr/local/share:/usr/share"),
  ].map((d) => join(d, "vulkan", "implicit_layer.d"));
}

export const WSI_LAYER = /^VkLayer_FROG_gamescope_wsi\..+\.json$/;
const hasLayer = (dirs: string[]) =>
  dirs.some((d) => {
    try {
      // loop: NOT-WORTH — files in a few Vulkan layer folders
      return readdirSync(d).some((f) => WSI_LAYER.test(f));
    } catch {
      return false;
    }
  });

const flatpakExtension = (home: string) =>
  [join("/var/lib/flatpak/runtime", FLATPAK_GAMESCOPE), join(home, ".local/share/flatpak/runtime", FLATPAK_GAMESCOPE)].some((d) => statSync(d, { throwIfNoEntry: false })?.isDirectory());

type Runner = (cmd: string, args: string[], opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }) => Promise<{ stdout: string; stderr?: string }>;
const OPTS = (env: NodeJS.ProcessEnv) => ({ timeout: 5000, env: { ...env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 });
const MUTTER = ["call", "--session", "--dest", "org.gnome.Mutter.DisplayConfig", "--object-path", "/org/gnome/Mutter/DisplayConfig", "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState"];

export const desktopOf = (env: NodeJS.ProcessEnv): HdrDesktop => {
  if (!env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== "wayland") return "x11";
  const d = env.XDG_CURRENT_DESKTOP ?? "";
  if (/(^|:)KDE(:|$)/i.test(d)) return "kde";
  if (/(^|:)GNOME(:|$)/i.test(d)) return "gnome";
  return "other-desktop";
};

async function screens(check: HdrDesktop, env: NodeJS.ProcessEnv, exec: Runner): Promise<{ check: HdrDesktop; screens: HdrScreen[] }> {
  try {
    // lifetime: OK — kscreen-doctor exits on its own; the 5 s timeout kills a hung one
    if (check === "kde") return { check, screens: kscreenScreens((await exec("kscreen-doctor", ["-o"], OPTS(env))).stdout) };
    // lifetime: OK — gdbus exits on its own; the 5 s timeout kills a hung one
    if (check === "gnome") return { check, screens: gnomeScreens((await exec("gdbus", MUTTER, OPTS(env))).stdout) };
  } catch {
    return { check: "failed", screens: [] };
  }
  return { check, screens: [] };
}

async function gamescopeVersion(path: string, env: NodeJS.ProcessEnv, exec: Runner): Promise<string | null> {
  try {
    // lifetime: OK — gamescope --version exits on its own; the 5 s timeout kills a hung one
    const { stdout, stderr } = await exec(path, ["--version"], OPTS(env));
    return parseGamescopeVersion(`${stdout}\n${stderr ?? ""}`);
  } catch (e) {
    // Older builds without --version print their usage and fail.
    const out = e as { stdout?: string; stderr?: string };
    return parseGamescopeVersion(`${out.stdout ?? ""}\n${out.stderr ?? ""}`);
  }
}

export async function hdrSystem(env: NodeJS.ProcessEnv = process.env, exec: Runner = run, home = homedir()): Promise<HdrSystem> {
  const desktop = desktopOf(env);
  const path = findOnPath("gamescope", env);
  const [s, version] = await Promise.all([screens(desktop, env, exec), path ? gamescopeVersion(path, env, exec) : Promise.resolve(null)]);
  return {
    ...s,
    gamescope: {
      path,
      version,
      min: desktop === "gnome" ? GAMESCOPE_MIN.gnome : GAMESCOPE_MIN.kde,
      layer: hasLayer(layerDirs(env, home)),
      flatpak: flatpakExtension(home),
    },
  };
}
