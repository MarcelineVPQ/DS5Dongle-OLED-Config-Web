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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export interface ProcView {
  pid: number;
  comm: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>; // only the variables below
}

export interface RunningCandidate {
  key: string;
  launcher: "steam" | "heroic" | "lutris";
  id: string; // Steam appid, Heroic app name, Lutris config id
  installDir?: string;
}

const ENV_KEYS = ["SteamAppId", "SteamGameId", "HEROIC_APP_NAME", "HEROIC_APP_SOURCE"];
const WINE_COMMS = /^(wine|wine64|wine-preloader|wine64-preloader|wineserver|proton|reaper|pressure-vessel|srt-bwrap)$|\.exe$/i;

export function readProcs(): ProcView[] {
  const uid = process.getuid?.();
  const out: ProcView[] = [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      if (uid !== undefined && !new RegExp(`^Uid:\\s+${uid}\\b`, "m").test(status)) continue;
      const env: Record<string, string> = {};
      try {
        for (const kv of readFileSync(`/proc/${entry}/environ`, "utf8").split("\0")) {
          const i = kv.indexOf("=");
          if (i > 0 && ENV_KEYS.includes(kv.slice(0, i))) env[kv.slice(0, i)] = kv.slice(i + 1);
        }
      } catch {
        // environ unreadable (another session's process)
      }
      let cwd: string | null = null;
      try {
        cwd = readlinkSync(`/proc/${entry}/cwd`);
      } catch {
        // gone
      }
      out.push({
        pid: Number(entry),
        comm: readFileSync(`/proc/${entry}/comm`, "utf8").trim(),
        args: readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").filter(Boolean),
        cwd,
        env,
      });
    } catch {
      // process exited while we looked
    }
  }
  return out;
}

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
// PowerShell or WMI, too slow to run every few seconds).
export function readWindowsProcs(): ProcView[] {
  let csv: string;
  try {
    csv = execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe"), ["/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, timeout: 4000 });
  } catch {
    return [];
  }
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

  constructor(
    private readonly candidates: () => RunningCandidate[],
    private readonly onChange: (key: string | null) => void,
    private readonly read: () => ProcView[] = process.platform === "win32" ? readWindowsProcs : readProcs,
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
    this.tick();
    this.timer = setInterval(() => this.tick(), this.everyMs);
  }

  // Stopping (Games consent turned off) also ends a running game's state, so
  // the renderer restores the normal settings instead of keeping its profile.
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
    if (this.current !== null) {
      this.current = null;
      this.onChange(null);
    }
  }

  tick(now = Date.now()): void {
    const seen = this.platform === "win32" ? detectRunningWindows(this.read(), this.candidates(), this.exes) : detectRunning(this.read(), this.candidates());
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
