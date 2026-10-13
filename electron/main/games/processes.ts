// Launchers that are running, and the one way the app closes and reopens them
// around a settings change (Steam, Heroic and Lutris rewrite their settings
// files when they quit, and Heroic keeps using a game's old settings while it
// runs). Never force-kills: Steam gets its own `-shutdown`, Heroic and Lutris
// get SIGTERM (what a normal window-manager quit sends; on Windows `taskkill
// /PID` without /F, which asks the window to close), then we wait. A
// launcher is only closed while no game is running (closing it could end the
// game), and is started again afterwards the way it was running (native or
// Flatpak). Every program runs by a fixed argv, without a shell, with the
// user's real home (launcherEnv), so a dev copy's test HOME never reaches it.
//
// Windows: the processes come from tasklist (image names only, the same
// reader the running-game watcher uses), Steam is closed and started again by
// its own steam.exe (the registry's SteamPath), Heroic by its installed
// Heroic.exe, and a game runs when Steam says so (RunningAppID) or the
// library sees one.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { CloseProblem, LauncherId } from "../../../src/desktop/games/types";
import { readProcs, readWindowsProcs, type ProcView } from "./running";
import { launcherEnv, realHome, startForUser } from "./schemeHandler";
import { windowsSteamRoots } from "./steam";

export type CloseLauncherResult = "closed" | "not-running" | CloseProblem;

type Maybe<T> = T | Promise<T>;

// What the launcher control needs from the system (a fake in the tests).
export interface ProcLayer {
  list(): Maybe<ProcView[]>; // the user's own processes
  env(pid: number, key: string): string | undefined; // one variable of a process
  exists(path: string): boolean;
  run(cmd: string, args: string[]): void; // a short command (steam -shutdown); result not needed
  start(cmd: string, args: string[]): Promise<boolean>; // a detached launcher; false if it couldn't start
  signal(pid: number): void; // SIGTERM; Windows: taskkill /PID (never /F)
  sleep(ms: number): Promise<void>;
  windows?: WindowsLaunchers; // set on Windows
}

// Windows: where the launchers' programs are, and whether a game runs.
export interface WindowsLaunchers {
  steamExe(): string | null; // <SteamPath>\steam.exe
  heroicExe(): string | null; // Heroic's installed Heroic.exe
  gameRunning(): Maybe<boolean>;
}

// How a launcher is started again: a fixed program and arguments.
export interface ReopenPlan {
  cmd: string;
  args: string[];
}

const FLATPAK_ID: Record<"steam" | "heroic" | "lutris", string> = { steam: "com.valvesoftware.Steam", heroic: "com.heroicgameslauncher.hgl", lutris: "net.lutris.Lutris" };

const isMain = (p: ProcView) => !p.args.some((a) => a.startsWith("--type="));

// A Windows image name ("steam.exe") as the Linux process name ("steam").
const procName = (p: ProcView) => (/\.exe$/i.test(p.comm) ? p.comm.slice(0, -4).toLowerCase() : p.comm);

function matches(launcher: LauncherId, p: ProcView): boolean {
  const name = procName(p);
  switch (launcher) {
    case "steam":
      return name === "steam" || name === "steamwebhelper";
    case "heroic":
      return name === "heroic" || /[/]heroic$/i.test(p.args[0] ?? "");
    case "lutris":
      return p.comm === "lutris" || (/python/.test(p.comm) && p.args.some((a) => /(^|\/)lutris$/.test(a)));
    default:
      return false; // GOG Galaxy / Epic: Windows only, no /proc
  }
}

const LAUNCHERS = ["steam", "heroic", "lutris"] as const;

export function launchersIn(procs: ProcView[]): Set<LauncherId> {
  return new Set(LAUNCHERS.filter((id) => procs.some((p) => matches(id, p))));
}

// A Proton/Wine game is running (Proton's script or a wineserver).
export function gameIn(procs: ProcView[]): boolean {
  return procs.some((p) => p.comm === "wineserver" || (/python/.test(p.comm) && p.args.some((a) => a.endsWith("/proton")) && p.args.includes("waitforexitandrun")));
}

// A Flatpak app's processes see the sandbox's paths: /app/... or the app's own ~/.var/app folder.
const inFlatpak = (launcher: "steam" | "heroic" | "lutris", p: ProcView) => p.args.some((a) => a.startsWith("/app/") || a.includes(`/.var/app/${FLATPAK_ID[launcher]}/`));

