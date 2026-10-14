// Types for tools/list_hints.mjs (for tests/unit/hintGate.test.ts).
export interface HintFinding {
  file: string;
  line: number;
  kind: "sub" | "hint";
  length: number;
  key: string;
  mustShow: boolean;
}
export const HINT_LIMIT: number;
export function flatten(obj: unknown, prefix?: string, out?: Map<string, string>): Map<string, string>;
export function hintFindings(sources: { file: string; text: string }[], strings: Map<string, string>, limit?: number): HintFinding[];
