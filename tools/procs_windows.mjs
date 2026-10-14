// The budget gate's process reader on Windows (tools/measure_budgets.mjs,
// run inside the Windows VM by tools/check_budgets_vm.sh). One PowerShell
// CIM query per sample returns the app's processes (by its exe name) with:
//   - CPU: Win32_Process UserModeTime + KernelModeTime, in 100 ns units
//     (hz = 10,000,000), the same "CPU time used" /proc's utime + stime is;
//   - memory: the private working set (Win32_PerfRawData_PerfProc_Process
//     WorkingSetPrivate, Task Manager's "Memory" column), Windows' closest
//     match to PSS. Both count the pages only this process uses and that are
//     in RAM; PSS also adds a share of the shared pages (Electron's DLLs),
//     which the private working set leaves out, so it reads a little lower.
//     The commit (Win32_Process PrivatePageCount, Task Manager's "Commit
//     size": private memory whether in RAM or not) is reported beside it:
//     it counts V8's and Chromium's reserved-and-committed heaps, so it
//     reads higher than anything resident.
// A query from outside the app (not koffi in the app, not app.getAppMetrics)
// so the app does no extra work because it is measured. The PowerShell and
// WMI processes it starts are not in the app's tree, so they never count.
// The tree and roles are in tools/budgets_lib.mjs, like the Linux reader's
// (tools/procs_linux.mjs).
import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import { appTree } from "./budgets_lib.mjs";

// The PowerShell that lists `exeName`'s processes and, with `memory`, every
// process's private working set (the performance counters take ~5 s to
// load in a fresh PowerShell, so CPU-only samples leave them out), as one
// JSON object { procs: [...], perf: [...] }.
export function winQueryScript(exeName, memory = true) {
  const name = exeName.replace(/'/g, "''");
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    `$procs = @(Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; user = [uint64]$_.UserModeTime; kernel = [uint64]$_.KernelModeTime; commit = [uint64]$_.PrivatePageCount; cmd = [string]$_.CommandLine } })`,
    memory ? "$perf = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.IDProcess; ws = [uint64]$_.WorkingSetPrivate } })" : "$perf = @()",
    "ConvertTo-Json -Compress -Depth 3 @{ procs = $procs; perf = $perf }",
  ].join("\n");
}

// The query's JSON as reader rows: [{ pid, ppid, ticks (100 ns), cmd, memKb
// (private working set; null when the counter had no row for it), commitKb }].
// PowerShell 5.1 writes a one-item array as a bare object: both are taken.
export function parseWinProcs(json) {
  const data = JSON.parse(json);
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const ws = new Map(list(data.perf).map((p) => [p.pid, p.ws]));
  return list(data.procs).map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    ticks: Number(p.user) + Number(p.kernel),
    cmd: p.cmd ?? "",
    memKb: ws.has(p.pid) ? Number(ws.get(p.pid)) / 1024 : null,
    commitKb: Number(p.commit) / 1024,
  }));
}

// The reader for the app running from `execPath` (the main process's
// process.execPath): appProcs(main, { memory }) = [{ pid, type, ticks,
// commitKb, memKb (with memory) }].
export function windowsReader(execPath) {
  const encoded = (memory) => Buffer.from(winQueryScript(win32.basename(execPath), memory), "utf16le").toString("base64");
  const scripts = { true: encoded(true), false: encoded(false) };
  const query = (memory) =>
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", scripts[memory]], { encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20, timeout: 60000 });
  return {
    hz: 1e7,
    memoryMetric: "private working set",
    appProcs: (main, { memory = false } = {}) => appTree(main, parseWinProcs(query(memory)), (r) => r.cmd),
  };
}
