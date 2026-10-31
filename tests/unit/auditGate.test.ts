// The npm audit gate (tools/audit_gate.mjs): an advisory fails unless it is
// allowlisted, and an allowlist entry that matches nothing fails too.
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ESM tool script without types
import * as gate from "../../tools/audit_gate.mjs";

type Entry = { advisory: string; package: string; why: string; removedBy: string };
const { ALLOWED, auditProblems } = gate as { ALLOWED: Entry[]; auditProblems: (report: unknown, allowed?: Entry[]) => string[] };

const via = (name: string, ghsa: string, severity = "moderate") => ({ source: 1, name, title: `${name} is bad`, url: `https://github.com/advisories/${ghsa}`, severity, range: "<9" });
const report = (vias: ReturnType<typeof via>[]) => ({
  vulnerabilities: Object.fromEntries(vias.map((v) => [v.name, { name: v.name, severity: v.severity, via: [v], effects: [] }])),
});
const allowed = [{ advisory: "GHSA-aaaa-bbbb-cccc", package: "minimatch", why: "test", removedBy: "test" }];

describe("the npm audit gate", () => {
  it("passes when every advisory is allowlisted and every entry matches", () => {
    const r = report([via("minimatch", "GHSA-aaaa-bbbb-cccc")]);
    // A package that only depends on a vulnerable one names it as a string: no advisory of its own.
    (r.vulnerabilities as Record<string, unknown>).eslint = { name: "eslint", severity: "moderate", via: ["minimatch"], effects: [] };
    expect(auditProblems(r, allowed)).toEqual([]);
  });

  it("fails on an advisory that isn't allowlisted, high or not", () => {
    expect(auditProblems(report([via("minimatch", "GHSA-aaaa-bbbb-cccc"), via("undici", "GHSA-4qv8-2p9j-2685", "high")]), allowed)).toEqual([
      expect.stringMatching(/^undici: GHSA-4qv8-2p9j-2685 \(high\)/),
    ]);
  });

  it("fails on an allowlist entry npm audit no longer reports", () => {
    expect(auditProblems(report([]), allowed)).toEqual([expect.stringMatching(/GHSA-aaaa-bbbb-cccc is allowlisted but npm audit no longer reports it/)]);
  });

  it("fails on a missing or failed report", () => {
    expect(auditProblems({ error: { summary: "ENOTFOUND" } }, allowed)).toEqual([expect.stringMatching(/ENOTFOUND/)]);
    expect(auditProblems(null, allowed)).toHaveLength(1);
  });

  it("every allowlist entry says why and what removes it", () => {
    for (const e of ALLOWED) {
      expect(e.advisory).toMatch(/^GHSA-[\w-]+$/);
      expect(e.why.length, e.advisory).toBeGreaterThan(20);
      expect(e.removedBy.length, e.advisory).toBeGreaterThan(10);
    }
  });
});
