// Gate for the dependency rule (CLAUDE.md: exact versions, chosen >= 2 weeks
// after release). Quality pass dev.6, F45 + F46: the rule was prose only, and
// 8 caret ranges had crept in.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
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
  const config = parse(read(".github/dependabot.yml")) as {
    updates: { "package-ecosystem": string; cooldown?: { "default-days"?: number }; "commit-message"?: { prefix?: string } }[];
  };

  it("waits at least 14 days after a release for every ecosystem", () => {
    expect(config.updates.length).toBeGreaterThan(0);
    for (const update of config.updates) expect(update.cooldown?.["default-days"] ?? 0, update["package-ecosystem"]).toBeGreaterThanOrEqual(14);
  });

  it("writes Conventional Commits (its prefix is a type the commit gate accepts)", () => {
    for (const update of config.updates) expect(update["commit-message"]?.prefix, update["package-ecosystem"]).toMatch(/^(build|ci|chore)$/);
  });
});

// The CI side of the rule (2026-10-31 reviews: actions by floating tag, Node "22"):
// every action by its full commit SHA with the release as a comment
// (Dependabot's github-actions updates keep both), Node by its exact version.
describe("CI pinning", () => {
  const dir = ".github/workflows";
  const workflows = readdirSync(new URL(`../../${dir}`, import.meta.url)).filter((f) => /\.ya?ml$/.test(f));

  it.each(workflows)("%s: every action is pinned by commit SHA, with its version as a comment", (file) => {
    const uses = [...read(`${dir}/${file}`).matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)].map((m) => m[1].trim());
    expect(uses.filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(u))).toEqual([]);
  });

  it.each(workflows)("%s: Node is an exact version", (file) => {
    const text = read(`${dir}/${file}`);
    const env = /^\s*NODE_VERSION:\s*"?([^"\s]+)"?\s*$/m.exec(text)?.[1];
    const versions = [...text.matchAll(/node-version:\s*(.+)$/gm)].map((m) =>
      m[1]
        .trim()
        .replace(/^"|"$/g, "")
        .replace("${{ env.NODE_VERSION }}", env ?? "(no NODE_VERSION)"),
    );
    expect(versions.filter((v) => !/^\d+\.\d+\.\d+$/.test(v))).toEqual([]);
  });

  it("no Docker: no container jobs and no docker run (the owner never uses Docker)", () => {
    for (const file of workflows) expect(read(`${dir}/${file}`), file).not.toMatch(/^\s*container:|\bdocker\s+run\b/m);
  });
});
