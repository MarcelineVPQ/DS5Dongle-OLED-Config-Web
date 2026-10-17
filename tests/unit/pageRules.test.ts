// The page rules (CLAUDE.md "Page rules"), where they can be checked from the
// source. Rule 3: every settings panel's sub-line is its page's one
// desktop.panelSub string, which says where the settings are kept and how
// they save: no version, no status. (Rules 2, 4, 5 and 6 are checked on the
// rendered pages: gamePage.test.ts' tiles, saveBar.test.ts / oneSaveBar.test.ts,
// accordion.test.ts' section anatomy and "something to do" checks.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS } from "../../src/desktop/accordion/sections";

const ROOT = new URL("../../", import.meta.url).pathname;
const LOCALES = ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"];
const panelSub = (lng: string) => (JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${lng}.json`), "utf8")) as { desktop: { panelSub: Record<string, string> } }).desktop.panelSub;

function files(dir: string): string[] {
  // loop: test — the source tree
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith(".tsx") ? [path] : [];
  });
}

describe("page rule 3: the panel sub-line", () => {
  it("every page has its sub-line string in every language, and none carries a version", () => {
    for (const lng of LOCALES) {
      const subs = panelSub(lng);
      // loop: test
      for (const page of Object.keys(SECTIONS)) {
        expect(subs[page], `${lng}: desktop.panelSub.${page}`).toBeTruthy();
        expect(subs[page], `${lng}: ${page}`).not.toMatch(/\d+\.\d+|\{\{(version|firmware)\}\}/);
      }
    }
  });

  it("every SplitView takes its sub-line from desktop.panelSub (Games → Home through its home panel)", () => {
    const uses = files(join(ROOT, "src/desktop")).flatMap((f) => {
      const text = readFileSync(f, "utf8");
      // loop: test — each <SplitView …> element's props
      return [...text.matchAll(/<SplitView\b([\s\S]*?)>/g)].map((m) => ({ file: relative(ROOT, f), props: m[1] }));
    });
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const { file, props } of uses) {
      const sub = /\bsub=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/.exec(props)?.[1] ?? "";
      expect(sub.includes("desktop.panelSub.") || sub.trim() === "home.sub", `${file}: sub={${sub}}`).toBe(true);
    }
    expect(readFileSync(join(ROOT, "src/desktop/pages/GamesPage.tsx"), "utf8")).toContain('sub: t("desktop.panelSub.games")');
  });
});
