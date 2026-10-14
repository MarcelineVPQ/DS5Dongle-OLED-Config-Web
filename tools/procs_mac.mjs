// The macOS process reader (tools/mac_smoke.mjs): one `ps` table with each
// process's parent, cumulative CPU time and RSS. The tree and roles are in
// tools/budgets_lib.mjs, like the Linux and Windows readers'
// (tools/procs_linux.mjs, tools/procs_windows.mjs).
import { execFileSync } from "node:child_process";
import { appTree } from "./budgets_lib.mjs";

// ps's TIME ("mm:ss.ss"; macOS counts hours as minutes) in seconds.
export const parsePsTime = (t) => t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);

// `ps -A -o pid=,ppid=,time=,rss=,command=` as rows [{ pid, ppid, cpuS, rssKb, cmd }].
export function parsePsTable(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(l);
      return m && { pid: Number(m[1]), ppid: Number(m[2]), cpuS: parsePsTime(m[3]), rssKb: Number(m[4]), cmd: m[5] };
    })
    .filter(Boolean);
}

// Every process on this Mac.
export const procTable = () => parsePsTable(execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,rss=,command="], { encoding: "utf8", maxBuffer: 16 << 20 }));

// `main` and its tree, each with its role: [{ pid, ppid, cpuS, rssKb, cmd, type }].
export const appProcs = (main) => appTree(main, procTable(), (r) => r.cmd);
