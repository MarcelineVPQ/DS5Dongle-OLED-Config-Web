// Types for tools/procs_windows.mjs (for tests/unit/budgets.test.ts).
export interface WinProcRow {
  pid: number;
  ppid: number;
  ticks: number;
  cmd: string;
  memKb: number | null;
  commitKb: number;
}
export function winQueryScript(exeName: string, memory?: boolean): string;
export function parseWinProcs(json: string): WinProcRow[];
export function windowsReader(execPath: string): {
  hz: number;
  memoryMetric: string;
  appProcs(main: number, opts?: { memory?: boolean }): Array<WinProcRow & { type: string }>;
};
