// The owner's uniform rule (2026-10-15): nothing folds inside the app's
// pages: no <details>/<summary> disclosures in sections, main-view blocks or
// gate screens; text is shown compact (a long explanation goes behind the ⓘ).
// The accordion's own Sections are the one fold. Menus that pop up over the
// page are not folds: Games' Show menu (GameLibrary.tsx, a <details> used as
// a menu button in the top layer) is the one allowed <details>.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const MENUS = new Set(["src/desktop/library/GameLibrary.tsx"]);

function files(dir: string): string[] {
  // loop: test — walks src/ once
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("no folds in the pages", () => {
  it("has no <details>/<summary> disclosure outside the Show menu", () => {
    const found = files(join(ROOT, "src"))
      .map((path) => relative(ROOT, path))
      .filter((path) => !MENUS.has(path) && /<(details|summary)[\s>]/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(found).toEqual([]);
  });
});
