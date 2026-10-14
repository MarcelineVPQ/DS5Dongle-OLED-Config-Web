// Handing game links (steam://, heroic://, lutris:), folders and web links to
// the desktop on Linux, starting launchers again, and asking whether the desktop has an app registered for a link's
// scheme, so the game page can say "is the launcher installed?" only when it
// really isn't.
//
// Both run with the user's real home, not the app's environment: the dev copy
// (tools/dev.sh) runs with HOME set to a test folder, and a launcher that
// wasn't running yet would start with that HOME (its own config, login and
// runtime downloads there). Electron's shell.openExternal/openPath pass the
// app's environment on, so Linux uses xdg-open directly: fixed argv, no shell.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { inside } from "./running";

// Variables that describe this app, never the launcher: Electron's and
// Chromium's switches, our own DS5_* dev switches, the AppImage runtime's.
const APP_ONLY = /^(ELECTRON_|CHROME_|DS5_)|^(APPIMAGE|APPDIR|ARGV0|OWD)$/;
// Per-user base folders that may point inside an overridden HOME.
const XDG_HOME_DIRS = new Set(["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]);

/** The environment a launcher gets: the app's, with HOME = the real (passwd)
 * home, XDG base folders inside an overridden HOME removed (so they default
 * under the real one), and app-only variables dropped. */
export function launcherEnv(env: NodeJS.ProcessEnv, realHome: string): NodeJS.ProcessEnv {
  const fakeHome = env.HOME && env.HOME !== realHome ? env.HOME : null;
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || APP_ONLY.test(key)) continue;
    if (fakeHome && XDG_HOME_DIRS.has(key) && inside(value, fakeHome)) continue;
    out[key] = value;
  }
  out.HOME = realHome;
  return out;
}

export function realHome(): string {
  try {
    return userInfo().homedir; // the passwd entry, which ignores a HOME override
  } catch {
    // error: NOT-WORTH — no passwd entry: HOME is used
    return process.env.HOME ?? "/";
  }
}

// ---- Starting programs for the user, independent of this app ----
//
// Everything the app starts for the user (a launcher it reopens, xdg-open
// for Play, launcher links, folders and web links) must outlive the app: a
// restart, a self-update relaunch or quitting must never take it along.
// Linux: a detached child still sits in the app's cgroup, and when the app's
// systemd unit or scope stops (the dev copy's service, an autostart or
// session service, the updater's relaunch unit) systemd kills the whole
// cgroup: Steam lost its saved login that way, mid-sign-in. So on Linux the
// program gets its own transient user unit, named the way KDE and GNOME
// name launched apps (app-<launcher>-<app id>@<random>.service), and only
// without a user systemd falls back to a detached spawn (setsid: its own
// session and process group). Windows: libuv puts only non-detached children
// in its kill-on-close job object; a detached one (DETACHED_PROCESS, new
// process group) is in no job of ours and keeps running when the app exits.
// macOS: a detached child is reparented to launchd when the app quits and
// nothing kills it; links and folders there go through shell.openExternal /
// openPath (LaunchServices, like `open`), which start apps under launchd.

/** The launcher part of our unit names (systemd's desktop convention). */
export const UNIT_PREFIX = "app-ds5configurator";

// Variables systemd sets per unit itself: never copied from this process
// (they describe the app's own unit, not the new one).
const PER_UNIT =
  /^(INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|MANAGERPID|MAINPID|NOTIFY_SOCKET|WATCHDOG_PID|WATCHDOG_USEC|LISTEN_PID|LISTEN_FDS|LISTEN_FDNAMES|MEMORY_PRESSURE_WATCH|MEMORY_PRESSURE_WRITE|CREDENTIALS_DIRECTORY|RUNTIME_DIRECTORY|STATE_DIRECTORY|CACHE_DIRECTORY|LOGS_DIRECTORY|CONFIGURATION_DIRECTORY|TRIGGER_UNIT|TRIGGER_PATH|TRIGGER_TIMER_[A-Z_]+)$/;

/** The app id in a unit name: the program's file name (or the Flatpak app
 * id for `flatpak run <id>`), lowercase, only [a-z0-9.]. */
export function unitAppId(cmd: string, args: string[]): string {
  const name = cmd === "flatpak" && args[0] === "run" && args[1] ? args[1] : (cmd.split(/[\\/]/).pop() ?? cmd);
  const id = name
    .toLowerCase()
    .replace(/\.(appimage|exe)$/, "")
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 60);
  return id || "program";
}

