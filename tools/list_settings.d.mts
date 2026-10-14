// Types for tools/list_settings.mjs (for tests/unit/settingsGate.test.ts).
export interface SettingsFinding {
  file: string;
  line: number;
  kind: "card" | "row" | "bare" | "section" | "readout" | "nav";
  detail: string;
}
export const NOT_SETTINGS: Record<string, string>;
export const NAVIGATION_SECTIONS: Record<string, string>;
export const READOUTS_PENDING: Record<string, string>;
export const READOUT_RULE: string;
export function settingsFindings(sources: Array<{ file: string; text: string; lookup?: boolean }>): SettingsFinding[];
export function gateProblems(rows: SettingsFinding[], files: string[]): { bad: SettingsFinding[]; stale: string[] };
