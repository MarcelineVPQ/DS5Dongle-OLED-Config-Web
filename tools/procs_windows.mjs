// The budget gate's process reader on Windows (tools/measure_budgets.mjs,
// run inside the Windows VM by tools/check_budgets_vm.sh). One PowerShell
// CIM query per sample returns the app's processes (by its exe name) with:
//   - CPU: Win32_Process UserModeTime + KernelModeTime, in 100 ns units
//     (hz = 10,000,000), the same "CPU time used" /proc's utime + stime is;
//   - memory, judged: the commit (Win32_Process PrivatePageCount, Task
//     Manager's "Commit size", the private bytes: the memory only this
//     process uses, whether in RAM or paged out). Reported beside it: the
//     private working set (Win32_PerfRawData_PerfProc_Process
//     WorkingSetPrivate, Task Manager's "Memory" column), the part of that
//     in RAM right now. Windows trims a window's working set when it goes to
//     the tray (the 2026-10-14 night run read 18.9 MB for the whole app
//     against ~207 MB of commit), so the working set says how hard Windows
//     squeezed the app, not what the app uses; the commit is the closer match
//     to Linux's PSS for the budget (what the app holds).
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

// The budget probe's native hints per process (tools/budget_probe.mjs,
// DS5_BUDGET_PROBE=1 only): handles, threads, GDI and USER objects
// (user32 GetGuiResources, compiled by Add-Type: a few seconds, so never in
// a judged sample), private bytes, virtual size and kernel pool usage, as
// JSON [{ pid, handles, threads, gdi, user, privateKb, virtualKb, pagedPoolKb, nonpagedPoolKb }].
export function winProbeScript(exeName) {
  const name = win32.parse(exeName).name.replace(/'/g, "''");
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    `Add-Type -Namespace DS5Probe -Name Gui -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr h, uint flags);'`,
    `$rows = @(Get-Process -Name '${name}' -ErrorAction SilentlyContinue | ForEach-Object { $gdi = $null; $usr = $null; try { $h = $_.Handle; $gdi = [DS5Probe.Gui]::GetGuiResources($h, 0); $usr = [DS5Probe.Gui]::GetGuiResources($h, 1) } catch { }; [pscustomobject]@{ pid = $_.Id; handles = $_.HandleCount; threads = $_.Threads.Count; gdi = $gdi; user = $usr; privateKb = [int64]($_.PrivateMemorySize64 / 1024); virtualKb = [int64]($_.VirtualMemorySize64 / 1024); pagedPoolKb = [int64]($_.PagedSystemMemorySize64 / 1024); nonpagedPoolKb = [int64]($_.NonpagedSystemMemorySize64 / 1024) } })`,
    "ConvertTo-Json -Compress -Depth 2 @{ rows = $rows }",
  ].join("\n");
}

// The probe's JSON as rows (PowerShell 5.1 writes a one-item list as a bare object).
export function parseWinProbe(json) {
  const rows = JSON.parse(json).rows;
  return rows == null ? [] : Array.isArray(rows) ? rows : [rows];
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
    memoryMetric: "commit",
    alsoMetric: "private working set",
    // The commit is judged (memKb), the private working set reported (alsoKb).
    appProcs: (main, { memory = false } = {}) => appTree(main, parseWinProcs(query(memory)), (r) => r.cmd).map((r) => ({ ...r, memKb: r.commitKb, alsoKb: r.memKb })),
    // The probe's native hints for the app's processes, with their type.
    probe(main) {
      const types = new Map(appTree(main, parseWinProcs(query(false)), (r) => r.cmd).map((r) => [r.pid, r.type]));
      const script = Buffer.from(winProbeScript(win32.basename(execPath)), "utf16le").toString("base64");
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", script], { encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20, timeout: 60000 });
      return parseWinProbe(out)
        .filter((r) => types.has(r.pid))
        .map((r) => ({ type: types.get(r.pid), ...r }));
    },
  };
}
