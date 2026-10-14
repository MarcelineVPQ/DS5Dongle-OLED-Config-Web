// Windows portable exe: leftovers in %TEMP% from earlier runs.
//
// Each start of the portable exe (electron-builder's NSIS launcher) copies the
// packed app to an "ns????.tmp" folder (app-64.7z, ~230 MB, and 7z-out, ~420 MB)
// and the app itself to a build-named folder (~420 MB), and deletes both when
// the app quits. A launcher that is stopped before that (killed, or ended at
// sign-out/shutdown while the app sits in the tray) leaves ~1 GB behind every
// time; the Win11 test VM had 46 such folders, 24.6 GB (2026-10-14). On start,
// the app removes the ones that are clearly its own and not in use.
import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// A folder touched within this long may belong to a launcher that is unpacking
// right now (a second start): left alone.
export const LEFTOVER_MIN_AGE_MS = 10 * 60_000;

// NSIS's plugins folder, and the build-named unpack folder (a 27-character id).
const NSIS_DIR = /^ns[a-z0-9]{1,8}\.tmp$/i;
const UNPACK_DIR = /^[0-9A-Za-z]{27}$/;

const mtime = (path: string): number => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;

// The leftover folders in `temp`: NSIS folders holding this app's unpacked
// copy, and unpack folders of this app other than `ownDir` (the running copy),
// none touched in the last LEFTOVER_MIN_AGE_MS.
export function findLeftovers(temp: string, ownDir: string, exeName: string, now: number): string[] {
  let names: string[];
  try {
    names = readdirSync(temp);
  } catch {
    // error: NOT-WORTH — Temp unreadable: nothing to tidy this start
    return [];
  }
  const out: string[] = [];
  // loop: NOT-WORTH — once per start, a stat or two only for the folders whose names match
  for (const name of names) {
    const dir = join(temp, name);
    if (dir === ownDir) continue;
    let ours = false;
    let touched = 0;
    if (NSIS_DIR.test(name)) {
      const out7z = join(dir, "7z-out");
      ours = existsSync(join(out7z, exeName));
      touched = Math.max(mtime(dir), mtime(out7z));
    } else if (UNPACK_DIR.test(name)) {
      // Not resources/app.asar itself: Electron's fs opens an .asar it is asked
      // about and keeps it open, and an open file can't be deleted.
      ours = existsSync(join(dir, exeName)) && existsSync(join(dir, "resources"));
      touched = mtime(dir);
    }
    if (ours && now - touched >= LEFTOVER_MIN_AGE_MS) out.push(dir);
  }
  return out;
}

const removeDir = (dir: string) => rm(dir, { recursive: true, force: true });

// Removes the leftovers of the portable exe in the background. Files still in
// use stay (that folder is tried again at the next start). In the app, `remove`
// must not see .asar files as folders (Electron's fs does; index.ts passes
// original-fs), or every app.asar stays behind.
export async function pruneUnpackLeftovers(execPath = process.execPath, now = Date.now(), remove: (dir: string) => Promise<void> = removeDir): Promise<string[]> {
  const ownDir = dirname(execPath);
  const removed: string[] = [];
  // loop: SERIAL-REQUIRED — one folder at a time keeps the disk work at start-up small (a few folders at most once tidy)
  for (const dir of findLeftovers(dirname(ownDir), ownDir, basename(execPath), now)) {
    try {
      await remove(dir);
      removed.push(dir);
    } catch (cause) {
      // error: LOGGED-OK — a file in that folder is still in use (a launcher waiting on it); the next start tries again
      console.warn("portable leftovers: couldn't remove", dir, cause instanceof Error ? cause.message : cause);
    }
  }
  return removed;
}