// How to start the launcher again, read from its running main process
// (before it's closed). Programs are fixed names or the launcher's own
// absolute path (checked to exist and to be the launcher); never arguments
// from the process beyond Steam's -silent.
export function reopenPlan(launcher: LauncherId, procs: ProcView[], layer: Pick<ProcLayer, "env" | "exists">): ReopenPlan | null {
  if (launcher !== "steam" && launcher !== "heroic" && launcher !== "lutris") return null;
  const main = procs.find((p) => matches(launcher, p) && isMain(p) && (launcher !== "steam" || p.comm === "steam"));
  if (!main) return null;
  if (inFlatpak(launcher, main)) return { cmd: "flatpak", args: ["run", FLATPAK_ID[launcher]] };
  if (launcher === "steam") return { cmd: "steam", args: main.args.includes("-silent") ? ["-silent"] : [] };
  const usable = (path: string | undefined, name: RegExp) => !!path && isAbsolute(path) && !path.startsWith("/tmp/") && name.test(basename(path)) && layer.exists(path);
  if (launcher === "heroic") {
    // An AppImage runs from a temporary mount; the AppImage file itself is what starts it again.
    const appImage = layer.env(main.pid, "APPIMAGE");
    if (usable(appImage, /^heroic.*\.appimage$/i)) return { cmd: appImage!, args: [] };
    return usable(main.args[0], /^heroic$/i) ? { cmd: main.args[0], args: [] } : { cmd: "heroic", args: [] };
  }
  const script = main.args.find((a) => /(^|\/)lutris$/.test(a));
  return usable(script, /^lutris$/) ? { cmd: script!, args: [] } : { cmd: "lutris", args: [] };
}

// Windows: Steam by its steam.exe, Heroic by its Heroic.exe (no arguments:
// tasklist doesn't show them), only while the launcher runs.
export function windowsReopenPlan(launcher: LauncherId, procs: ProcView[], win: WindowsLaunchers): ReopenPlan | null {
  if (!procs.some((p) => matches(launcher, p))) return null;
  const exe = launcher === "steam" ? win.steamExe() : launcher === "heroic" ? win.heroicExe() : null;
  return exe ? { cmd: exe, args: [] } : null;
}

export interface LauncherControl {
  running(): Maybe<Set<LauncherId>>;
  gameRunning(): Maybe<boolean>;
  plan(launcher: LauncherId): Maybe<ReopenPlan | null>;
  close(launcher: LauncherId): Promise<CloseLauncherResult>;
  reopen(plan: ReopenPlan): Promise<boolean>;
}

export function launcherControl(layer: ProcLayer = realLayer(), timeoutMs = 30_000): LauncherControl {
  const running = async () => launchersIn(await layer.list());
  const gameRunning = async (procs: ProcView[]) => gameIn(procs) || !!(await layer.windows?.gameRunning());
  return {
    running,
    gameRunning: async () => gameRunning(await layer.list()),
    plan: async (launcher) => (layer.windows ? windowsReopenPlan(launcher, await layer.list(), layer.windows) : reopenPlan(launcher, await layer.list(), layer)),
    reopen: (plan) => layer.start(plan.cmd, plan.args),
    async close(launcher) {
      const procs = await layer.list();
      if (!launchersIn(procs).has(launcher)) return "not-running";
      // Quitting a launcher mid-game can end the game; the user quits the game first.
      if (await gameRunning(procs)) return "game-running";
      if (launcher === "steam") {
        const main = procs.find((p) => p.comm === "steam");
        if (layer.windows) {
          const exe = layer.windows.steamExe();
          if (!exe) return "failed";
          layer.run(exe, ["-shutdown"]);
        } else if (main && inFlatpak("steam", main)) layer.run("flatpak", ["run", FLATPAK_ID.steam, "-shutdown"]);
        else layer.run("steam", ["-shutdown"]);
      } else {
        for (const p of procs) if (matches(launcher, p) && isMain(p)) layer.signal(p.pid);
      }
      for (let waited = 0; waited < timeoutMs; waited += 500) {
        await layer.sleep(500);
        if (!(await running()).has(launcher)) {
          await layer.sleep(1000); // let it finish writing its settings files
          return "closed";
        }
      }
      return "timeout";
    },
  };
}

export type ClosedRun<T> = { ok: true; value: T; reopenFailed: LauncherId[] } | { ok: false; problem: CloseProblem; launcher: LauncherId };

