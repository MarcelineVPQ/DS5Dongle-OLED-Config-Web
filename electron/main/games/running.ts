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
// running programs (a native process snapshot, winProcs.ts) are matched
// against the program files in each installed game's folder (indexed once, cached).
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LauncherId } from "../../../src/desktop/games/types";
import { logged } from "../../../src/errorText";
import { windowsProcReader } from "./winProcs";
import { mtimeOf } from "./files";

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
// it or one of its parents is one of these or a Wine/Proton process (or it's
// an orphan with a launch variable, below).
const LAUNCHER_COMMS = /^(steam|reaper|heroic|legendary|gogdl|nile|lutris|umu-run|gamescope|gamemoderun|bottles)$/;
// A Wine process, also once it's left its launcher (reparented to init): its
// program is Wine's loader whatever its name shows.
const WINE_EXE = /\/(wine|wine64|wine-preloader|wine64-preloader|wineserver)$/;
const UID_RE = (uid: number) => new RegExp(`^Uid:\\s+${uid}\\b`, "m");
// cache: OK — key=the process uid; invalidated=rebuilt when the uid differs; bound=1 entry
let uidRe: { uid: number; re: RegExp } | null = null;
// Orphans whose environment has no launch variable, by "<root>/<pid>:<name>".
// cache: OK — key=<proc root>/<pid>:<name>; invalidated=each pass forgets orphans that are gone (a reused pid has a new name or is re-read); bound=live orphan processes without a launch variable
const plainOrphans = new Set<string>();
// Whether a process's /proc folder is the user's, by "<root>/<pid>": the
// owner check (a stat of each of the PC's processes, ~15% of a pass) runs once per
// process instead of every 2 s. Linux hands out pids in order up to pid_max
// (4 million) before reusing one, and a pid that left is forgotten at the
// next pass, so a new process on an old pid is checked again.
// cache: OK — key=<proc root>/<pid>; invalidated=each pass forgets pids that are gone; bound=live processes
const ownsDir = new Map<string, boolean>();
// What the watcher learned about each of the user's processes, by
// "<root>/<pid>": its start time and name from /proc/<pid>/stat (one short
// read a pass instead of the status text), and the costly reads (its real
// owner from the status text, whether its program is Wine, and the full view
// of a possible game) made once. A pid
// with the same start time and name is the same process running the same
// program, so nothing else is read again; another start time (the pid was
// reused) or name (the process ran another program) starts over. Processes
// younger than FRESH_S are read in full every pass: Wine renames its process
// and rewrites its command line while starting, and a game may change folder.
// cache: OK — key=<proc root>/<pid> + starttime + name; invalidated=each pass forgets pids that are gone, a new starttime or name replaces the entry; bound=the user's live processes
const known = new Map<string, { start: number; name: string; mine: boolean; wine?: boolean; view?: ProcView }>();
const FRESH_S = 30;

// /proc/<pid>/stat: the name (field 2, in parentheses, may hold spaces and
// ")"), the parent (field 4) and the start time in clock ticks after boot
// (field 22).
export function parseProcStat(text: string): { name: string; ppid: number; start: number } | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const f = text.slice(close + 2).split(" ");
  const ppid = Number(f[1]);
  const start = Number(f[19]);
  return Number.isFinite(ppid) && Number.isFinite(start) ? { name: text.slice(open + 1, close), ppid, start } : null;
}

// Seconds since boot, and the kernel's clock ticks per second (USER_HZ: 100
// on every Linux Electron runs on), for a process's age.
const CLK_TCK = 100;
function uptimeS(root: string): number {
  try {
    return Number(readFileSync(`${root}/uptime`, "utf8").split(" ")[0]);
  } catch {
    // error: NOT-WORTH — no uptime: every process counts as old (cached reads)
    return Infinity;
  }
}

