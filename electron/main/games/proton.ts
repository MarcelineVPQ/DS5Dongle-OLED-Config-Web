// Installs our GE-Proton DualSense build. The tarball comes from the update
// manifest (URL + size + SHA-256, ADR-0003) and is verified before anything is
// unpacked. The archive listing is checked so nothing can land outside the one
// folder it is supposed to create, and the folder only appears in the launcher's
// directory once it is completely unpacked (rename). Existing builds are never
// replaced or removed: a new version has a new folder name.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statfsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Download } from "../../../src/update/manifest";

const run = promisify(execFile);

export interface ProtonBuild {
  name: string; // folder name, e.g. GE-Proton11-7-DualSense
  tarball: Download;
}

export type ProtonPhase = { phase: "downloading"; got: number; total: number } | { phase: "verifying" } | { phase: "unpacking" } | { phase: "copying"; target: string };

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

export function hasBuild(dir: string, name: string): boolean {
  return existsSync(join(dir, name, "proton"));
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
  download: (d: Download, path: string, progress: (got: number, total: number) => void, signal?: AbortSignal) => Promise<void>;
}

export interface ExtraTarget {
  dir: string;
  link: boolean; // native launcher: a symlink to the primary copy; Flatpak: a real copy (the sandbox can't follow it)
}

// Install into `primary` (unpacked from the tarball), then make it visible in
// each extra launcher directory.
export async function installProton(build: ProtonBuild, primary: string, copies: ExtraTarget[], deps: InstallDeps, progress: (p: ProtonPhase) => void, signal?: AbortSignal): Promise<string[]> {
  if (!/^GE-Proton[\w.-]+$/.test(build.name)) throw new Error("Invalid Proton build name.");
  mkdirSync(primary, { recursive: true });
  const needed = build.tarball.size * 4; // tarball + unpacked (~3x)
  if (freeBytes(primary) < needed) throw new Error(`Not enough disk space in ${primary}: about ${Math.ceil(needed / 1e9)} GB is needed.`);

  const installed: string[] = [];
  if (!hasBuild(primary, build.name)) {
    // Staging lives next to the target so the final rename never crosses filesystems.
    const staging = mkdtempSync(join(primary, ".ds5-staging-"));
    try {
      const archive = join(staging, `${build.name}.tar.gz`);
      await deps.download(build.tarball, archive, (got, total) => progress({ phase: "downloading", got, total }), signal);
      progress({ phase: "verifying" });
      const { stdout } = await run("tar", ["-tzf", archive], { maxBuffer: 256 * 1024 * 1024 });
      const problem = checkArchiveEntries(stdout.split("\n").filter(Boolean), build.name);
      if (problem) throw new Error(problem);
      progress({ phase: "unpacking" });
      const out = join(staging, "out");
      mkdirSync(out);
      await run("tar", ["-xzf", archive, "-C", out, "--no-same-owner"], { maxBuffer: 16 * 1024 * 1024 });
      if (!hasBuild(out, build.name)) throw new Error("The archive does not contain a Proton build.");
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
      symlinkSync(join(primary, build.name), join(target, build.name), "dir");
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