// Run `work` with these launchers closed (the ones that are running), then
// start again the ones that were closed, also when `work` fails. Refuses
// before closing anything while a game runs; if one launcher doesn't close,
// the ones already closed are started again and nothing runs.
export async function withLaunchersClosed<T>(launchers: LauncherId[], control: LauncherControl, work: () => T | Promise<T>): Promise<ClosedRun<T>> {
  const running = await control.running();
  const toClose = [...new Set(launchers)].filter((l) => running.has(l));
  if (toClose.length && (await control.gameRunning())) return { ok: false, problem: "game-running", launcher: toClose[0] };
  const closed: Array<{ launcher: LauncherId; plan: ReopenPlan | null }> = [];
  const reopenAll = async () => {
    const failed: LauncherId[] = [];
    for (const { launcher, plan } of closed) if (!plan || !(await control.reopen(plan).catch(() => false))) failed.push(launcher);
    return failed;
  };
  for (const launcher of toClose) {
    const plan = await control.plan(launcher);
    const result = await control.close(launcher).catch(() => "failed" as const);
    if (result === "closed") closed.push({ launcher, plan });
    else if (result !== "not-running") {
      await reopenAll();
      return { ok: false, problem: result === "game-running" || result === "timeout" ? result : "failed", launcher };
    }
  }
  let value: T;
  try {
    value = await work();
  } catch (cause) {
    await reopenAll();
    throw cause;
  }
  return { ok: true, value, reopenFailed: await reopenAll() };
}

// ---- The real system ----

function envOf(pid: number, key: string): string | undefined {
  try {
    const kv = readFileSync(`/proc/${pid}/environ`, "utf8")
      .split("\0")
      .find((e) => e.startsWith(`${key}=`));
    return kv?.slice(key.length + 1);
  } catch {
    return undefined;
  }
}

const posixLayer: ProcLayer = {
  list: () => readProcs(),
  env: envOf,
  exists: existsSync,
  run: (cmd, args) => execFile(cmd, args, { timeout: 15_000, env: launcherEnv(process.env, realHome()) }, () => undefined),
  start: startForUser,
  signal: (pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const system32 = (exe: string) => join(process.env.SystemRoot ?? "C:\\Windows", "System32", exe);

// taskkill's arguments for asking one process to quit: its windows get a
// close request, like the user closing them. Never /F (a forced kill).
export const taskkillArgs = (pid: number): string[] => ["/PID", String(pid)];

// `reg query HKCU\Software\Valve\Steam /v RunningAppID`: the game Steam has running (0x0: none).
export const steamAppRunning = (regOutput: string): boolean => {
  const m = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(regOutput);
  return !!m && parseInt(m[1], 16) !== 0;
};

function steamReportsGame(): Promise<boolean> {
  return new Promise((resolve) =>
    execFile(system32("reg.exe"), ["query", "HKCU\\Software\\Valve\\Steam", "/v", "RunningAppID"], { encoding: "utf8", windowsHide: true, timeout: 3000 }, (error, stdout) =>
      resolve(!error && steamAppRunning(stdout)),
    ),
  );
}

// Steam's program in the first install folder that has one (the registry's SteamPath first).
export const steamExeIn = (roots: string[], exists: (path: string) => boolean): string | null => roots.map((root) => join(root, "steam.exe")).find((exe) => exists(exe)) ?? null;

// Heroic's Windows installer: per user (the default) or for all users.
export function heroicExeIn(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | null {
  const candidates = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "heroic", "Heroic.exe"), env.ProgramFiles && join(env.ProgramFiles, "Heroic", "Heroic.exe")];
  return candidates.find((c): c is string => !!c && exists(c)) ?? null;
}

// `libraryGame`: whether the library's running-game watcher sees a game.
function windowsLayer(libraryGame: () => boolean): ProcLayer {
  return {
    list: readWindowsProcs,
    env: () => undefined,
    exists: existsSync,
    run: (cmd, args) => execFile(cmd, args, { timeout: 15_000, windowsHide: true, env: launcherEnv(process.env, realHome()) }, () => undefined),
    start: startForUser,
    signal: (pid) => execFile(system32("taskkill.exe"), taskkillArgs(pid), { timeout: 5000, windowsHide: true }, () => undefined),
    sleep: posixLayer.sleep,
    windows: {
      steamExe: () => steamExeIn(windowsSteamRoots(), existsSync),
      heroicExe: () => heroicExeIn(process.env, existsSync),
      gameRunning: async () => libraryGame() || (await steamReportsGame()),
    },
  };
}

// The process layer of this system: Windows, or /proc and signals (macOS has
// no Games page yet; without /proc it finds no launcher and closes nothing).
export const realLayer = (libraryGame: () => boolean = () => false): ProcLayer => (process.platform === "win32" ? windowsLayer(libraryGame) : posixLayer);

// The launchers running now (the scan's view).
export const runningLaunchers = (): Set<LauncherId> => launchersIn(readProcs());
