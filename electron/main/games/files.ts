// Read a launcher's config file, or null if it's missing or doesn't parse.
// Scanning never fails because one file is odd; the launcher just gets no fixes.
import { readFileSync } from "node:fs";

export function readParsed<T>(path: string, parse: (text: string) => T): T | null {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
