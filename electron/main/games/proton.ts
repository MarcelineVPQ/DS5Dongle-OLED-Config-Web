// Installs our GE-Proton DualSense build. The tarball comes from the update
// manifest (URL + size + SHA-256, ADR-0003) and is verified before anything is
// unpacked. Before unpacking, every archive path must sit inside the one folder
// it creates; after unpacking (in an isolated staging folder), every symlink must
// point inside that folder too. Only then does the folder appear in the
// launcher's directory (rename). Existing builds are never replaced or removed:
// a new version has a new folder name.
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, renameSync, rmSync, statfsSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProtonProgress } from "../../../src/desktop/api";
import { compareProtonNames, PROTON_NAME, type Download } from "../../../src/update/manifest";
import { readParsed } from "./files";

const run = promisify(execFile);

export interface ProtonBuild {
  name: string; // folder name, e.g. GE-Proton11-7-DualSense
  tarball: Download;
}

// Every entry must live under `<name>/`, with no absolute paths or `..`.
export function checkArchiveEntries(entries: string[], name: string): string | null {
  if (entries.length === 0) return "The archive is empty.";
  for (const raw of entries) {
    const e = raw.replace(/^\.\//, "");
    if (e.startsWith("/") || e.split("/").includes("..")) return `Unsafe path in archive: ${raw}`;
    if (e !== `${name}/` && e !== name && !e.startsWith(`${name}/`)) return `Unexpected entry outside ${name}/: ${raw}`;
  }
  return null;
}

// After unpacking: the build folder is a real folder and every symlink in it
// resolves inside it (absolute or escaping targets are refused).
export function checkUnpackedTree(root: string): string | null {
  if (!lstatSync(root).isDirectory()) return "The archive's top folder is not a folder.";
  const walk = (dir: string): string | null => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) {
        const to = readlinkSync(path);
        const rel = relative(root, resolve(dirname(path), to));
        if (isAbsolute(to) || rel.startsWith("..") || isAbsolute(rel)) return `Link points outside the build: ${relative(root, path)} -> ${to}`;
      } else if (st.isDirectory()) {
        const problem = walk(path);
        if (problem) return problem;
      }
    }
    return null;
  };
  return walk(root);
}

export function hasBuild(dir: string, name: string): boolean {
  return existsSync(join(dir, name, "proton"));
}

// Folder names in `dir` that hold a Proton build (a `proton` script).
export function protonBuilds(dir: string): string[] {
  try {
    // loop: NOT-WORTH — folders in one tools dir, a stat each
    return readdirSync(dir).filter((d) => hasBuild(dir, d));
  } catch {
    // error: NOT-WORTH — no tools folder: no builds
    return [];
  }
}

// ---- What a build's name says ----
// Our builds are GE-Proton<major>-<minor>-DualSense; a rebuild of the same GE
// version adds .N to the minor (GE-Proton11-7.2-DualSense). One reading of
// the folder name and the build's `version` file ("<timestamp> <name>"),
// used by the PROTON_PREFER_SDL check.
export interface BuildName {
  ours: boolean; // one of our DualSense builds
  major: number; // GE-Proton major version, 0 when not a GE-Proton name
  revision: number; // our .N rebuild number (1 without one)
}
export function dualSenseBuild(name: string, versionText?: string | null): BuildName {
  const texts = [name, versionText ?? ""];
  // loop: NOT-WORTH — 2 texts (name, version file)
  const first = (re: RegExp) => texts.map((t) => re.exec(t)?.[1]).find((v) => v !== undefined);
  return {
    // loop: NOT-WORTH — 2 texts (name, version file)
    ours: texts.some((t) => /DualSense/i.test(t)),
    major: Number(first(/GE-Proton(\d+)/) ?? 0),
    // loop: NOT-WORTH — 2 texts (name, version file)
    revision: Math.max(1, ...texts.map((t) => Number(/GE-Proton\d+-\d+\.(\d+)-DualSense\b/i.exec(t)?.[1] ?? 1))),
  };
}

