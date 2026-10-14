// The budget gate's process reader on Linux (tools/measure_budgets.mjs):
// CPU time from /proc/<pid>/stat (utime + stime, in clock ticks) and memory
// as PSS from /proc/<pid>/smaps_rollup, for the app's main process and its
// tree. The parsing and the tree are in tools/budgets_lib.mjs; the Windows
// and macOS readers are tools/procs_windows.mjs and tools/procs_mac.mjs.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { appTree, parsePssKb, parseStat } from "./budgets_lib.mjs";

// Every process on this PC: [{ pid, ppid, ticks }].
function procStats() {
  const out = [];
  // loop: NOT-WORTH — the PC's processes (~1000), a few passes per measurement, measuring only
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
      out.push({ pid: Number(pid), ppid: stat.ppid, ticks: stat.ticks });
    } catch {
      // gone between readdir and read
    }
  }
  return out;
}

// The reader: hz = CPU ticks per second; appProcs(main, { memory }) =
// [{ pid, type, ticks, memKb? }] for `main` and its tree (memKb = PSS, read
// only when asked: it costs a smaps_rollup walk per process).
export function linuxReader() {
  const hz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
  return {
    hz,
    memoryMetric: "PSS",
    appProcs(main, { memory = false } = {}) {
      const procs = appTree(main, procStats(), (r) => readFileSync(`/proc/${r.pid}/cmdline`, "utf8"));
      if (!memory) return procs;
      return procs.map((p) => {
        try {
          return { ...p, memKb: parsePssKb(readFileSync(`/proc/${p.pid}/smaps_rollup`, "utf8")) ?? 0 };
        } catch {
          return p; // gone
        }
      });
    },
  };
}
