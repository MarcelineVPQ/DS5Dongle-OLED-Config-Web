// The resource budget gate's arithmetic (tools/check_budgets.sh,
// tools/check_budgets_vm.sh, tools/measure_budgets.mjs): reading /proc text,
// the app's process tree and roles, CPU and frame rates, memory per process
// type, the memory trend, the PASS/FAIL table against tools/budgets.json and
// the three-OS table. Shared by the per-OS process readers
// (tools/procs_linux.mjs, procs_windows.mjs, procs_mac.mjs). Pure
// functions, so tests/unit/budgets.test.ts can check them without an app
// running.

// /proc/<pid>/stat: CPU ticks used (utime + stime) and the parent pid. The
// command name in parentheses may hold spaces and ")", so fields are
// counted from the last ")".
export function parseStat(text) {
  const f = text
    .slice(text.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  return { ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) };
}

// A process's role from its /proc/<pid>/cmdline (NUL-separated): Chromium's
// --type (utility processes by their sub-type), "main" for the browser
// process itself.
export function procType(cmdline) {
  let args = cmdline.split("\0").filter(Boolean);
  // Chromium children may rewrite their title into one space-separated string.
  if (args.length === 1) args = args[0].split(" ");
  const type = args.find((a) => a.startsWith("--type="))?.slice(7);
  if (!type) return "main";
  if (type !== "utility") return type;
  const sub = args.find((a) => a.startsWith("--utility-sub-type="));
  return sub ? `utility:${sub.split("=")[1].split(".").pop()}` : "utility";
}

// /proc/<pid>/smaps_rollup: the process's PSS in kB (its private pages plus
// its share of the shared ones), or null when the line is missing.
export function parsePssKb(text) {
  const m = /^Pss:\s+(\d+)\s+kB/m.exec(text);
  return m ? Number(m[1]) : null;
}

// The pids of `root` and all its descendants, from [{ pid, ppid }].
export function descendants(root, procs) {
  const kids = new Map();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const out = [];
  const todo = [root];
  while (todo.length) {
    const pid = todo.pop();
    out.push(pid);
    todo.push(...(kids.get(pid) ?? []));
  }
  return out;
}

// The app's processes in one platform snapshot: the rows ([{ pid, ppid }])
// of `main` and its descendants, each with its role (`type`: "main" or
// procType of its command line). cmdOf(row) gives the command line; a row
// whose process ended meanwhile (cmdOf throws) is left out.
export function appTree(main, rows, cmdOf) {
  const tree = new Set(descendants(main, rows));
  const out = [];
  // loop: NOT-WORTH — a snapshot of the PC's processes, a few passes per measurement
  for (const r of rows) {
    if (!tree.has(r.pid)) continue;
    try {
      out.push({ ...r, type: r.pid === main ? "main" : procType(cmdOf(r)) });
    } catch {
      // gone between the snapshot and the read
    }
  }
  return out;
}

// Memory per process type in MB from [{ type, memKb, alsoKb? }] (what the
// platform reader measured: PSS on Linux, the commit on Windows), and the
// total without the processes that exist only because we measure. `metric`
// names the measure for the report. A second measure the reader took
// (alsoKb: Windows' private working set) is kept beside it as `also`,
// reported, not judged.
export function memorySummary(procs, metric, alsoMetric = null) {
  const sum = (key) => {
    const byType = {};
    for (const p of procs) if (p[key] != null) byType[p.type] = (byType[p.type] ?? 0) + p[key] / 1024;
    return byType;
  };
  const byType = sum("memKb");
  const total = Object.entries(byType).reduce((s, [type, v]) => (MEASUREMENT_TYPES.includes(type) ? s : s + v), 0);
  const out = { mb: round1(total), byType: roundAll(byType), metric };
  if (alsoMetric && procs.some((p) => p.alsoKb != null)) out.also = { metric: alsoMetric, byType: roundAll(sum("alsoKb")) };
  return out;
}
const roundAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round1(v)]));

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// CPU per process type in % of one core between two samples
// ([{ pid, type, ticks }]) `secs` apart; processes in only one sample
// (started or ended in between) are left out.
export function cpuByType(before, after, secs, hz = 100) {
  const res = {};
  for (const p of after) {
    const q = before.find((x) => x.pid === p.pid);
    if (!q) continue;
    res[p.type] = (res[p.type] ?? 0) + ((p.ticks - q.ticks) / hz / secs) * 100;
  }
  return Object.fromEntries(Object.entries(res).map(([k, v]) => [k, round2(v)]));
}

