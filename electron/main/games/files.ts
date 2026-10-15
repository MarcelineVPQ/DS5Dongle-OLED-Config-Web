// Read a launcher's config file, or null if it's missing or doesn't parse.
// Scanning never fails because one file is odd; the launcher just gets no fixes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The texts of one library scan (loop pass batch 3): the per-game files read
// ahead in parallel before the synchronous scan runs, and every other file
// the scan reads kept after its first read, so a file shared by many games (a
// Proton build's `version`, localconfig.vdf for the list and the details) is
// read once per scan. null = missing or unreadable.
export type ScanTexts = Map<string, string | null>;
// cache: OK — key=file path; invalidated=dropped when withScanTexts returns (one scan); bound=the files one scan reads
let scanTexts: ScanTexts | null = null;

export function readParsed<T>(path: string, parse: (text: string) => T): T | null {
  try {
    let text = scanTexts?.get(path);
    if (text === undefined) {
      text = readText(path);
      scanTexts?.set(path, text);
    }
    return text === null ? null : parse(text);
  } catch {
    // error: NOT-WORTH — readParsed's contract: a missing or broken file reads as null, which each caller treats as "not set up"
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // error: NOT-WORTH — readParsed's contract: a missing file reads as null ("not set up")
    return null;
  }
}

// Run the synchronous scan `fn` with `texts` as its file cache.
export function withScanTexts<T>(texts: ScanTexts, fn: () => T): T {
  scanTexts = texts;
  try {
    return fn();
  } finally {
    scanTexts = null;
  }
}

// The files in `dir` whose names match `name` (none when it's missing).
export function filesIn(dir: string, name: RegExp): string[] {
  try {
    // loop: NOT-WORTH — names in one launcher folder, a regex test each; once per scan
    return readdirSync(dir)
      .filter((f) => name.test(f))
      .map((f) => join(dir, f));
  } catch {
    // error: NOT-WORTH — no such folder: nothing to read ahead there
    return [];
  }
}

// Read `paths` in parallel, at most `bound` at a time, off the main thread's
// critical path (fs.promises), into a scan's texts.
export async function readAhead(paths: string[], bound = 8): Promise<ScanTexts> {
  const texts: ScanTexts = new Map();
  const queue = [...new Set(paths)];
  const worker = async () => {
    // loop: PARALLELIZE — the scan's per-game files, `bound` (8) workers taking the next path each
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      // error: NOT-WORTH — readParsed's contract: a missing or unreadable file reads as null ("not set up")
      texts.set(path, await readFile(path, "utf8").catch(() => null));
    }
  };
  // loop: NOT-WORTH — N = bound (8) workers
  await Promise.all(Array.from({ length: Math.min(bound, queue.length) }, worker));
  return texts;
}

// JSON config files, read leniently: a missing or broken file reads as null,
// and obj()/arr() turn anything unexpected into an empty object or list.
// A file's or folder's modification time, or null when it isn't there.
export const mtimeOf = (path: string): number | null => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null;

export const readJson = (path: string): unknown => readParsed(path, JSON.parse);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
