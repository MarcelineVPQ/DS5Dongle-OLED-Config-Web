// Which game is running (Games library: the "Playing" row and per-game
// profiles). Read-only, the user's own processes only:
//   Steam   every game process inherits SteamAppId / SteamGameId (and the
//           reaper wrapper carries AppId=<id> on its command line);
//   Heroic  launch variables HEROIC_APP_NAME (+ HEROIC_APP_SOURCE);
//   Lutris  LUTRIS_GAME_UUID / GAME_NAME are not reliable across versions,
//           so a Wine/Proton process whose command line or working folder is
//           inside the game's install folder identifies it (also the
//           fallback for the others).
//
// Windows has no /proc and a game's environment can't be read, so there the
// running programs (tasklist, cheap) are matched against the program files in
// each installed game's folder (indexed once, cached).
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LauncherId } from "../../../src/desktop/games/types";

export interface ProcView {
  pid: number;
  comm: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>; // only the variables below
}

export interface RunningCandidate {
  key: string;
  launcher: LauncherId;
  id: string; // Steam appid, Heroic app name, Lutris config id
  installDir?: string;
}

const ENV_KEYS = ["SteamAppId", "SteamGameId", "HEROIC_APP_NAME", "HEROIC_APP_SOURCE"];
const WINE_COMMS = /^(wine|wine64|wine-preloader|wine64-preloader|wineserver|proton|reaper|pressure-vessel|srt-bwrap)$|\.exe$/i;

// Launchers (and wrappers) whose child processes can be a game: a process
// is only looked at closely (environment, command line, working folder) when
// it or one of its parents is one of these or a Wine/Proton process.
const LAUNCHER_COMMS = /^(steam|reaper|heroic|legendary|gogdl|nile|lutris|umu-run|gamescope|gamemoderun|bottles)$/;
// A Wine process, also once it's left its launcher (reparented to init): its
// program is Wine's loader whatever its name shows.
const WINE_EXE = /\/(wine|wine64|wine-preloader|wine64-preloader|wineserver)$/;
const UID_RE = (uid: number) => new RegExp(`^Uid:\\s+${uid}\\b`, "m");
let uidRe: { uid: number; re: RegExp } | null = null;

// Everything detectRunning looks at, for one process.
function readFull(dir: string, pid: number): ProcView {
  const env: Record<string, string> = {};
  try {
    for (const kv of readFileSync(`${dir}/environ`, "utf8").split("\0")) {
      const i = kv.indexOf("=");
      if (i > 0 && ENV_KEYS.includes(kv.slice(0, i))) env[kv.slice(0, i)] = kv.slice(i + 1);
    }
  } catch {
    // environ unreadable (another session's process)
  }
  let cwd: string | null = null;
  try {
    cwd = readlinkSync(`${dir}/cwd`);
  } catch {
    // gone
  }
  return {
    pid,
    comm: readFileSync(`${dir}/comm`, "utf8").trim(),
    args: readFileSync(`${dir}/cmdline`, "utf8").split("\0").filter(Boolean),
    cwd,
    env,
  };
}

