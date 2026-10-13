// Launchers that are running, and the one way the app closes and reopens them
// around a settings change (Steam, Heroic and Lutris rewrite their settings
// files when they quit, and Heroic keeps using a game's old settings while it
// runs). Never force-kills: Steam gets its own `-shutdown`, Heroic and Lutris
// get SIGTERM (what a normal window-manager quit sends), then we wait. A
// launcher is only closed while no game is running (closing it could end the
// game), and is started again afterwards the way it was running (native or
// Flatpak). Every program runs by a fixed argv, without a shell, with the
// user's real home (launcherEnv), so a dev copy's test HOME never reaches it.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { CloseProblem, LauncherId } from "../../../src/desktop/games/types";
import { readProcs, type ProcView } from "./running";
import { launcherEnv, realHome, startForUser } from "./schemeHandler";

export type CloseLauncherResult = "closed" | "not-running" | CloseProblem;

// What the launcher control needs from the system (a fake in the tests).
export interface ProcLayer {
  list(): ProcView[]; // the user's own processes
  env(pid: number, key: string): string | undefined; // one variable of a process
  exists(path: string): boolean;
  run(cmd: string, args: string[]): void; // a short command (steam -shutdown); result not needed
  start(cmd: string, args: string[]): Promise<boolean>; // a detached launcher; false if it couldn't start
  signal(pid: number): void; // SIGTERM
  sleep(ms: number): Promise<void>;
}

// How a launcher is started again: a fixed program and arguments.
export interface ReopenPlan {
  cmd: string;
  args: string[];
}

const FLATPAK_ID: Record<"steam" | "heroic" | "lutris", string> = { steam: "com.valvesoftware.Steam", heroic: "com.heroicgameslauncher.hgl", lutris: "net.lutris.Lutris" };

const isMain = (p: ProcView) => !p.args.some((a) => a.startsWith("--type="));

function matches(launcher: LauncherId, p: ProcView): boolean {
  switch (launcher) {
    case "steam":
      return p.comm === "steam" || p.comm === "steamwebhelper";
    case "heroic":
      return p.comm === "heroic" || /[/]heroic$/i.test(p.args[0] ?? "");
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

export interface LauncherControl {
  running(): Set<LauncherId>;
  gameRunning(): boolean;
  plan(launcher: LauncherId): ReopenPlan | null;
  close(launcher: LauncherId): Promise<CloseLauncherResult>;
  reopen(plan: ReopenPlan): Promise<boolean>;
}

export function launcherControl(layer: ProcLayer = realLayer, timeoutMs = 30_000): LauncherControl {
  const running = () => launchersIn(layer.list());
  return {
    running,
    gameRunning: () => gameIn(layer.list()),
    plan: (launcher) => reopenPlan(launcher, layer.list(), layer),
    reopen: (plan) => layer.start(plan.cmd, plan.args),
    async close(launcher) {
      const procs = layer.list();
      if (!launchersIn(procs).has(launcher)) return "not-running";
      // Quitting a launcher mid-game can end the game; the user quits the game first.
      if (gameIn(procs)) return "game-running";
      if (launcher === "steam") {
        const main = procs.find((p) => p.comm === "steam");
        if (main && inFlatpak("steam", main)) layer.run("flatpak", ["run", FLATPAK_ID.steam, "-shutdown"]);
        else layer.run("steam", ["-shutdown"]);
      } else {
        for (const p of procs) if (matches(launcher, p) && isMain(p)) layer.signal(p.pid);
      }
      for (let waited = 0; waited < timeoutMs; waited += 500) {
        await layer.sleep(500);
        if (!running().has(launcher)) {
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
  const running = control.running();
  const toClose = [...new Set(launchers)].filter((l) => running.has(l));
  if (toClose.length && control.gameRunning()) return { ok: false, problem: "game-running", launcher: toClose[0] };
  const closed: Array<{ launcher: LauncherId; plan: ReopenPlan | null }> = [];
  const reopenAll = async () => {
    const failed: LauncherId[] = [];
    for (const { launcher, plan } of closed) if (!plan || !(await control.reopen(plan).catch(() => false))) failed.push(launcher);
    return failed;
  };
  for (const launcher of toClose) {
    const plan = control.plan(launcher);
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

const realLayer: ProcLayer = {
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

// The launchers running now (the scan's view).
export const runningLaunchers = (): Set<LauncherId> => launchersIn(readProcs());
