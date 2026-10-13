// Gate for docs/LINT_SUPPRESSIONS.md (quality pass dev.6, F47): every inline
// disable directive in the code is listed in the doc's "Inline disables" table
// (rule + file), and every row there still has its disable. ESLint itself
// fails on a disable that no longer suppresses anything (eslint.config.js).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// The same trees ESLint lints (eslint.config.js ignores the rest).
const DIRS = ["src", "electron", "tools", ".hooks", "site", "tests"];
const IGNORED = /(^|\/)(node_modules|dist|out|release|coverage|tmp)\/|^src\/flash\/picoflash\//;
// A directive is a comment that starts with the directive word.
const DIRECTIVE = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?(?![\w-])([^\n*]*)/g;

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p).split(sep).join("/");
    if (IGNORED.test(rel + (statSync(p).isDirectory() ? "/" : ""))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(p)) files.push(rel);
  }
};
DIRS.forEach((d) => walk(join(ROOT, d)));
files.push(...readdirSync(ROOT).filter((f) => /\.config\.(ts|js)$/.test(f)));

// "rule file" for every directive in the code.
const inCode: string[] = [];
const bare: string[] = [];
for (const file of files) {
  const source = readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
  for (const m of source.matchAll(DIRECTIVE)) {
    const rules = m[1].split("--")[0].trim();
    if (!rules) bare.push(file);
    for (const rule of rules
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean))
      inCode.push(`${rule} ${file}`);
  }
}

const doc = readFileSync(join(ROOT, "docs/LINT_SUPPRESSIONS.md"), "utf8").replace(/\r\n/g, "\n");
const section = doc.split(/^## Inline disables$/m)[1]?.split(/^## /m)[0] ?? "";
const inDoc = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => `${m[1]} ${m[2]}`);

describe("lint suppressions", () => {
  it("the doc has an Inline disables table", () => {
    expect(inDoc.length).toBeGreaterThan(0);
  });

  it("every eslint-disable names its rule", () => {
    expect(bare).toEqual([]);
  });

  it("every inline disable is listed in docs/LINT_SUPPRESSIONS.md", () => {
    expect([...new Set(inCode)].filter((k) => !inDoc.includes(k))).toEqual([]);
  });

  it("every listed disable still exists in the code", () => {
    expect(inDoc.filter((k) => !inCode.includes(k))).toEqual([]);
  });
});
