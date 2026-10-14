// Types for tools/procs_mac.mjs (for tests/unit/budgets.test.ts).
export interface MacProcRow {
  pid: number;
  ppid: number;
  cpuS: number;
  rssKb: number;
  cmd: string;
}
export function parsePsTime(t: string): number;
export function parsePsTable(text: string): MacProcRow[];
export function procTable(): MacProcRow[];
export function appProcs(main: number): Array<MacProcRow & { type: string }>;
