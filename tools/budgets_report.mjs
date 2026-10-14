// The resource budget table for a results file from tools/measure_budgets.mjs:
// one row per budget (and page), PASS / FAIL / INFO / SKIP, and exit code 1
// when any budget fails.
//
//   node tools/budgets_report.mjs tmp/budgets/results.json
import { readFileSync } from "node:fs";
import { judgeBudgets, formatTable, passed } from "./budgets_lib.mjs";

const config = JSON.parse(readFileSync(new URL("budgets.json", import.meta.url), "utf8"));
const results = JSON.parse(readFileSync(process.argv[2] ?? "tmp/budgets/results.json", "utf8"));
const rows = judgeBudgets(config, results);
console.log(`Resource budgets (${results.mode}), limits in tools/budgets.json, explained in docs/BUDGETS.md`);
console.log(formatTable(rows));
if (results.hidden)
  console.log(
    `CPU hidden by process type (% of a core): ${Object.entries(results.hidden.cpu)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
if (results.memory?.byType)
  console.log(
    `Memory by process type (MB PSS): ${Object.entries(results.memory.byType)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
const notReached = results.pages.filter((p) => !p.reached).map((p) => p.page);
if (notReached.length) console.log(`Pages not reached (the numbers are for whatever was shown): ${notReached.join(", ")}`);
if (results.hidden && results.hidden.pageSawHide === false) console.log("The page never saw the window hide: the hidden number is not trustworthy.");
const ok = passed(rows) && notReached.length === 0;
console.log(ok ? "PASS: every budget met" : `FAIL: ${rows.filter((r) => r.verdict === "FAIL").length} budget row(s) over`);
process.exit(ok ? 0 : 1);
