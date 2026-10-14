// Types for tools/budgets_lib.mjs (for tests/unit/budgets.test.ts).
export interface ProcSample {
  pid: number;
  type: string;
  ticks: number;
}
export interface PageResult {
  page: string;
  framesPerS: number;
  cpu: Record<string, number>;
  reached?: boolean;
}
export interface Results {
  mode: string;
  pages: PageResult[];
  hidden: { secs: number; cpu: Record<string, number>; pageSawHide?: boolean } | null;
  memory: { atS: number; mb: number; byType?: Record<string, number> } | null;
  soak: { windowS: number; samples: Array<{ t: number; mb: number }> } | null;
}
export interface Row {
  budget: string;
  scope: string;
  measured: number | null;
  limit: string;
  unit: string;
  verdict: "PASS" | "FAIL" | "INFO" | "SKIP";
}
export interface BudgetConfig {
  pages: string[];
  budgets: Record<"idleFrames" | "shownCpu" | "hiddenCpu" | "memory" | "growth", { max: number; unit: string; what: string }>;
  modes: Record<string, Record<string, number>>;
}
export function parseStat(text: string): { ppid: number; ticks: number };
export function procType(cmdline: string): string;
export function parsePssKb(text: string): number | null;
export function descendants(root: number, procs: Array<{ pid: number; ppid: number }>): number[];
export function cpuByType(before: ProcSample[], after: ProcSample[], secs: number, hz?: number): Record<string, number>;
export function cpuTotal(byType: Record<string, number>, exclude?: string[]): number;
export const GPU_TYPE: string;
export const MEASUREMENT_TYPES: string[];
export function memoryJudged(memory: { mb: number; byType?: Record<string, number> }): number;
export function perSecond(count: number | undefined, secs: number): number;
export function growthPerWindow(samples: Array<{ t: number; mb: number }>, windowS: number): number | null;
export function judgeBudgets(config: BudgetConfig, results: Results): Row[];
export function passed(rows: Row[]): boolean;
export function formatTable(rows: Row[]): string;