// The sum of a cpuByType result, optionally without some types.
export function cpuTotal(byType, exclude = []) {
  return round2(Object.entries(byType).reduce((sum, [type, v]) => (exclude.includes(type) ? sum : sum + v), 0));
}

// The GPU process is judged apart (software rendering on the test display).
export const GPU_TYPE = "gpu-process";
// Processes that exist only because we measure (DevTools tracing): left out
// of every total.
export const MEASUREMENT_TYPES = ["utility:TracingService"];

// The memory the budget judges, in MB: every app process except the GPU
// process (software rendering inflates it; reported apart) and the
// processes that exist only because we measure. byType: { type: MB }; a
// result without it falls back to its total.
export function memoryJudged(memory) {
  if (!memory.byType) return memory.mb;
  return Math.round(Object.entries(memory.byType).reduce((sum, [type, mb]) => (type === GPU_TYPE || MEASUREMENT_TYPES.includes(type) ? sum : sum + mb), 0) * 10) / 10;
}

// The marks framesOver (cdp_lib.mjs) puts in the trace around the stretch it measures.
export const FRAME_MARKS = { start: "ds5-frames-start", end: "ds5-frames-end" };

// Frames per second (to 0.1) between the two marks, from a trace's
// Display::DrawAndSwap and TimeStamp events ({ name, ts (µs), args }); null
// when a mark is missing. With two frames or more it is the frames' own
// rate: intervals between the first and the last frame over the time they
// span. A plain count over the window is off by up to one frame either way
// depending on where the window starts (a page drawing exactly every 100 ms
// read 9.9 on one page and 10.1 on the next in one 10 s run); the intervals
// aren't. Frames that don't span most of the window (a few frames close
// together on an idle page) are counted over the window instead, so two
// frames 100 ms apart read 0.2, not 10.
export function framesBetweenMarks(events) {
  const markAt = (message) => events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === message)?.ts;
  const start = markAt(FRAME_MARKS.start);
  const end = markAt(FRAME_MARKS.end);
  if (start == null || end == null || end <= start) return null;
  const at = events
    .filter((e) => e.name === "Display::DrawAndSwap" && e.ts >= start && e.ts < end)
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  const span = at.length < 2 ? 0 : at[at.length - 1] - at[0];
  if (span < 0.9 * (end - start)) return round1(at.length / ((end - start) / 1e6));
  return round1((at.length - 1) / (span / 1e6));
}

// The same trace by the two plain counts, for comparison (reported, not
// judged): `wholeTrace`, every DrawAndSwap in the trace over `secs` (the gate's
// formula until 2026-10-15), and `window`, the frames between the marks over
// the time between them.
export function frameCounts(events, secs) {
  const draws = events.filter((e) => e.name === "Display::DrawAndSwap");
  const markAt = (message) => events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === message)?.ts;
  const start = markAt(FRAME_MARKS.start);
  const end = markAt(FRAME_MARKS.end);
  const inWindow = start == null || end == null || end <= start ? null : draws.filter((e) => e.ts >= start && e.ts < end).length;
  return { wholeTrace: round1(draws.length / secs), window: inWindow === null ? null : round1(inWindow / ((end - start) / 1e6)) };
}

// Events per second from a trace's event counts.
export const perSecond = (count, secs) => round1((count ?? 0) / secs);

// The memory trend: the least-squares slope of [{ t: seconds, mb }] scaled
// to `windowS` (MB per window). Fewer than 3 samples: null.
export function growthPerWindow(samples, windowS) {
  if (samples.length < 3) return null;
  const n = samples.length;
  const mt = samples.reduce((s, p) => s + p.t, 0) / n;
  const mm = samples.reduce((s, p) => s + p.mb, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of samples) {
    num += (p.t - mt) * (p.mb - mm);
    den += (p.t - mt) ** 2;
  }
  return den === 0 ? 0 : round2((num / den) * windowS);
}

