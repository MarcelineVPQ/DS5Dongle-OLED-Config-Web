// The UI checker's fast plan (tools/check_plan.mjs): the covering arrays
// must really cover every pair, the risky singles and every view per size,
// and be the same plan every run.
import { describe, expect, it } from "vitest";
import { allPairs, assignViews, contrastPlan, layoutPlan, pairCoverage, type Test } from "../../tools/check_plan.mjs";

const LANGS = ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"];
const SIZES = ["1100x900", "900x650"];
const THEMES = ["controller", "light", "dark", "desktop"];
const GROUP_SIZES: Record<string, number> = { controller: 16, dongle: 2, app: 2, about: 5, games: 7, updates: 6 };
const GROUPS = Object.keys(GROUP_SIZES);
const MODELS = ["dualsense", "edge"];
const layout = () => layoutPlan({ langs: LANGS, sizes: SIZES, themes: THEMES, groups: GROUPS, groupSizes: GROUP_SIZES, models: MODELS });

describe("allPairs", () => {
  it("covers every pair of values, with far fewer combinations than the product", () => {
    const factors = { a: ["1", "2", "3"], b: ["x", "y"], c: ["p", "q", "r", "s"], d: ["u", "v"] };
    const tests = allPairs(factors);
    expect(pairCoverage(factors, tests)).toEqual({ pairs: 3 * 2 + 3 * 4 + 3 * 2 + 2 * 4 + 2 * 2 + 4 * 2, covered: 44 });
    expect(tests.length).toBeLessThan(3 * 2 * 4 * 2);
    expect(tests.length).toBeGreaterThanOrEqual(3 * 4); // the two biggest factors
  });

  it("is deterministic for a seed", () => {
    const factors = { lang: LANGS, size: SIZES, theme: THEMES };
    expect(allPairs(factors, { seed: 7 })).toEqual(allPairs(factors, { seed: 7 }));
  });

  it("starts with the required combinations", () => {
    const tests = allPairs({ a: ["1", "2"], b: ["x", "y"] }, { required: [{ a: "2", b: "y" }, { a: "1" }] });
    expect(tests[0]).toEqual({ a: "2", b: "y" });
    expect(tests[1].a).toBe("1");
  });
});

describe("the fast layout plan", () => {
  it("covers every pair of language, size, theme, page group and model", () => {
    const { factors, tests } = layout();
    const { pairs, covered } = pairCoverage(factors, tests);
    expect(covered).toBe(pairs);
  });

  it("checks every view of every group for the long-translation languages at the smallest size", () => {
    const { tests } = layout();
    for (const lang of ["de", "es", "fr", "pt-BR"])
      for (const group of GROUPS) {
        const views = new Set(tests.filter((t) => t.lang === lang && t.size === "900x650" && t.group === group).flatMap((t) => t.views!));
        expect(views.size, `${lang} ${group}`).toBe(GROUP_SIZES[group]);
      }
  });

  it("checks every view at least once per size", () => {
    const { tests } = layout();
    for (const size of SIZES)
      for (const group of GROUPS) {
        const views = new Set(tests.filter((t) => t.size === size && t.group === group).flatMap((t) => t.views!));
        expect(views.size, `${size} ${group}`).toBe(GROUP_SIZES[group]);
      }
  });
});

describe("the fast contrast plan", () => {
  it("covers every pair and every view once per style", () => {
    const { factors, tests } = contrastPlan({ themes: THEMES, styles: ["standard", "glass"], groups: GROUPS, groupSizes: GROUP_SIZES, models: MODELS });
    expect(pairCoverage(factors, tests).covered).toBe(pairCoverage(factors, tests).pairs);
    for (const style of ["standard", "glass"])
      for (const group of GROUPS) expect(new Set(tests.filter((t) => t.style === style && t.group === group).flatMap((t) => t.views!)).size).toBe(GROUP_SIZES[group]);
  });
});

describe("assignViews", () => {
  it("renders a full combination's whole group and slices the rest", () => {
    const tests: Test[] = [
      { group: "g", size: "s", full: true },
      { group: "g", size: "s" },
      { group: "g", size: "t" },
      { group: "g", size: "t" },
    ];
    const out = assignViews(tests, { groupSizes: { g: 8 }, coverKey: "size" });
    expect(out[0].views).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out[1].views).toHaveLength(2); // a quarter: the size is covered already
    expect(new Set([...out[2].views!, ...out[3].views!]).size).toBe(8);
  });
});
