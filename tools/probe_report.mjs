// The memory probe's numbers from a results.json (tools/measure_budgets.mjs
// with DS5_BUDGET_PROBE=1; tools/budget_probe.mjs): every series over the
// soak with its least-squares slope per 30 minutes (the gate's growth
// arithmetic), so the series that grows stands out, then what the heap
// snapshots at the start and end of the window say grew.
//
//   node tools/probe_report.mjs tmp/budgets-vm/results.json [--all]   --all: every sample, not just the slopes
import { readFileSync } from "node:fs";
import { growthPerWindow } from "./budgets_lib.mjs";
import { diffSummaries } from "./heap_summary.mjs";

const file = process.argv[2] ?? "tmp/budgets-vm/results.json";
const all = process.argv.includes("--all");
const r = JSON.parse(readFileSync(file, "utf8"));
const samples = r.soak?.samples ?? [];
if (!samples.length) {
  console.log("no soak samples in", file);
  process.exit(1);
}
const windowS = r.soak.windowS;

// series name -> [{ t, mb }] (the value under "mb", whatever its unit)
const series = new Map();
const pushSeriesValue = (name, t, v) => {
  if (typeof v !== "number" || Number.isNaN(v)) return;
  if (!series.has(name)) series.set(name, []);
  series.get(name).push({ t, mb: v });
};
for (const s of samples) {
  pushSeriesValue("judged (without GPU) MB", s.t, s.mbWithoutGpu);
  for (const [type, v] of Object.entries(s.byType ?? {})) pushSeriesValue(`${type} MB`, s.t, v);
  const p = s.probe;
  if (!p) continue;
  const m = p.main ?? {};
  for (const k of ["heapUsed", "heapTotal", "external", "arrayBuffers", "rss"]) pushSeriesValue(`main ${k} MB`, s.t, m[k]);
  pushSeriesValue("main v8 malloced MB", s.t, m.v8?.malloced);
  pushSeriesValue("main private (Electron) MB", s.t, m.processMemoryInfo?.privateMb);
  for (const [k, v] of Object.entries(m.handles ?? {})) pushSeriesValue(`main handles ${k}`, s.t, v);
  for (const a of m.appMetrics ?? []) pushSeriesValue(`appMetrics ${a.type}${a.name ? `:${a.name}` : ""} private MB`, s.t, a.privateMb ?? a.wsMb);
  const pg = p.page ?? {};
  for (const k of ["heapUsed", "heapTotal", "embedderUsed", "backingStorage", "documents", "nodes", "jsEventListeners", "elements", "imgs", "canvases", "animations"])
    pushSeriesValue(`page ${k}`, s.t, pg[k]);
  const byType = new Map();
  for (const row of Array.isArray(p.procs) ? p.procs : []) {
    const acc = byType.get(row.type) ?? {};
    for (const [k, v] of Object.entries(row)) if (typeof v === "number" && k !== "pid") acc[k] = (acc[k] ?? 0) + v;
    byType.set(row.type, acc);
  }
  for (const [type, acc] of byType) for (const [k, v] of Object.entries(acc)) pushSeriesValue(`${type} ${k}`, s.t, v);
}

const probeNum = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
console.log(`${file}: ${samples.length} samples over ${Math.round(samples.at(-1).t / 60)} min; slope = least-squares change per ${windowS / 60} min`);
console.log(`${"series".padEnd(52)} ${"first".padStart(9)} ${"last".padStart(9)} ${"min".padStart(9)} ${"max".padStart(9)} ${"slope".padStart(9)}`);
for (const [name, pts] of series) {
  const vals = pts.map((p) => p.mb);
  const slope = growthPerWindow(pts, windowS);
  console.log(
    `${name.padEnd(52)} ${probeNum(vals[0]).padStart(9)} ${probeNum(vals.at(-1)).padStart(9)} ${probeNum(Math.min(...vals)).padStart(9)} ${probeNum(Math.max(...vals)).padStart(9)} ${(slope == null ? "-" : probeNum(slope)).padStart(9)}`,
  );
}
if (all) for (const s of samples) console.log(s.t, s.mbWithoutGpu, JSON.stringify(s.byType));

for (const snap of r.probe?.snapshots ?? [])
  console.log(`after the "${snap.label}" snapshots (t ${snap.t} s, full GC): ${snap.afterGc.mbWithoutGpu} MB without GPU ${JSON.stringify(snap.afterGc.byType)}`);
const sums = r.probe?.summaries ?? [];
if (sums.length >= 2) {
  const [a, b] = [sums[0], sums.at(-1)];
  for (const target of ["main", "page"]) {
    console.log(`\n${target} heap: ${a[target].totalMb} -> ${b[target].totalMb} MB, nodes ${a[target].nodes} -> ${b[target].nodes}, detached ${a[target].detached} -> ${b[target].detached}`);
    for (const d of diffSummaries(a[target], b[target], 25)) console.log(`${(d.size / 1024).toFixed(1).padStart(10)} kB ${String(d.count).padStart(8)}  ${d.key}`);
  }
}
