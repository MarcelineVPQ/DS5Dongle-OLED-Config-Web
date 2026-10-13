// Gate for the dependency rule (CLAUDE.md: exact versions, chosen >= 2 weeks
// after release). Quality pass dev.6, F45 + F46: the rule was prose only, and
// 8 caret ranges had crept in.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string> | undefined>;
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
// An exact semver ("1.2.3", "1.2.3-beta.1"); no ranges, tags, URLs or "*".
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe("dependency pinning", () => {
  for (const section of SECTIONS) {
    it(`${section}: every version is exact (no ^, ~, ranges or tags)`, () => {
      const loose = Object.entries(pkg[section] ?? {}).filter(([, version]) => !EXACT.test(version));
      expect(loose, `pin these to the installed version`).toEqual([]);
    });
  }

  it("the lockfile's root entry matches package.json (npm ci installs what package.json says)", () => {
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, Record<string, Record<string, string> | undefined>> };
    const root = lock.packages[""];
    for (const section of SECTIONS) expect(root[section] ?? {}, section).toEqual(pkg[section] ?? {});
  });

  it(".npmrc saves exact versions", () => {
    expect(read(".npmrc")).toMatch(/^save-exact\s*=\s*true\s*$/m);
  });
});

describe("Dependabot", () => {
  const config = parse(read(".github/dependabot.yml")) as { updates: { "package-ecosystem": string; cooldown?: { "default-days"?: number } }[] };

  it("waits at least 14 days after a release for every ecosystem", () => {
    expect(config.updates.length).toBeGreaterThan(0);
    for (const update of config.updates) expect(update.cooldown?.["default-days"] ?? 0, update["package-ecosystem"]).toBeGreaterThanOrEqual(14);
  });
});