// The user's own processes. `gamesOnly` (the running-game watcher, every 2 s):
// a cheap first pass reads only each process's status (name, parent, owner),
// and the expensive reads happen only for possible games (see LAUNCHER_COMMS);
// everything else is skipped. `root` is for the tests (a fake /proc).
export function readProcs(gamesOnly = false, root = "/proc"): ProcView[] {
  const uid = process.getuid?.();
  if (uid !== undefined && uidRe?.uid !== uid) uidRe = { uid, re: UID_RE(uid) };
  const out: ProcView[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  const own: Array<{ pid: number; name: string; ppid: number }> = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // Watcher: someone else's process (its /proc folder isn't ours) is
      // skipped without generating its status text (the costly part).
      if (gamesOnly && uid !== undefined && statSync(`${root}/${entry}`).uid !== uid) continue;
      const status = readFileSync(`${root}/${entry}/status`, "utf8");
      if (uidRe && !uidRe.re.test(status)) continue;
      if (!gamesOnly) {
        out.push(readFull(`${root}/${entry}`, Number(entry)));
        continue;
      }
      const name = /^Name:\s*(.*)$/m.exec(status)?.[1] ?? "";
      const ppid = Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] ?? 0);
      own.push({ pid: Number(entry), name, ppid });
    } catch {
      // process exited while we looked
    }
  }
  if (!gamesOnly) return out;
  // Possible games: a launcher or Wine process, anything started under one,
  // and Wine processes that outlived their launcher.
  const byPid = new Map(own.map((p) => [p.pid, p]));
  const memo = new Map<number, boolean>();
  const isRoot = (name: string) => LAUNCHER_COMMS.test(name) || WINE_COMMS.test(name);
  const underLauncher = (pid: number, depth = 0): boolean => {
    const known = memo.get(pid);
    if (known !== undefined) return known;
    const p = byPid.get(pid);
    const yes = !!p && depth < 64 && (isRoot(p.name) || underLauncher(p.ppid, depth + 1));
    memo.set(pid, yes);
    return yes;
  };
  const wineExe = (pid: number) => {
    try {
      return WINE_EXE.test(readlinkSync(`${root}/${pid}/exe`));
    } catch {
      return false;
    }
  };
  for (const p of own) {
    if (!underLauncher(p.pid) && !wineExe(p.pid)) continue;
    try {
      out.push(readFull(`${root}/${p.pid}`, p.pid));
    } catch {
      // process exited while we looked
    }
  }
  return out;
}

// The running-game watcher's reader on Linux: possible games only.
export const readGameProcs = (): ProcView[] => readProcs(true);

