// Is a launcher (or a game) running, and asking a launcher to quit cleanly.
// Never force-kills: Steam gets its own `-shutdown`, Heroic and Lutris get
// SIGTERM (what a normal window-manager quit sends), then we wait.
import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import type { LauncherId } from "../../../src/desktop/games/types";

interface Proc {
  pid: number;
  comm: string;
  args: string[];
}

function processes(): Proc[] {
  const uid = process.getuid?.();
  const out: Proc[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      // Only the user's own processes.
      if (uid !== undefined && !new RegExp(`^Uid:\\s+${uid}\\b`, "m").test(status)) continue;
      out.push({
        pid: Number(entry),
        comm: readFileSync(`/proc/${entry}/comm`, "utf8").trim(),
        args: readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0").filter(Boolean),
      });
    } catch {
      // process exited while we looked
    }
  }
  return out;
}

const isMain = (p: Proc) => !p.args.some((a) => a.startsWith("--type="));

function matches(launcher: LauncherId, p: Proc): boolean {
  switch (launcher) {
    case "steam":
      return p.comm === "steam" || p.comm === "steamwebhelper";
    case "heroic":
      return p.comm === "heroic" || /[/]heroic$/i.test(p.args[0] ?? "");
    case "lutris":
      return p.comm === "lutris" || (/python/.test(p.comm) && p.args.some((a) => /(^|\/)lutris$/.test(a)));
  }
}

export function runningLaunchers(): Set<LauncherId> {
  const procs = processes();
  const out = new Set<LauncherId>();
  for (const id of ["steam", "heroic", "lutris"] as const) if (procs.some((p) => matches(id, p))) out.add(id);
  return out;
}

// A Proton/Wine game is running (Proton's script or a wineserver).
export function gameRunning(): boolean {
  return processes().some((p) => p.comm === "wineserver" || (/python/.test(p.comm) && p.args.some((a) => a.endsWith("/proton")) && p.args.includes("waitforexitandrun")));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CloseResult = "closed" | "not-running" | "game-running" | "timeout";

export async function closeLauncher(launcher: LauncherId, timeoutMs = 30_000): Promise<CloseResult> {
  if (!runningLaunchers().has(launcher)) return "not-running";
  // Quitting a launcher mid-game can kill the game; the user closes the game first.
  if (gameRunning()) return "game-running";

  if (launcher === "steam") {
    const flatpak = processes().some((p) => p.comm === "steam" && p.args[0]?.includes("/.var/app/com.valvesoftware.Steam/"));
    const [cmd, args] = flatpak ? ["flatpak", ["run", "com.valvesoftware.Steam", "-shutdown"]] : ["steam", ["-shutdown"]];
    execFile(cmd, args, { timeout: 15_000 }, () => undefined);
  } else {
    for (const p of processes()) if (matches(launcher, p) && isMain(p)) process.kill(p.pid, "SIGTERM");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!runningLaunchers().has(launcher)) {
      await sleep(1000); // let it finish flushing its config files
      return "closed";
    }
  }
  return "timeout";
}