const verdict = (value, max) => (value == null ? "SKIP" : value <= max ? "PASS" : "FAIL");
const strictVerdict = (value, max) => (value == null ? "SKIP" : value < max ? "PASS" : "FAIL");

// One table row per budget and page: { id, budget, scope, measured, limit,
// unit, verdict } with verdict PASS, FAIL, INFO (reported, not judged) or
// SKIP (not measured in this mode). `id` is the same on every OS (the
// three-OS table lines rows up by it).
// results: { mode, pages: [{ page, framesPerS, cpu }], hidden: { secs, cpu },
//            memory: { atS, mb, byType?, metric? }, soak: { windowS, samples } | null }
export function judgeBudgets(config, results) {
  const b = config.budgets;
  const rows = [];
  for (const p of results.pages) {
    rows.push({
      id: `frames:${p.page}`,
      budget: "idle frames",
      scope: p.page,
      measured: p.framesPerS,
      limit: `≤ ${b.idleFrames.max}`,
      unit: b.idleFrames.unit,
      verdict: verdict(p.framesPerS, b.idleFrames.max),
    });
  }
  for (const p of results.pages) {
    const cpu = cpuTotal(p.cpu, [GPU_TYPE, ...MEASUREMENT_TYPES]);
    rows.push({ id: `cpu:${p.page}`, budget: "CPU shown, idle", scope: p.page, measured: cpu, limit: `< ${b.shownCpu.max}`, unit: b.shownCpu.unit, verdict: strictVerdict(cpu, b.shownCpu.max) });
    rows.push({ id: `gpu:${p.page}`, budget: "GPU process, shown", scope: p.page, measured: p.cpu[GPU_TYPE] ?? 0, limit: "info", unit: b.shownCpu.unit, verdict: "INFO" });
  }
  const hidden = results.hidden ? cpuTotal(results.hidden.cpu, MEASUREMENT_TYPES) : null;
  rows.push({
    id: "hidden",
    budget: "CPU hidden",
    scope: results.hidden ? `all processes, ${results.hidden.secs} s` : "-",
    measured: hidden,
    limit: `< ${b.hiddenCpu.max}`,
    unit: b.hiddenCpu.unit,
    verdict: strictVerdict(hidden, b.hiddenCpu.max),
  });
  // The main process alone (the running-game check's /proc scan, the board's polls): reported.
  rows.push({
    id: "hiddenMain",
    budget: "CPU hidden, main",
    scope: results.hidden ? "main process (running-game check)" : "-",
    measured: results.hidden?.cpu.main ?? null,
    limit: "info",
    unit: b.hiddenCpu.unit,
    verdict: results.hidden ? "INFO" : "SKIP",
  });
  const mem = results.memory ? memoryJudged(results.memory) : null;
  const at = results.memory ? `at ${Math.round(results.memory.atS / 60)} min` : "-";
  const metric = results.memory?.metric ?? "PSS";
  rows.push({ id: "memory", budget: `memory (${metric}) without GPU`, scope: at, measured: mem, limit: `≤ ${b.memory.max}`, unit: "MB", verdict: verdict(mem, b.memory.max) });
  const gpuMem = results.memory?.byType?.[GPU_TYPE] ?? null;
  rows.push({ id: "memoryGpu", budget: "memory, GPU process", scope: at, measured: gpuMem, limit: "info", unit: "MB", verdict: gpuMem == null ? "SKIP" : "INFO" });
  // Growth is judged without the GPU process, like the memory budget (owner's
  // decision 2026-10-15: the software GPU in the hidden copy swings ±15 MB
  // between samples). Results without the split (older runs) judge the total.
  // The total with the GPU process is reported beside it.
  const total = results.soak ? growthPerWindow(results.soak.samples, 1800) : null;
  const split = !!results.soak?.samples.length && results.soak.samples.every((s) => s.mbWithoutGpu != null);
  const growth = split
    ? growthPerWindow(
        results.soak.samples.map((s) => ({ t: s.t, mb: s.mbWithoutGpu })),
        1800,
      )
    : total;
  const soakScope = results.soak ? `${Math.round(results.soak.windowS / 60)} min soak, ${results.soak.samples.length} samples` : "--long only";
  rows.push({
    id: "growth",
    budget: "memory growth without GPU",
    scope: split || !results.soak ? soakScope : `${soakScope} (no split: total)`,
    measured: growth,
    limit: `< ${b.growth.max}`,
    unit: b.growth.unit,
    verdict: strictVerdict(growth, b.growth.max),
  });
  rows.push({
    id: "growthTotal",
    budget: "memory growth, all processes",
    scope: results.soak ? "same soak, GPU process included" : "-",
    measured: total,
    limit: "info",
    unit: b.growth.unit,
    verdict: total == null ? "SKIP" : "INFO",
  });
  return rows;
}

