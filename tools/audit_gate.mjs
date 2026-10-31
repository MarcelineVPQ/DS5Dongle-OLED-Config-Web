#!/usr/bin/env node
// The npm audit gate (.github/workflows/npm-audit.yml): every advisory npm
// audit reports, for shipped and dev dependencies alike, is either fixed or
// listed in ALLOWED below with why it can't be fixed yet and what removes it.
// An entry that no longer matches a reported advisory fails too, so the list
// can't go stale (CLAUDE.md: an allowlist entry names the finding and the
// batch that removes it).
//
//   npx -y npm@11.6.2 audit --json > npm_audit_full.json
//   node tools/audit_gate.mjs npm_audit_full.json
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fast-uri 3.1.9 fixes all four; it was published 2026-10-19, so the 14-day rule allows it from 2026-11-02.
const FAST_URI = {
  package: "fast-uri",
  why: "dev only (electron-builder's ajv); the fix, 3.1.9, was published 2026-10-19 and is younger than the 14-day rule",
  removedBy: "updating fast-uri to 3.1.9 from 2026-11-02 (Dependabot's npm-minor-patch group)",
};

export const ALLOWED = [
  {
    advisory: "GHSA-g3hv-75wg-m249",
    package: "minimatch",
    why: "dev only (eslint, typescript-eslint, electron-builder's glob, filelist, asar and dir-compare); fixed only in minimatch 11.0.1 (2026-10-27), a new major that none of them accept (they need 3.x, 5.x, 9.x or 10.x); they match our own build and lint patterns, never untrusted input",
    removedBy: "the tools' own releases moving to minimatch 11 (docs/BACKLOG.md, Major dependency upgrades)",
  },
  { advisory: "GHSA-w74x-v6f9-j3xg", ...FAST_URI },
  { advisory: "GHSA-xhq7-xmqj-769h", ...FAST_URI },
  { advisory: "GHSA-wjr9-j795-jxcr", ...FAST_URI },
  { advisory: "GHSA-333x-w4r6-6crp", ...FAST_URI },
];

/** npm audit --json -> [{ advisory, package, severity, title }], one per advisory and package. */
export function advisories(report) {
  const found = new Map();
  // loop: NOT-WORTH — the report's vulnerable packages x their causes (tens), once per CI run
  for (const v of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== "object" || !via) continue; // a string: the advisory sits on that package's own entry
      const advisory = String(via.url ?? via.source)
        .split("/")
        .pop();
      found.set(`${advisory} ${via.name}`, { advisory, package: via.name, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

/** -> problems ([] when every advisory is allowed and every allowlist entry still matches one). */
export function auditProblems(report, allowed = ALLOWED) {
  if (!report || typeof report !== "object" || report.error || !report.vulnerabilities)
    return [`npm audit gave no report (${report?.error?.summary ?? "no vulnerabilities object"}): run it again; the gate never passes on a missing report`];
  const found = advisories(report);
  const isAllowed = (a) => allowed.some((e) => e.advisory === a.advisory && e.package === a.package);
  const problems = found
    .filter((a) => !isAllowed(a))
    .map(
      (a) =>
        `${a.package}: ${a.advisory} (${a.severity}) ${a.title}: update it to a patched exact version at least 14 days old, or add an ALLOWED entry that says why it can't be yet and what removes it`,
    );
  // loop: NOT-WORTH — the allowlist (a handful) x the advisories found (tens)
  for (const e of allowed)
    if (!found.some((a) => a.advisory === e.advisory && a.package === e.package))
      problems.push(`${e.package}: ${e.advisory} is allowlisted but npm audit no longer reports it: remove its ALLOWED entry`);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node tools/audit_gate.mjs <npm audit --json output>");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const problems = auditProblems(report);
  console.log(`audit_gate: ${advisories(report).length} advisories reported, ${ALLOWED.length} allowlisted`);
  // loop: NOT-WORTH — the problems found
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}
