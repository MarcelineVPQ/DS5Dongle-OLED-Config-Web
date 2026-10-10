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
import { PROTON_NAME, type Download } from "../../../src/update/manifest";

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
    return readdirSync(dir).filter((d) => hasBuild(dir, d));
  } catch {
    return [];
  }
}

function freeBytes(dir: string): number {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
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
    // dir not there yet
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

  for (const { dir: target, link } of copies) {
    if (hasBuild(target, build.name)) {
      installed.push(join(target, build.name));
      continue;
    }
    mkdirSync(target, { recursive: true });
    if (link) {
      // A dangling link from an earlier, removed build is replaced; anything else is left alone.
      const existing = join(target, build.name);
      if (lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(existing);
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
