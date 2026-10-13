// Types for tools/check_plan.mjs (for tests/unit/checkPlan.test.ts).
export type Test = { [factor: string]: string | boolean | number[] | undefined; full?: boolean; views?: number[] };
export function rng(seed: number): () => number;
export function allPairs(factors: Record<string, string[]>, options?: { seed?: number; required?: Record<string, string>[]; candidates?: number }): Test[];
export function pairCoverage(factors: Record<string, string[]>, tests: Test[]): { pairs: number; covered: number };
export function sortTests(tests: Test[], keys: string[]): Test[];
export function assignViews(tests: Test[], options: { groupSizes: Record<string, number>; coverKey: string }): Test[];
export const RISKY_LANGS: string[];
export function layoutPlan(options: {
  langs: string[];
  sizes: string[];
  themes: string[];
  groups: string[];
  groupSizes: Record<string, number>;
  models: string[];
  riskyLangs?: string[];
  seed?: number;
}): { factors: Record<string, string[]>; tests: Test[] };
export function contrastPlan(options: { themes: string[]; styles: string[]; groups: string[]; groupSizes: Record<string, number>; models: string[]; seed?: number }): {
  factors: Record<string, string[]>;
  tests: Test[];
};
export function estimateMs(tests: Test[], options: { reloadKeys: string[]; viewsOf: (t: Test) => { cost: number }[]; reloadMs?: number }): number;
export function minutes(ms: number): string;