/** A unit name like app-ds5configurator-steam@lq2x9k1a3f.service. */
export const unitName = (cmd: string, args: string[], now: number, random: string): string => `${UNIT_PREFIX}-${unitAppId(cmd, args)}@${now.toString(36)}${random}.service`;

/** `systemctl --user show-environment` output as a map (a value systemd
 * quoted stays quoted, so it just differs and is passed on). */
export function parseManagerEnv(out: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

/** The user's systemd: its version and the environment units start with. */
export interface UserSystemd {
  version: number;
  env: Record<string, string>;
}

/** The version in `systemctl --version`'s first line ("systemd 259 (…)"). */
export const parseSystemdVersion = (out: string): number => Number(/^systemd (\d+)/.exec(out)?.[1] ?? 0);

/** systemd-run's argv for starting `cmd args` in its own transient user
 * unit, with the launcher environment: `--setenv` for every variable whose
 * value differs from the user manager's (the unit starts from that). */
export function systemdRunArgs(cmd: string, args: string[], env: NodeJS.ProcessEnv, systemd: UserSystemd, unit: string): string[] {
  const setenv = Object.entries(env)
    .filter(([k, v]) => v !== undefined && !PER_UNIT.test(k) && systemd.env[k] !== v)
    .map(([k, v]) => `--setenv=${k}=${v}`);
  // Type=exec: the start fails (and we fall back) when the program can't be
  // run. The unit lives as long as anything in it runs (xdg-open and launcher
  // scripts exit and leave the app running): ExitType=cgroup (systemd 250+),
  // before that KillMode=process (the unit ends, its processes stay).
  const lifetime = systemd.version >= 250 ? "--property=ExitType=cgroup" : "--property=KillMode=process";
  return ["--user", "--collect", "--quiet", `--unit=${unit}`, "--property=Type=exec", lifetime, ...setenv, "--", cmd, ...args];
}

export type RunResult = "ok" | "failed" | "timeout";

export interface StartDeps {
  platform: NodeJS.Platform;
  env: () => NodeJS.ProcessEnv; // the launcher environment
  /** The user's systemd, or null when there is none (or no session bus). */
  userSystemd: (env: NodeJS.ProcessEnv) => Promise<UserSystemd | null>;
  /** Run systemd-run with this argv and env and wait for it. */
  systemdRun: (argv: string[], env: NodeJS.ProcessEnv) => Promise<RunResult>;
  /** A detached spawn (POSIX: setsid, own process group), no shell. */
  spawnDetached: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<boolean>;
  now: () => number;
  random: () => string;
}

function spawnDetached(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    // lifetime: OK — detached and unref'd on spawn: the program is the user's, it outlives the app on purpose
    // error: SHOWN — desktop.library.action.failed (a start that fails resolves false up to the game action)
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", env });
    child.once("error", () => resolve(false)); // lifetime: OK — fires once; goes with the child object
    // lifetime: OK — fires once; goes with the child object
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

const realDeps: StartDeps = {
  platform: process.platform,
  env: () => launcherEnv(process.env, realHome()),
  userSystemd: (env) => {
    // lifetime: OK — systemctl exits on its own; the 3 s timeout kills a hung one
    // error: NOT-WORTH — no user systemd answers null: the program is started without it
    const run = (args: string[]) => new Promise<string | null>((resolve) => execFile("systemctl", args, { encoding: "utf8", timeout: 3000, env }, (err, out) => resolve(err ? null : out)));
    return Promise.all([run(["--user", "show-environment"]), run(["--version"])]).then(([vars, version]) =>
      vars === null ? null : { env: parseManagerEnv(vars), version: parseSystemdVersion(version ?? "") },
    );
  },
  systemdRun: (argv, env) =>
    // lifetime: OK — systemd-run exits once the --collect'ed unit started (10 s timeout)
    // error: NOT-WORTH — "failed" / "timeout" make startIndependent fall back to a detached start
    new Promise((resolve) => execFile("systemd-run", argv, { timeout: 10_000, env }, (err) => resolve(!err ? "ok" : (err as { killed?: boolean }).killed ? "timeout" : "failed"))),
  spawnDetached,
  now: Date.now,
  random: () => randomBytes(3).toString("hex"),
};

/** Start a program the main process chose (fixed argv, no shell) for the
 * user, independent of this app (above), with the launcher environment.
 * Resolves once it started (true) or couldn't (false). */
export async function startIndependent(cmd: string, args: string[], deps: StartDeps = realDeps): Promise<boolean> {
  const env = deps.env();
  if (deps.platform === "linux") {
    const systemd = await deps.userSystemd(env);
    if (systemd) {
      const result = await deps.systemdRun(systemdRunArgs(cmd, args, env, systemd, unitName(cmd, args, deps.now(), deps.random())), env);
      if (result === "ok") return true;
      // It may still start: never risk a second copy (two Steams).
      if (result === "timeout") return false;
    }
  }
  return deps.spawnDetached(cmd, args, env);
}

/** Used for xdg-open, for reopening a launcher and for ▶ Play starting one in the background. */
export const startForUser = (cmd: string, args: string[]): Promise<boolean> => startIndependent(cmd, args);

/** Open a link or folder the main process built (never one from the page)
 * with xdg-open. */
export function openForUser(target: string): Promise<boolean> {
  // Links start with their scheme, folders with "/": never an option.
  if (target.startsWith("-")) return Promise.resolve(false);
  return startForUser("xdg-open", [target]);
}

// The desktop entry registered for a link's scheme ("heroic.desktop"), or
// null when none is or it can't be told (`err` true: no xdg-mime).
function defaultHandler(scheme: string): Promise<{ err: boolean; entry: string | null }> {
  const env = process.platform === "linux" ? launcherEnv(process.env, realHome()) : process.env;
  return new Promise((resolve) =>
    // lifetime: OK — xdg-mime exits on its own; the 3 s timeout kills a hung one
    // error: NOT-WORTH — no xdg-mime (err): Electron's own lookup answers instead
    execFile("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8", timeout: 3000, env }, (err, out) => resolve({ err: !!err, entry: err ? null : out.trim() || null })),
  );
}

/** Whether an app is registered for a link's scheme. Windows and macOS ask
 * the system through Electron (`nameForProtocol` is
 * app.getApplicationNameForProtocol: "" when nothing is). Linux asks
 * xdg-mime with the launcher environment instead: Electron's lookup reads
 * the app's own HOME, which in the dev copy is a test folder, so a handler
 * installed in the user's ~/.local/share/applications (Steam's own entry)
 * would look missing. Without xdg-mime, Linux falls back to Electron's. */
export async function hasSchemeHandler(url: string, nameForProtocol: (url: string) => string, platform: NodeJS.Platform = process.platform, handler = defaultHandler): Promise<boolean> {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return false;
  const electronSays = () => {
    try {
      return nameForProtocol(`${scheme}://`) !== "";
    } catch {
      // error: NOT-WORTH — can't tell: the open attempt decides, and a failed open shows desktop.library.action.failed
      return true; // can't tell: let the open attempt decide
    }
  };
  if (platform !== "linux") return electronSays();
  const { err, entry } = await handler(scheme);
  return err ? electronSays() : entry !== null;
}

/** The applications folders desktop entries are looked up in (XDG base
 * dirs, the user's first), for this real home. */
export function applicationDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const dataHome = env.XDG_DATA_HOME || join(home, ".local/share");
  const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [dataHome, ...dataDirs].map((d) => join(d, "applications"));
}

/** The Exec value in a desktop entry's [Desktop Entry] group. */
export function desktopExec(text: string): string | null {
  let inMain = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) inMain = t === "[Desktop Entry]";
    else if (inMain && t.startsWith("Exec=")) return t.slice(5);
  }
  return null;
}

/** Linux: the Exec value of the app registered for a scheme (read only;
 * the caller decides what of it, if anything, to use), or null. */
export async function schemeHandlerExec(scheme: string): Promise<string | null> {
  const { entry } = await defaultHandler(scheme);
  if (!entry || !/^[\w.-]+\.desktop$/.test(entry)) return null;
  // loop: SERIAL-REQUIRED — data dependency: the first XDG folder with the entry wins
  for (const dir of applicationDirs(launcherEnv(process.env, realHome()), realHome())) {
    try {
      return desktopExec(await readFile(join(dir, entry), "utf8"));
    } catch {
      // error: NOT-WORTH — not in this folder
    }
  }
  return null;
}
