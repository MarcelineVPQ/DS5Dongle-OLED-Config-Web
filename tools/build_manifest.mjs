#!/usr/bin/env node
// Build latest.json (ADR-0003) from what is ALREADY published:
//   - the latest release of this repo (the app: AppImage, portable exe, mac zip)
//   - the latest release of the firmware repo (the Pico 2 W UF2)
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

async function measure(asset) {
  const r = await fetch(asset.browser_download_url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${asset.name}: download returned ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength !== asset.size) throw new Error(`${asset.name}: size ${bytes.byteLength} != ${asset.size}`);
  return { url: asset.browser_download_url, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
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

const fw = await latestRelease(FIRMWARE_REPO);
// Pico 2 W build only (not the Pico W / debug variants).
const uf2 = fw ? pick(fw, new RegExp(`^ds5-bridge-oled-${fw.tag_name.replace(/[.]/g, "\\.")}\\.uf2$`)) : null;
if (fw && uf2) manifest.firmware = { version: fw.tag_name, notes_url: fw.html_url, uf2: await measure(uf2) };

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
console.log(`Wrote ${out}: app ${manifest.app.version} (${Object.keys(manifest.app.platforms).join(", ")}), firmware ${manifest.firmware?.version ?? "none"}`);
