// Read a launcher's config file, or null if it's missing or doesn't parse.
// Scanning never fails because one file is odd; the launcher just gets no fixes.
import { readFileSync } from "node:fs";

export function readParsed<T>(path: string, parse: (text: string) => T): T | null {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    // error: NOT-WORTH — readParsed's contract: a missing or broken file reads as null, which each caller treats as "not set up"
    return null;
  }
}

// JSON config files, read leniently: a missing or broken file reads as null,
// and obj()/arr() turn anything unexpected into an empty object or list.
export const readJson = (path: string): unknown => readParsed(path, JSON.parse);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
