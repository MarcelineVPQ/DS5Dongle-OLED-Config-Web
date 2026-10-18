// The resource budget table for results files from tools/measure_budgets.mjs:
// one row per budget (and page), PASS / FAIL / INFO / SKIP, and exit code 1
// when any budget fails.
//
//   node tools/budgets_report.mjs tmp/budgets/results.json        one run
//   node tools/budgets_report.mjs --linux tmp/budgets/results.json \
//     --windows tmp/budgets-vm/results.json --mac mac-smoke/results.json
//                                                                 one table, three OSes
//
// --mac takes the macOS smoke test's results.json (the "mac-smoke" artifact
// of .github/workflows/mac-smoke.yml): its shorter stretches are
// reported, not judged, so the macOS column never changes the exit code. Any of the three may be left out.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { combineResults, formatCombined, formatTable, fromMacSmoke, judgeBudgets, passed } from "./budgets_lib.mjs";

const config = JSON.parse(readFileSync(new URL("budgets.json", import.meta.url), "utf8"));
const { values: opts, positionals } = parseArgs({ options: { linux: { type: "string" }, windows: { type: "string" }, mac: { type: "string" } }, allowPositionals: true });
const load = (path) => {
  if (!existsSync(path)) throw new Error(`no results file at ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const byType = (label, o) =>
  o &&
  `${label}: ${Object.entries(o)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}`;
// The notes under a table that say when a number can't be trusted.
function warnings(results, prefix = "") {
  const out = [];
  const notReached = results.pages.filter((p) => p.reached === false).map((p) => p.page);
  if (notReached.length) out.push(`${prefix}Pages not reached (the numbers are for whatever was shown): ${notReached.join(", ")}`);
  if (results.hidden && results.hidden.pageSawHide === false) out.push(`${prefix}The page never saw the window hide: the hidden number is not trustworthy.`);
  return { lines: out, notReached: notReached.length };
}

if (!opts.linux && !opts.windows && !opts.mac) {
  const results = load(positionals[0] ?? "tmp/budgets/results.json");
  const rows = judgeBudgets(config, results);
  console.log(`Resource budgets (${results.mode}), limits in tools/budgets.json, explained in docs/BUDGETS.md`);
  console.log(formatTable(rows));
  if (results.hidden) console.log(byType("CPU hidden by process type (% of a core)", results.hidden.cpu));
  if (results.memory?.byType) console.log(byType(`Memory by process type (MB ${results.memory.metric ?? "PSS"})`, results.memory.byType));
  if (results.memory?.also) console.log(byType(`${results.memory.also.metric} by process type (MB, reported)`, results.memory.also.byType));
  const w = warnings(results);
  w.lines.forEach((l) => console.log(l));
  const ok = passed(rows) && w.notReached === 0;
  console.log(ok ? "PASS: every budget met" : `FAIL: ${rows.filter((r) => r.verdict === "FAIL").length} budget row(s) over`);
  process.exit(ok ? 0 : 1);
}

const byOs = {};
if (opts.linux) byOs.Linux = load(opts.linux);
if (opts.windows) byOs.Windows = load(opts.windows);
if (opts.mac) {
  byOs.macOS = fromMacSmoke(load(opts.mac));
  if (!byOs.macOS) console.log(`${opts.mac} has no budgets step: no macOS column.`);
}
const oses = Object.keys(byOs).filter((os) => byOs[os]);
const rows = combineResults(config, byOs);
console.log(`Resource budgets on ${oses.join(", ")}, limits in tools/budgets.json, explained in docs/BUDGETS.md`);
console.log(formatCombined(rows, oses));
let notReached = 0;
for (const os of oses) {
  const r = byOs[os];
  const memo = r.memory ? `${os} memory: ${r.memory.metric ?? "PSS"}${r.memory.atS ? ` at ${Math.round(r.memory.atS / 60)} min` : ""}` : `${os}: no memory measured`;
  console.log(`${memo}; mode ${r.mode}${r.display ? `; screen ${r.display.size.width} x ${r.display.size.height}, window ${r.display.window.width} x ${r.display.window.height}` : ""}`);
  if (r.memory?.also) console.log(byType(`  ${os} ${r.memory.also.metric} by process type (MB, reported)`, r.memory.also.byType));
  const w = warnings(r, `  ${os}: `);
  w.lines.forEach((l) => console.log(l));
  if (os !== "macOS") notReached += w.notReached;
}
// macOS: reported, never judged here (the smoke test's shorter stretches).
const failed = rows.filter((r) => Object.entries(r.cells).some(([os, c]) => os !== "macOS" && c.verdict === "FAIL"));
const ok = failed.length === 0 && notReached === 0;
console.log(
  ok ? `PASS: every budget met on ${oses.filter((o) => o !== "macOS").join(", ") || "-"}${oses.includes("macOS") ? " (macOS reported only)" : ""}` : `FAIL: ${failed.length} budget row(s) over`,
);
process.exit(ok ? 0 : 1);
