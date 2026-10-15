// The owner's uniform rule (2026-10-15): nothing folds inside the app's
// pages: no <details>/<summary> disclosures in sections, main-view blocks or
// gate screens; text is shown compact (a long explanation goes behind the ⓘ).
// The accordion's own Sections are the one fold; every popup menu is a
// MenuButton (the panel's ⋮, Games' Show). No <details> / <summary> at all.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

function files(dir: string): string[] {
  // loop: test — walks src/ once
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("no folds in the pages", () => {
  it("has no <details>/<summary> anywhere in src/", () => {
    const found = files(join(ROOT, "src"))
      .map((path) => relative(ROOT, path).split(sep).join("/"))
      .filter((path) => /<(details|summary)[\s>]/.test(readFileSync(join(ROOT, ...path.split("/")), "utf8")));
    expect(found).toEqual([]);
  });
});