// Everything detectRunning looks at, for one process.
function readFull(dir: string, pid: number): ProcView {
  const env: Record<string, string> = {};
  try {
    // loop: HOT-PATH-OK — environ vars (~50-100) of a candidate game process only
    for (const kv of readFileSync(`${dir}/environ`, "utf8").split("\0")) {
      const i = kv.indexOf("=");
      if (i > 0 && ENV_KEYS.includes(kv.slice(0, i))) env[kv.slice(0, i)] = kv.slice(i + 1);
    }
  } catch {
    // error: NOT-WORTH — environ unreadable (another session's process)
  }
  let cwd: string | null = null;
  try {
    cwd = readlinkSync(`${dir}/cwd`);
  } catch {
    // error: NOT-WORTH — gone
  }
  return {
    pid,
    comm: readFileSync(`${dir}/comm`, "utf8").trim(),
    // loop: HOT-PATH-OK — cmdline args of a candidate game process only
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
    // error: NOT-WORTH — no /proc: no running games seen (the watcher polls again)
    return out;
  }
  const own: Array<{ pid: number; name: string; ppid: number }> = [];
  const seen = new Set<string>();
  const freshFrom = gamesOnly ? (uptimeS(root) - FRESH_S) * CLK_TCK : 0;
  // loop: HOT-PATH-OK — all PIDs; cheap first pass (owner checked once per process, status of own only); runs hidden on purpose
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // Watcher: someone else's process (its /proc folder isn't ours) is
      // skipped without generating its status text (the costly part).
      if (gamesOnly && uid !== undefined) {
        const dir = `${root}/${entry}`;
        seen.add(dir);
        let mine = ownsDir.get(dir);
        if (mine === undefined) ownsDir.set(dir, (mine = statSync(dir).uid === uid));
        if (!mine) continue;
      }
      if (!gamesOnly) {
        const status = readFileSync(`${root}/${entry}/status`, "utf8");
        if (uidRe && !uidRe.re.test(status)) continue;
        out.push(readFull(`${root}/${entry}`, Number(entry)));
        continue;
      }
      const stat = parseProcStat(readFileSync(`${root}/${entry}/stat`, "utf8"));
      if (!stat) continue;
      const dir = `${root}/${entry}`;
      let k = known.get(dir);
      // A reused pid (another start time), another program (another name) or a young process: read again,
      // starting with its real owner (the status text, once per process and program).
      if (!k || k.start !== stat.start || k.name !== stat.name || stat.start > freshFrom) {
        const mine = !uidRe || uidRe.re.test(readFileSync(`${dir}/status`, "utf8"));
        known.set(dir, (k = { start: stat.start, name: stat.name, mine }));
      }
      if (!k.mine) continue;
      own.push({ pid: Number(entry), name: stat.name, ppid: stat.ppid });
    } catch {
      // error: NOT-WORTH — process exited while we looked
    }
  }
  if (!gamesOnly) return out;
  // Forget the owners of processes that are gone (a later process may get the pid).
  // loop: HOT-PATH-OK — one Map of live processes, a delete only for those that left
  for (const dir of ownsDir.keys()) if (dir.startsWith(`${root}/`) && !seen.has(dir)) ownsDir.delete(dir);
  // loop: HOT-PATH-OK — one Map of the user's live processes, a delete only for those that left
  for (const dir of known.keys()) if (dir.startsWith(`${root}/`) && !seen.has(dir)) known.delete(dir);
  // Possible games: a launcher or Wine process, anything started under one,
  // and Wine processes that outlived their launcher.
  // loop: HOT-PATH-OK — one Map over own processes for the ancestry walk
  const byPid = new Map(own.map((p) => [p.pid, p]));
  // cache: OK — key=pid; invalidated=per readProcs call; bound=the user's processes in one pass
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
  // Once per process and program (`known`).
  const wineExe = (pid: number) => {
    const k = known.get(`${root}/${pid}`);
    if (k?.wine !== undefined) return k.wine;
    let wine = false;
    try {
      wine = WINE_EXE.test(readlinkSync(`${root}/${pid}/exe`));
    } catch {
      // error: NOT-WORTH — exe link unreadable: not counted as a Wine process
    }
    if (k) k.wine = wine;
    return wine;
  };
  // A native game whose launcher quit (Heroic) is reparented to init or the
  // user's systemd: such an orphan is kept when its environment carries a
  // launch variable. Only orphans' environments are read, and one without
  // the variables isn't read again (its environment is fixed until it runs
  // another program, which changes its name).
  const orphan = (p: { ppid: number }) => p.ppid <= 1 || !byPid.has(p.ppid) || byPid.get(p.ppid)!.name === "systemd";
  // cache: OK — key=<proc root>/<pid>:<name>; invalidated=per readProcs call (prunes plainOrphans); bound=the user's orphans in one pass
  const seenPlain = new Set<string>();
  const launched = (p: { pid: number; name: string }) => {
    const id = `${root}/${p.pid}:${p.name}`;
    seenPlain.add(id);
    if (plainOrphans.has(id)) return false;
    try {
      const env = `\0${readFileSync(`${root}/${p.pid}/environ`, "utf8")}`;
      // loop: HOT-PATH-OK — N = 4 env keys, only for an orphan not seen before
      if (ENV_KEYS.some((k) => env.includes(`\0${k}=`))) return true;
      plainOrphans.add(id);
    } catch {
      // error: NOT-WORTH — gone, or not readable
    }
    return false;
  };
  // loop: HOT-PATH-OK — own processes, memoized ancestry; full reads only for candidates
  for (const p of own) {
    if (!underLauncher(p.pid) && !wineExe(p.pid) && !(orphan(p) && launched(p))) continue;
    const k = known.get(`${root}/${p.pid}`);
    try {
      // Read in full once per process and program (`known`).
      out.push(k?.view ?? readFull(`${root}/${p.pid}`, p.pid));
      if (k) k.view ??= out[out.length - 1];
    } catch {
      // error: NOT-WORTH — process exited while we looked
    }
  }
  // Forget orphans that are gone (a new process may get the same pid).
  // loop: HOT-PATH-OK — remembered plain orphans, a handful
  for (const id of plainOrphans) if (id.startsWith(`${root}/`) && !seenPlain.has(id)) plainOrphans.delete(id);
  return out;
}

