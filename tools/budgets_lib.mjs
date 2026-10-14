// The resource budget gate's arithmetic (tools/check_budgets.sh,
// tools/measure_budgets.mjs): reading /proc text, CPU and frame rates,
// the memory trend, and the PASS/FAIL table against tools/budgets.json.
// Pure functions, so tests/unit/budgets.test.ts can check them without
// an app running.

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

// One table row per budget and page: { budget, scope, measured, limit,
// unit, verdict } with verdict PASS, FAIL, INFO (reported, not judged) or
// SKIP (not measured in this mode).
// results: { mode, pages: [{ page, framesPerS, cpu }], hidden: { secs, cpu },
//            memory: { atS, mb }, soak: { windowS, samples } | null }
export function judgeBudgets(config, results) {
  const b = config.budgets;
  const rows = [];
  for (const p of results.pages) {
    rows.push({ budget: "idle frames", scope: p.page, measured: p.framesPerS, limit: `≤ ${b.idleFrames.max}`, unit: b.idleFrames.unit, verdict: verdict(p.framesPerS, b.idleFrames.max) });
  }
  for (const p of results.pages) {
    const cpu = cpuTotal(p.cpu, [GPU_TYPE, ...MEASUREMENT_TYPES]);
    rows.push({ budget: "CPU shown, idle", scope: p.page, measured: cpu, limit: `< ${b.shownCpu.max}`, unit: b.shownCpu.unit, verdict: strictVerdict(cpu, b.shownCpu.max) });
    rows.push({ budget: "GPU process, shown", scope: p.page, measured: p.cpu[GPU_TYPE] ?? 0, limit: "info", unit: b.shownCpu.unit, verdict: "INFO" });
  }
  const hidden = results.hidden ? cpuTotal(results.hidden.cpu, MEASUREMENT_TYPES) : null;
  rows.push({
    budget: "CPU hidden",
    scope: results.hidden ? `all processes, ${results.hidden.secs} s` : "-",
    measured: hidden,
    limit: `< ${b.hiddenCpu.max}`,
    unit: b.hiddenCpu.unit,
    verdict: strictVerdict(hidden, b.hiddenCpu.max),
  });
  // The main process alone (the running-game check's /proc scan, the board's polls): reported.
  rows.push({
    budget: "CPU hidden, main",
    scope: results.hidden ? "main process (running-game check)" : "-",
    measured: results.hidden?.cpu.main ?? null,
    limit: "info",
    unit: b.hiddenCpu.unit,
    verdict: results.hidden ? "INFO" : "SKIP",
  });
  const mem = results.memory?.mb ?? null;
  rows.push({
    budget: "memory (PSS)",
    scope: results.memory ? `at ${Math.round(results.memory.atS / 60)} min` : "-",
    measured: mem,
    limit: `< ${b.memory.max}`,
    unit: "MB",
    verdict: strictVerdict(mem, b.memory.max),
  });
  const growth = results.soak ? growthPerWindow(results.soak.samples, 1800) : null;
  rows.push({
    budget: "memory growth",
    scope: results.soak ? `${Math.round(results.soak.windowS / 60)} min soak, ${results.soak.samples.length} samples` : "--long only",
    measured: growth,
    limit: `< ${b.growth.max}`,
    unit: b.growth.unit,
    verdict: strictVerdict(growth, b.growth.max),
  });
  return rows;
}

// The gate passes when no row failed.
export const passed = (rows) => rows.every((r) => r.verdict !== "FAIL");

// A plain-text table for the terminal (and the release notes).
export function formatTable(rows) {
  const head = ["Budget", "Scope", "Measured", "Limit", "Unit", "Verdict"];
  const cells = rows.map((r) => [r.budget, r.scope, r.measured == null ? "-" : String(r.measured), r.limit, r.unit, r.verdict]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => v.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}
