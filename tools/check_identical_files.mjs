#!/usr/bin/env node
// Gate: no byte-identical files, in this repo or across the app and firmware
// repos (quality pass dev.6, F48: the same screenshot was committed 3 times
// across both, F39). A copy drifts; keep one and link or import it.
//
//   node tools/check_identical_files.mjs              this repo (npm run gates)
//   node tools/check_identical_files.mjs ../DS5Dongle  this repo + the firmware
//
// The firmware's tools/release.sh can run it from the app repo:
//   (cd "$APP_DIR" && node tools/check_identical_files.mjs "$FW_DIR")
//
// Only git-tracked regular files count (no submodules, no symlinks, no empty
// files). Each repo is labeled by its origin remote (app / firmware), so the
// allowlist below works from any checkout or worktree. Exit 1 on a group of
// identical files that isn't in the allowlist, or an allowlist entry that no
// longer matches (fixed: take it out).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Each entry: the exact set of "label:path" files that are allowed to be
// identical, and why (the review finding and the batch that removes it).
const ALLOWED = [
  {
    files: ["app:docs/screenshots/live-controller.png", "firmware:docs/screenshots/live-controller.png"],
    why: "F39 (quality pass dev.6): the app side is done (batch 6: GUIDE.md uses live-controller.png); the firmware repo removes its copy and its READMEs link the app copy's raw URL",
  },
  {
    files: ["app:assets-src/edge/LICENSE", "app:src/assets/DAIDR-LICENSE.txt"],
    why: "intended: daidr's MIT notice travels with each copy of the art (the source art, and the art bundled into the app)",
  },
];

const REPO_LABELS = { "DS5Dongle-OLED-Config-Web": "app", "DS5Dongle-OLED-Edition": "firmware" };
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

const labelOf = (dir) => {
  let name = basename(dir);
  try {
    name = basename(git(dir, "remote", "get-url", "origin").trim()).replace(/\.git$/, "");
  } catch {
    // no origin: fall back to the folder name
  }
  return REPO_LABELS[name] ?? name;
};

const self = resolve(new URL("..", import.meta.url).pathname);
const repos = [self, ...process.argv.slice(2).map((d) => resolve(d))];
const byHash = new Map();
const labels = new Set();
for (const dir of repos) {
  const top = git(dir, "rev-parse", "--show-toplevel").trim();
  const label = labelOf(top);
  if (labels.has(label)) throw new Error(`two repos labeled "${label}" (${top})`);
  labels.add(label);
  // "mode sha stage\tpath", NUL-separated; 100644/100755 are regular files.
  for (const entry of git(top, "ls-files", "-s", "-z").split("\0")) {
    const m = /^(100644|100755) [0-9a-f]+ \d+\t(.+)$/s.exec(entry);
    if (!m) continue;
    const path = join(top, m[2]);
    let size;
    try {
      size = statSync(path).size;
    } catch {
      continue; // deleted in the working tree, not yet committed
    }
    if (size === 0) continue;
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(`${label}:${m[2]}`);
  }
}

const key = (files) => [...files].sort().join("\n");
// An allowlist entry is checked only when every repo it names was scanned.
const inScope = ALLOWED.filter((a) => a.files.every((f) => labels.has(f.split(":")[0])));
// From the app repo alone, an entry's app-side files are what's expected.
const expected = new Map(inScope.map((a) => [key(a.files), a]));
for (const a of ALLOWED.filter((x) => !inScope.includes(x))) {
  const local = a.files.filter((f) => labels.has(f.split(":")[0]));
  if (local.length > 1) expected.set(key(local), a);
}

const groups = [...byHash.values()].filter((g) => g.length > 1);
const unexpected = groups.filter((g) => !expected.has(key(g)));
const seen = new Set(groups.map(key));
const stale = [...expected.keys()].filter((k) => !seen.has(k));

if (unexpected.length || stale.length) {
  if (unexpected.length) {
    console.log(
      `Identical-files gate: byte-identical files in ${[...labels].join(" + ")} (keep one and link or import it, or allowlist it in tools/check_identical_files.mjs with the finding that removes it):`,
    );
    for (const g of unexpected) console.log(`  ${g.join("  =  ")}`);
  }
  if (stale.length) {
    console.log("Identical-files gate: allowlist entries that no longer match (fixed? take them out):");
    for (const k of stale) console.log(`  ${k.split("\n").join("  =  ")}`);
  }
  process.exit(1);
}