// The gate passes when no row failed.
export const passed = (rows) => rows.every((r) => r.verdict !== "FAIL");

// A plain-text table for the terminal (and the release notes).
export function formatTable(rows) {
  const head = ["Budget", "Scope", "Measured", "Limit", "Unit", "Verdict"];
  return textTable(
    head,
    rows.map((r) => [r.budget, r.scope, r.measured == null ? "-" : String(r.measured), r.limit, r.unit, r.verdict]),
  );
}

// Left-aligned columns two spaces apart, a dashed line under the head.
function textTable(head, cells) {
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => v.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}

// The macOS smoke test's results.json (tools/mac_smoke.mjs, the "mac-smoke"
// artifact) as measure_budgets.mjs results, so the three-OS table can judge
// it: its pages and hidden CPU (without its `total`), and the memory it took
// hidden as footprint (macOS has no PSS; Activity Monitor's Memory). null
// when the run has no budgets step.
export function fromMacSmoke(smoke) {
  const b = smoke?.budgets;
  if (!b) return null;
  const noTotal = (cpu) => Object.fromEntries(Object.entries(cpu ?? {}).filter(([k]) => k !== "total"));
  const mem = b.memory?.hidden ?? b.memory?.shown;
  return {
    mode: "mac smoke",
    pages: b.pages.map((p) => ({ page: p.page, framesPerS: p.framesPerS, cpu: noTotal(p.cpu), reached: true })),
    hidden: b.hidden ? { secs: b.hidden.secs, cpu: noTotal(b.hidden.cpu), pageSawHide: b.hidden.pageSawHide } : null,
    memory:
      mem?.footprintMb != null
        ? { atS: 0, mb: mem.footprintMb, byType: { app: mem.footprintMb, ...(mem.gpuFootprintMb != null ? { [GPU_TYPE]: mem.gpuFootprintMb } : {}) }, metric: "footprint" }
        : null,
    soak: null,
  };
}

// One table for several OSes: judgeBudgets per OS, lined up by row id in the
// order they first appear. byOs: { Linux: results, Windows: results, ... }
// (a missing OS is left out). Each row: { id, budget, limit, unit, cells: {
// os: { measured, verdict, scope } } }.
export function combineResults(config, byOs) {
  const rows = new Map();
  for (const [os, results] of Object.entries(byOs)) {
    if (!results) continue;
    for (const r of judgeBudgets(config, results)) {
      const label = r.id === "memory" ? "memory without GPU" : r.budget;
      if (!rows.has(r.id)) rows.set(r.id, { id: r.id, budget: label, limit: r.limit, unit: r.unit, cells: {} });
      rows.get(r.id).cells[os] = { measured: r.measured, verdict: r.verdict, scope: r.scope };
    }
  }
  return [...rows.values()];
}

// The three-OS table as plain text: Budget, Page (per-page rows), a
// "measured VERDICT" column per OS, Limit, Unit.
export function formatCombined(rows, oses) {
  const page = (r) => (r.id.includes(":") ? r.id.split(":")[1] : "");
  const cell = (c) => (c ? `${c.measured == null ? "-" : c.measured} ${c.verdict}` : "n/a");
  return textTable(
    ["Budget", "Page", ...oses, "Limit", "Unit"],
    rows.map((r) => [r.budget, page(r), ...oses.map((os) => cell(r.cells[os])), r.limit, r.unit]),
  );
}
