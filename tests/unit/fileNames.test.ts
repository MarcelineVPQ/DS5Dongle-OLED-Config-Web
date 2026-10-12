import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Windows and macOS file systems ignore case: two files whose names differ
// only by case are one file there (0.9.5-dev.3's build broke on
// StickTests.tsx vs stickTests.ts while Linux passed).
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("file names", () => {
  it("no two files differ only by case (case-insensitive file systems)", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const dir of ["src", "electron", "tests", "tools"]) {
      for (const f of walk(dir)) {
        // Same name without extension in the same folder clashes for imports ("./StickTests").
        const key = f.replace(/\.(tsx?|jsx?|mjs|css|json)$/, "").toLowerCase();
        const other = seen.get(key);
        if (other && other !== f) clashes.push(`${other} <-> ${f}`);
        else seen.set(key, f);
      }
    }
    expect(clashes).toEqual([]);
  });
});
