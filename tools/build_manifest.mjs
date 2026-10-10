#!/usr/bin/env node
// Build latest.json (ADR-0003) from what is ALREADY published:
//   - the latest release of this repo (the app: AppImage, portable exe, mac zip)
//   - the newest firmware release of the firmware repo (the Pico 2 W UF2)
//   - the newest Proton release of the firmware repo (proton-* tag: the
//     GE-Proton DualSense build the Games page installs)
// Every asset is downloaded and measured (size + SHA-256) here, so the
// manifest can never point at a file that doesn't exist or doesn't match.
//
//   node tools/build_manifest.mjs [--out latest.json] [--check]
//
// --check exits 1 if the result differs from the existing file (CI uses the
// exit code to decide whether to commit). Uses GITHUB_TOKEN when set (higher
// API rate limit); public repos work without it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const APP_REPO = "MarcelineVPQ/DS5Dongle-OLED-Config-Web";
const FIRMWARE_REPO = "MarcelineVPQ/DS5Dongle-OLED-Edition";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "latest.json";
const checkOnly = args.includes("--check");
const headers = { Accept: "application/vnd.github+json", "User-Agent": "ds5-manifest-builder" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function latestRelease(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${repo}: GitHub API returned ${r.status}`);
  return r.json();
}

// Newest non-draft release whose tag matches. The firmware repo also carries
// proton-* releases, so "latest" alone could be the wrong kind of release.
async function newestRelease(repo, tagPattern) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
  if (!r.ok) throw new Error(`${repo}: GitHub API returned ${r.status}`);
  return (await r.json()).find((rel) => !rel.draft && !rel.prerelease && tagPattern.test(rel.tag_name)) ?? null;
}

// Download and hash an asset, streamed (the Proton build is ~565 MB).
async function measure(asset) {
  const r = await fetch(asset.browser_download_url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`${asset.name}: download returned ${r.status}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  if (size !== asset.size) throw new Error(`${asset.name}: size ${size} != ${asset.size}`);
  return { url: asset.browser_download_url, size, sha256: hash.digest("hex") };
}

function pick(release, pattern) {
  return release?.assets.find((a) => pattern.test(a.name)) ?? null;
}

const manifest = {};

const app = await latestRelease(APP_REPO);
if (app) {
  const version = app.tag_name.replace(/^v/, "");
  const platforms = {};
  const linux = pick(app, /^DS5Dongle-OLED-Edition-Configurator-[\d.]+-linux-x86_64\.AppImage$/);
  const windows = pick(app, /^DS5Dongle-OLED-Edition-Configurator-[\d.]+-win-x64\.exe$/);
  const macos = pick(app, /^DS5Dongle-OLED-Edition-Configurator-[\d.]+-mac-universal\.zip$/);
  if (linux) platforms.linux = await measure(linux);
  if (windows) platforms.windows = await measure(windows);
  if (macos) platforms.macos = await measure(macos);
  manifest.app = { version, notes_url: app.html_url, platforms };
}

const fw = await newestRelease(FIRMWARE_REPO, /^v\d+\.\d+\.\d+-oled-edition$/);
// Pico 2 W build only (not the Pico W / debug variants).
const uf2 = fw ? pick(fw, new RegExp(`^ds5-bridge-oled-${fw.tag_name.replace(/[.]/g, "\\.")}\\.uf2$`)) : null;
if (fw && uf2) manifest.firmware = { version: fw.tag_name, notes_url: fw.html_url, uf2: await measure(uf2) };

const proton = await newestRelease(FIRMWARE_REPO, /^proton-/);
// Same naming rule as the app (PROTON_NAME in src/update/manifest.ts).
const protonTar = pick(proton, /^GE-Proton[\w.-]*DualSense\.tar\.gz$/);
if (proton && protonTar) {
  const measured = await measure(protonTar);
  // The release's SHA256SUMS.txt must list the tarball with the same hash.
  const sums = pick(proton, /^SHA256SUMS\.txt$/);
  if (!sums) throw new Error(`${proton.tag_name}: no SHA256SUMS.txt in the release`);
  const r = await fetch(sums.browser_download_url, { redirect: "follow" });
  if (!r.ok) throw new Error(`SHA256SUMS.txt: download returned ${r.status}`);
  const listed = (await r.text())
    .split("\n")
    .find((l) => l.trim().endsWith(protonTar.name))
    ?.split(/\s+/)[0];
  if (listed !== measured.sha256) throw new Error(`${protonTar.name}: SHA256SUMS.txt says ${listed ?? "nothing"}, download hashes to ${measured.sha256}`);
  manifest.proton = { name: protonTar.name.replace(/\.tar\.gz$/, ""), notes_url: proton.html_url, tarball: measured };
}

if (!manifest.app) {
  console.error(`No app release in ${APP_REPO} yet; not writing a manifest (the app requires an app block).`);
  process.exit(checkOnly ? 0 : 2);
}

const text = JSON.stringify(manifest, null, 2) + "\n";
const current = existsSync(out) ? readFileSync(out, "utf8") : "";
if (checkOnly) {
  console.log(text === current ? "latest.json is current." : "latest.json is out of date.");
  process.exit(text === current ? 0 : 1);
}
writeFileSync(out, text);
console.log(
  `Wrote ${out}: app ${manifest.app.version} (${Object.keys(manifest.app.platforms).join(", ")}), firmware ${manifest.firmware?.version ?? "none"}, proton ${manifest.proton?.name ?? "none"}`,
);
