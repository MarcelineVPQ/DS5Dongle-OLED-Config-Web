#!/usr/bin/env node
// Version management. package.json "version" is the single source of truth
// (the AVNetworkMonitor version.py / update_version.py pattern).
//
//   node tools/update_version.mjs 1.2.3   set the version everywhere
//   node tools/update_version.mjs         sync everything to package.json
//   node tools/update_version.mjs --verify   exit 1 if anything disagrees
//
// Synced: package-lock.json (root + packages[""]), and CHANGELOG.md must have
// a "## [x.y.z]" section (or [Unreleased] while developing).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => join(root, p);
const readJson = (p) => JSON.parse(readFileSync(file(p), "utf8"));
const writeJson = (p, v) => writeFileSync(file(p), JSON.stringify(v, null, 2) + "\n");
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const requested = args.find((a) => !a.startsWith("--"));

const pkg = readJson("package.json");
if (requested && !SEMVER.test(requested)) {
  console.error(`Not a version: ${requested} (expected x.y.z)`);
  process.exit(1);
}
const version = requested ?? pkg.version;

const problems = [];
const lock = readJson("package-lock.json");
if (pkg.version !== version) problems.push(`package.json is ${pkg.version}`);
if (lock.version !== version) problems.push(`package-lock.json is ${lock.version}`);
if (lock.packages?.[""]?.version !== version) problems.push(`package-lock.json packages[""] is ${lock.packages?.[""]?.version}`);
const changelog = readFileSync(file("CHANGELOG.md"), "utf8");
const hasSection = changelog.includes(`## [${version}]`) || changelog.includes("## [Unreleased]");
if (!hasSection) problems.push(`CHANGELOG.md has no "## [${version}]" or "## [Unreleased]" section`);

if (verify) {
  if (problems.length) {
    console.error(`Version ${version} is inconsistent:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`Version ${version} is consistent.`);
  process.exit(0);
}

pkg.version = version;
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
writeJson("package.json", pkg);
writeJson("package-lock.json", lock);
console.log(`Set version ${version} in package.json and package-lock.json.`);
if (!hasSection) console.log(`Remember to add a "## [${version}]" section to CHANGELOG.md.`);