// ---- PROTON_PREFER_SDL (standard gamepad for XInput-only games) ----
// Our DualSense builds up to GE-Proton11-7-DualSense pass the DualSense raw
// whatever the game asks for, so they ignore PROTON_PREFER_SDL; rebuilds
// with a .2 or later revision (GE-Proton11-7.2-DualSense: folder name, or the
// build's `version` file) honour it, as stock GE-Proton and Valve's Proton always have.
export function honoursPreferSdl(name: string, versionText?: string | null): boolean {
  const b = dualSenseBuild(name, versionText);
  return !b.ours || b.revision >= 2;
}

// A build's `version` file ("<timestamp> <name>"), from the first of these
// build folders that has one; null when none does.
// During a library scan each file is read once (readParsed's scan texts), so
// the games sharing a build don't read its `version` again.
export function buildVersion(folders: string[]): string | null {
  // loop: NOT-WORTH — 1-3 build folders; each version file read once per scan (readParsed's scan texts, loop pass batch 3)
  for (const folder of folders) {
    const text = readParsed(join(folder, "version"), (t) => t.slice(0, 200).trim());
    if (text !== null) return text;
  }
  return null;
}

// Does the build `name` (found in one of `dirs`) honour PROTON_PREFER_SDL?
// loop: NOT-WORTH — 1-3 build folders
export const buildHonoursPreferSdl = (name: string, dirs: string[]) => honoursPreferSdl(name, buildVersion(dirs.map((d) => join(d, name))));

// A build's GE version [major, minor, our .N revision], from its `version`
// file (GE-Proton-latest says which build it is) or else its folder name;
// null when neither names a GE-Proton version (Valve's Proton, Wine builds).
export function buildVersionKey(name: string, dirs: string[]): number[] | null {
  // loop: NOT-WORTH — 1-3 build folders
  const fromFile = buildVersion(dirs.map((d) => join(d, name)))?.split(/\s+/)[1] ?? "";
  // loop: NOT-WORTH — 2 texts (version file, name)
  for (const text of [fromFile, name]) {
    const m = /GE-Proton(\d+)-(\d+)(?:\.(\d+))?/.exec(text);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
  }
  return null;
}
// loop: NOT-WORTH — 3-part version keys
const compareKeys = (a: number[], b: number[]) => a.reduce((d, v, i) => d || v - (b[i] ?? 0), 0);

// The build to move a game to: the newest of our builds that `ok` accepts,
// else the newest stock GE-Proton it accepts; ordered by GE version (not by
// folder name), and never one older than the game's `current` build.
export function pickBuild(names: string[], dirs: string[], ok: (name: string) => boolean, current?: string | null): string | null {
  const floor = current ? buildVersionKey(current, dirs) : null;
  // loop: NOT-WORTH — installed builds, only for games that need a switch
  const keyed = names.flatMap((n) => {
    const key = buildVersionKey(n, dirs);
    return key && (!floor || compareKeys(key, floor) >= 0) && ok(n) ? [{ n, key }] : [];
  });
  // loop: NOT-WORTH — installed builds, copied and sorted
  const newest = (list: typeof keyed) => [...list].sort((a, b) => compareKeys(b.key, a.key) || compareProtonNames(b.n, a.n))[0]?.n ?? null;
  // loop: NOT-WORTH — installed builds
  return newest(keyed.filter((b) => PROTON_NAME.test(b.n))) ?? newest(keyed.filter((b) => /^GE-Proton/.test(b.n) && !/DualSense|DS5/i.test(b.n)));
}

// The build to move a game to when its runner ignores PROTON_PREFER_SDL.
export const preferSdlBuild = (names: string[], dirs: string[], current?: string | null) => pickBuild(names, dirs, (n) => buildHonoursPreferSdl(n, dirs), current);

function freeBytes(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    // error: NOT-WORTH — free space unknown: the install goes ahead, and a full disk fails it with its own message
    return Number.POSITIVE_INFINITY;
  }
}

export interface InstallDeps {
  download: (d: Download, path: string, progress: (got: number, total: number) => void) => Promise<void>;
}