// The running-game watcher's reader on Linux: possible games only.
export const readGameProcs = (): ProcView[] => readProcs(true);

// /proc paths and the launchers' install folders are POSIX paths ("/"), on
// whatever system the code (or its tests) runs.
export const inside = (path: string | null | undefined, dir: string) => !!path && (path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`));
// Wine passes Windows-style paths: Z:\home\user\Games\X\x.exe
const unixPath = (arg: string) => (/^[A-Za-z]:\\/.test(arg) ? arg.slice(2).replaceAll("\\", "/") : arg);

// The running game among the candidates, or null. Steam and Heroic by their
// launch variables first; then by install folder, for any launcher.
export function detectRunning(procs: ProcView[], games: RunningCandidate[]): string | null {
  // loop: HOT-PATH-OK — game-candidate processes only (readProcs filters), returns on a hit
  for (const p of procs) {
    const appid = p.env.SteamGameId || p.env.SteamAppId;
    // loop: HOT-PATH-OK — args of one reaper process
    const reaper = p.comm === "reaper" ? p.args.find((a) => a.startsWith("AppId="))?.slice(6) : undefined;
    const steamId = reaper || (appid && appid !== "0" ? appid : undefined);
    if (steamId) {
      // loop: HOT-PATH-OK — library games, only for a process with a Steam id
      const hit = games.find((g) => g.launcher === "steam" && g.id === steamId);
      if (hit) return hit.key;
    }
    if (p.env.HEROIC_APP_NAME) {
      // loop: HOT-PATH-OK — library games, only for a process with HEROIC_APP_NAME
      const hit = games.find((g) => g.launcher === "heroic" && g.id === p.env.HEROIC_APP_NAME);
      if (hit) return hit.key;
    }
  }
  // loop: HOT-PATH-OK — one filtered copy of the library per tick, no I/O
  const withDirs = games.filter((g) => g.installDir && g.installDir.length > 1);
  // loop: HOT-PATH-OK — candidate processes, skips non-Wine ones first
  for (const p of procs) {
    // loop: HOT-PATH-OK — args of one process
    if (!WINE_COMMS.test(p.comm) && !p.args.some((a) => /\.exe$/i.test(a))) continue;
    // loop: HOT-PATH-OK — games with a folder, only for Wine/exe processes
    for (const g of withDirs) {
      // loop: HOT-PATH-OK — args of one Wine process, string prefix checks
      if (inside(p.cwd, g.installDir!) || p.args.some((a) => inside(unixPath(a), g.installDir!))) return g.key;
    }
  }
  return null;
}

// ---- Windows ----

// Running programs through tasklist: image names only (paths would need
// PowerShell or WMI). Asynchronous, so the main process never waits for it.
// Only the fallback now: each run costs ~160 ms of CPU plus ~60-230 ms in
// this process to spawn it (winProcs.ts).
export function readTasklist(): Promise<ProcView[]> {
  return new Promise((resolve) => {
    // lifetime: OK — tasklist exits on its own; the 4 s timeout kills a hung one
    // error: NOT-WORTH — tasklist failed: this pass sees no processes; the next pass (3 s) looks again
    execFile(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe"), ["/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 4000 }, (error, stdout) =>
      resolve(error ? [] : parseTasklist(stdout)),
    );
  });
}

// Running programs (image names): one native snapshot in this process,
// tasklist where that can't load.
export const readWindowsProcs = windowsProcReader(readTasklist);

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
// three levels deep (bin/x64/game.exe) and a few thousand entries. `folders`,
// when given, gets the modification time of the game folder and of each
// folder a program was found in (what RunningGameWatcher checks for changes).
export function gameExecutables(dir: string, depth = 3, budget = { left: 4000 }, folders?: Map<string, number | null>): Set<string> {
  const out = new Set<string>();
  const walk = (d: string, level: number) => {
    const mtime = folders ? mtimeOf(d) : null; // before the read: a change during it shows as newer next time
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      // error: NOT-WORTH — an unreadable folder is skipped while listing a game's executables
      return;
    }
    const before = out.size;
    for (const e of entries) {
      if (--budget.left < 0) break;
      if (e.isDirectory() && level < depth) walk(join(d, e.name), level + 1);
      else if (e.isFile() && /\.exe$/i.test(e.name) && !GENERIC_EXE.test(e.name)) out.add(e.name.toLowerCase());
    }
    if (folders && (level === 0 || out.size > before)) folders.set(d, mtime);
  };
  walk(dir, 0);
  return out;
}

// How often a game folder's program index is looked at again (Windows): the
// folders it came from are checked for changes (one stat each) and the folder
// is read again when one changed (an update renamed the .exe) or when nothing
// was found (the game was still installing).
export const EXE_RECHECK_MS = 60_000;

export function detectRunningWindows(procs: ProcView[], games: RunningCandidate[], exes: (dir: string) => Set<string>): string | null {
  // loop: HOT-PATH-OK — Windows process list into a Set, needed for the lookups
  const running = new Set(procs.map((p) => p.comm.toLowerCase()));
  // loop: HOT-PATH-OK — library games, exe sets cached per folder
  for (const g of games) {
    if (!g.installDir) continue;
    // loop: HOT-PATH-OK — one game's cached exe names, Set lookups
    for (const exe of exes(g.installDir)) if (running.has(exe)) return g.key;
  }
  return null;
}

// How often the Linux watcher looks: every 2 s while something needs to know
// soon (a game with a profile, which switches the board's settings; the
// window on screen, which shows Playing and the game's art), every 10 s
// otherwise (in the tray with no profiles, only the tray's own state follows).
export const RUNNING_FAST_MS = 2000;
export const RUNNING_SLOW_MS = 10000;
export const runningInterval = (needsSoon: boolean): number => (needsSoon ? RUNNING_FAST_MS : RUNNING_SLOW_MS);

// Polls and reports changes, debounced so a launcher's short helper
// processes don't flap it (a change has to hold for `settleMs`). `everyMs`
// may be a function: it is asked again before each pass.
export class RunningGameWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitMs = 0;
  private current: string | null = null;
  // cache: OK — key=none (the candidate running game); invalidated=replaced on every change, cleared on stop(); bound=1 entry
  private pending: { key: string | null; since: number } | null = null;

  // cache: OK — key=install folder; invalidated=checked every EXE_RECHECK_MS: read again when the folder or a folder that held a program changed (mtime), or when nothing was found; bound=installed games' folders
  private readonly exeCache = new Map<string, { exes: Set<string>; folders: Map<string, number | null>; checked: number }>();
  // An asynchronous read (Windows) in flight: the next tick waits for it.
  private reading = false;
  // Bumped by stop(), so a read that finishes afterwards changes nothing.
  private generation = 0;

  constructor(
    private readonly candidates: () => RunningCandidate[],
    private readonly onChange: (key: string | null) => void,
    private readonly read: () => ProcView[] | Promise<ProcView[]> = process.platform === "win32" ? readWindowsProcs : readGameProcs,
    private readonly settleMs = 4000,
    private readonly everyMs: number | (() => number) = process.platform === "win32" ? 3000 : RUNNING_FAST_MS,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  private exes(dir: string, now: number): Set<string> {
    const kept = this.exeCache.get(dir);
    if (kept && now - kept.checked < EXE_RECHECK_MS) return kept.exes;
    // loop: NOT-WORTH — the game folder and the few folders its programs are in, once a minute per game
    if (kept && kept.exes.size > 0 && [...kept.folders].every(([d, mtime]) => mtimeOf(d) === mtime)) {
      kept.checked = now;
      return kept.exes;
    }
    const folders = new Map<string, number | null>();
    const exes = gameExecutables(dir, undefined, undefined, folders);
    this.exeCache.set(dir, { exes, folders, checked: now });
    return exes;
  }

  get running(): string | null {
    return this.current;
  }

  private interval = (): number => (typeof this.everyMs === "function" ? this.everyMs() : this.everyMs);

  // One pass now, then the next after the interval. A failed pass changes
  // nothing; the next one looks again.
  private pass = (): void => {
    void Promise.resolve(this.tick()).catch(logged("running-game watcher pass"));
    this.waitMs = this.interval();
    // lifetime: OK — re-armed by each pass; cleared in stop() (Games consent off) and retime(); runs while hidden on purpose (game profiles)
    this.timer = setTimeout(this.pass, this.waitMs);
  };

  start(): void {
    if (this.timer) return;
    this.pass();
  }

  // Something now needs the answer sooner (the window shown, a profile
  // made): when the interval got shorter, look now and keep the new pace.
  retime(): void {
    if (!this.timer || this.interval() >= this.waitMs) return;
    clearTimeout(this.timer);
    this.pass();
  }

  // Stopping (Games consent turned off) also ends a running game's state, so
  // the renderer restores the normal settings instead of keeping its profile.
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
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
    const seen = this.platform === "win32" ? detectRunningWindows(procs, this.candidates(), (dir) => this.exes(dir, now)) : detectRunning(procs, this.candidates());
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