// /proc paths and the launchers' install folders are POSIX paths ("/"), on
// whatever system the code (or its tests) runs.
const inside = (path: string | null | undefined, dir: string) => !!path && (path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`));
// Wine passes Windows-style paths: Z:\home\user\Games\X\x.exe
const unixPath = (arg: string) => (/^[A-Za-z]:\\/.test(arg) ? arg.slice(2).replaceAll("\\", "/") : arg);

// The running game among the candidates, or null. Steam and Heroic by their
// launch variables first; then by install folder, for any launcher.
export function detectRunning(procs: ProcView[], games: RunningCandidate[]): string | null {
  for (const p of procs) {
    const appid = p.env.SteamGameId || p.env.SteamAppId;
    const reaper = p.comm === "reaper" ? p.args.find((a) => a.startsWith("AppId="))?.slice(6) : undefined;
    const steamId = reaper || (appid && appid !== "0" ? appid : undefined);
    if (steamId) {
      const hit = games.find((g) => g.launcher === "steam" && g.id === steamId);
      if (hit) return hit.key;
    }
    if (p.env.HEROIC_APP_NAME) {
      const hit = games.find((g) => g.launcher === "heroic" && g.id === p.env.HEROIC_APP_NAME);
      if (hit) return hit.key;
    }
  }
  const withDirs = games.filter((g) => g.installDir && g.installDir.length > 1);
  for (const p of procs) {
    if (!WINE_COMMS.test(p.comm) && !p.args.some((a) => /\.exe$/i.test(a))) continue;
    for (const g of withDirs) {
      if (inside(p.cwd, g.installDir!) || p.args.some((a) => inside(unixPath(a), g.installDir!))) return g.key;
    }
  }
  return null;
}

// ---- Windows ----

// Running programs: image names only (tasklist is fast; paths would need
// PowerShell or WMI, too slow to run every few seconds). Asynchronous, so the
// main process never waits for it.
export function readWindowsProcs(): Promise<ProcView[]> {
  return new Promise((resolve) => {
    execFile(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe"), ["/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 4000 }, (error, stdout) =>
      resolve(error ? [] : parseTasklist(stdout)),
    );
  });
}

// tasklist's CSV ("image","pid",...) as processes.
export function parseTasklist(csv: string): ProcView[] {
  const out: ProcView[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m) out.push({ pid: Number(m[2]), comm: m[1], args: [], cwd: null, env: {} });
  }
  return out;
}

// Helpers that ship with many games: never evidence of which game is running.
const GENERIC_EXE =
  /^(unitycrashhandler(32|64)?|crashreport(er|client)?|crashpad_handler|uninst(all)?\w*|unins\d+|vc_?redist[\w.-]*|dxsetup|dotnetfx\w*|ue4prereqsetup\w*|easyanticheat\w*|be(service|launcher)\w*|launcher|setup|installer|updater)\.exe$/i;

// A game folder's program files (lower case, without generic helpers), up to
// three levels deep (bin/x64/game.exe) and a few thousand entries.
export function gameExecutables(dir: string, depth = 3, budget = { left: 4000 }): Set<string> {
  const out = new Set<string>();
  const walk = (d: string, level: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (--budget.left < 0) return;
      if (e.isDirectory() && level < depth) walk(join(d, e.name), level + 1);
      else if (e.isFile() && /\.exe$/i.test(e.name) && !GENERIC_EXE.test(e.name)) out.add(e.name.toLowerCase());
    }
  };
  walk(dir, 0);
  return out;
}

export function detectRunningWindows(procs: ProcView[], games: RunningCandidate[], exes: (dir: string) => Set<string>): string | null {
  const running = new Set(procs.map((p) => p.comm.toLowerCase()));
  for (const g of games) {
    if (!g.installDir) continue;
    for (const exe of exes(g.installDir)) if (running.has(exe)) return g.key;
  }
  return null;
}

// Polls and reports changes, debounced so a launcher's short helper
// processes don't flap it (a change has to hold for `settleMs`).
export class RunningGameWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: string | null = null;
  private pending: { key: string | null; since: number } | null = null;

  private readonly exeCache = new Map<string, Set<string>>();
  // An asynchronous read (Windows) in flight: the next tick waits for it.
  private reading = false;
  // Bumped by stop(), so a read that finishes afterwards changes nothing.
  private generation = 0;

  constructor(
    private readonly candidates: () => RunningCandidate[],
    private readonly onChange: (key: string | null) => void,
    private readonly read: () => ProcView[] | Promise<ProcView[]> = process.platform === "win32" ? readWindowsProcs : readGameProcs,
    private readonly settleMs = 4000,
    private readonly everyMs = process.platform === "win32" ? 3000 : 2000,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  private exes = (dir: string): Set<string> => {
    let set = this.exeCache.get(dir);
    if (!set) this.exeCache.set(dir, (set = gameExecutables(dir)));
    return set;
  };

  get running(): string | null {
    return this.current;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.everyMs);
  }

  // Stopping (Games consent turned off) also ends a running game's state, so
  // the renderer restores the normal settings instead of keeping its profile.
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
    this.generation++;
    if (this.current !== null) {
      this.current = null;
      this.onChange(null);
    }
  }

  // One look at the processes. Returns a promise when the reader is
  // asynchronous (Windows), settled once the result is applied.
  tick(now?: number): void | Promise<void> {
    if (this.reading) return;
    const procs = this.read();
    if (!(procs instanceof Promise)) return this.apply(procs, now ?? Date.now());
    this.reading = true;
    const generation = this.generation;
    return procs
      .then((list) => {
        if (generation === this.generation) this.apply(list, now ?? Date.now());
      })
      .finally(() => (this.reading = false));
  }

  private apply(procs: ProcView[], now: number): void {
    const seen = this.platform === "win32" ? detectRunningWindows(procs, this.candidates(), this.exes) : detectRunning(procs, this.candidates());
    if (seen === this.current) {
      this.pending = null;
      return;
    }
    if (!this.pending || this.pending.key !== seen) {
      this.pending = { key: seen, since: now };
      return;
    }
    if (now - this.pending.since >= this.settleMs) {
      this.current = seen;
      this.pending = null;
      this.onChange(seen);
    }
  }
}
