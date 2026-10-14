// Types for tools/list_settings.mjs (for tests/unit/settingsGate.test.ts).
export interface SettingsFinding {
  file: string;
  line: number;
  kind: "card" | "row" | "bare" | "section";
  detail: string;
}
export const PENDING: Record<string, string>;
export const NOT_SETTINGS: Record<string, string>;
export function settingsFindings(sources: Array<{ file: string; text: string }>): SettingsFinding[];
export function gateProblems(rows: SettingsFinding[], files: string[]): { bad: SettingsFinding[]; stale: string[] };