// Leftovers from an install that was interrupted (app closed, crash).
function cleanStaging(dir: string): void {
  try {
    for (const d of readdirSync(dir)) if (d.startsWith(".ds5-staging-")) rmSync(join(dir, d), { recursive: true, force: true });
  } catch {
    // error: NOT-WORTH — dir not there yet
  }
}

export interface ExtraTarget {
  dir: string;
  link: boolean; // native launcher: a symlink to the primary copy; Flatpak: a real copy (the sandbox can't follow it)
}

// Install into `primary` (unpacked from the tarball), then make it visible in
// each extra launcher directory.
export async function installProton(build: ProtonBuild, primary: string, copies: ExtraTarget[], deps: InstallDeps, progress: (p: ProtonProgress) => void): Promise<string[]> {
  if (!PROTON_NAME.test(build.name)) throw new Error("Invalid Proton build name.");
  mkdirSync(primary, { recursive: true });
  for (const dir of [primary, ...copies.map((c) => c.dir)]) cleanStaging(dir);
  // Tarball + unpacked (~3x) in the primary folder, plus a full copy per Flatpak launcher.
  const unpacked = build.tarball.size * 3;
  const needs = new Map<string, number>([[primary, build.tarball.size + unpacked]]);
  for (const c of copies) if (!c.link && !hasBuild(c.dir, build.name)) needs.set(c.dir, (needs.get(c.dir) ?? 0) + unpacked);
  for (const [dir, needed] of needs) {
    mkdirSync(dir, { recursive: true });
    if (freeBytes(dir) < needed) throw new Error(`Not enough disk space in ${dir}: about ${Math.ceil(needed / 1e9)} GB is needed.`);
  }

  const installed: string[] = [];
  if (!hasBuild(primary, build.name)) {
    // Staging lives next to the target so the final rename never crosses filesystems.
    const staging = mkdtempSync(join(primary, ".ds5-staging-"));
    try {
      const archive = join(staging, `${build.name}.tar.gz`);
      await deps.download(build.tarball, archive, (got, total) => progress({ phase: "downloading", got, total }));
      progress({ phase: "verifying" });
      const { stdout } = await run("tar", ["-tzf", archive], { maxBuffer: 256 * 1024 * 1024 });
      const problem = checkArchiveEntries(stdout.split("\n").filter(Boolean), build.name);
      if (problem) throw new Error(problem);
      progress({ phase: "unpacking" });
      const out = join(staging, "out");
      mkdirSync(out);
      await run("tar", ["-xzf", archive, "-C", out, "--no-same-owner"], { maxBuffer: 16 * 1024 * 1024 });
      if (!hasBuild(out, build.name)) throw new Error("The archive does not contain a Proton build.");
      const unsafe = checkUnpackedTree(join(out, build.name));
      if (unsafe) throw new Error(unsafe);
      renameSync(join(out, build.name), join(primary, build.name));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  installed.push(join(primary, build.name));

  // loop: SERIAL-REQUIRED — install order: each copy or link of the one unpacked build, then report
  for (const { dir: target, link } of copies) {
    if (hasBuild(target, build.name)) {
      installed.push(join(target, build.name));
      continue;
    }
    mkdirSync(target, { recursive: true });
    const existing = join(target, build.name);
    const there = lstatSync(existing, { throwIfNoEntry: false });
    // A folder of that name without a build in it (an interrupted manual
    // copy?) isn't ours to replace: that launcher is skipped, the rest go on.
    if (there && !there.isSymbolicLink()) continue;
    if (link) {
      // A dangling link from an earlier, removed build is replaced; anything else is left alone.
      if (there?.isSymbolicLink()) rmSync(existing);
      symlinkSync(join(primary, build.name), existing, "dir");
    } else {
      progress({ phase: "copying", target });
      const staging = mkdtempSync(join(target, ".ds5-staging-"));
      try {
        await run("cp", ["-a", join(primary, build.name), join(staging, build.name)]);
        renameSync(join(staging, build.name), join(target, build.name));
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
    installed.push(join(target, build.name));
  }
  return installed;
}
