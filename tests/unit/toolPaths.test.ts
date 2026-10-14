// The gate listers skip paths by their place in the repo, never by the
// checkout's own path: a copy under ".../out/dist/release/node_modules/about-light/" lists
// exactly what the repo itself lists. (The duplicates lister used to match
// "out" anywhere in the absolute path, so it skipped every file in such a
// checkout, and every file with "out" in its name, like check_layout.mjs.)
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const run = (cwd: string, tool: string) => execFileSync(process.execPath, [join(cwd, tool)], { cwd, encoding: "utf8", maxBuffer: 1 << 26 });

let base: string;
let copy: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "toolpaths-"));
  copy = join(base, "out", "dist", "release", "node_modules", "about-light");
  mkdirSync(join(copy, "docs"), { recursive: true });
  // loop: test
  for (const d of ["src", "electron", "tools", ".hooks"]) cpSync(join(ROOT, d), join(copy, d), { recursive: true });
  cpSync(join(ROOT, "docs/DEDUPE_AUDIT.md"), join(copy, "docs/DEDUPE_AUDIT.md"));
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"), "junction");
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("gate listers in a checkout whose path has out, dist, release and node_modules in it", () => {
  it("the duplicates lister lists the same rows", () => {
    const rows = run(copy, "tools/list_duplicates.mjs");
    expect(rows.split("\n").length).toBeGreaterThan(50);
    expect(rows).toBe(run(ROOT, "tools/list_duplicates.mjs"));
  });

  it("the TypeScript listers (loops; caches, errors and lifetimes share its program) list the same rows", () => {
    const rows = run(copy, "tools/list_loops.mjs");
    expect(rows.split("\n").length).toBeGreaterThan(100);
    expect(rows).toBe(run(ROOT, "tools/list_loops.mjs"));
  }, 60_000);
});
