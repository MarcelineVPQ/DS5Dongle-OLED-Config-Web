// Points the download button at this computer's build of the latest release.
// Reads the app's own update feed (latest.json in the firmware repo), so it
// always matches what the app's updater offers. Before the first desktop
// release (no feed yet) it says so and links to the releases page.
"use strict";

const FEED = "https://raw.githubusercontent.com/MarcelineVPQ/DS5Dongle-OLED-Edition/master/latest.json";
const RELEASES = "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases/latest";
// macOS builds are community-tested only (we have no Mac): always labeled so.
const NAMES = { linux: "Linux", windows: "Windows", macos: "macOS (community-tested)" };
const KINDS = { linux: "AppImage", windows: "installer, no admin rights", macos: ".zip" };

function detectOs() {
  const ua = navigator.userAgent || "";
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return "macos";
  if (/Linux|X11|CrOS/i.test(platform + ua)) return "linux";
  return null;
}

function mb(bytes) {
  return `${Math.round(bytes / 1e5) / 10} MB`;
}

function el(id) {
  return document.getElementById(id);
}

function link(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  return a;
}

async function main() {
  const os = detectOs();
  let manifest = null;
  try {
    const response = await fetch(FEED, { cache: "no-store" });
    if (response.ok) manifest = await response.json();
  } catch {
    // offline or blocked: the button keeps pointing at the releases page
  }

  const platforms = (manifest && manifest.app && manifest.app.platforms) || {};
  const version = manifest && manifest.app && manifest.app.version;
  const note = el("dl-note");

  if (!version) {
    el("dl-title").textContent = "Coming soon";
    el("dl-sub").textContent = "The first desktop release, v0.8, is on its way";
    note.hidden = false;
    note.textContent = "Until then, the releases page has the latest firmware.";
    return;
  }

  const mine = os && os !== "mobile" ? platforms[os] : null;
  if (mine) {
    el("dl-main").href = mine.url;
    el("dl-title").textContent = `Download for ${NAMES[os]}`;
    el("dl-sub").textContent = `v${version} · ${KINDS[os]} · ${mb(mine.size)}`;
  } else {
    el("dl-title").textContent = `Download v${version}`;
    el("dl-sub").textContent = os === "mobile" ? "The app runs on your PC (Linux, Windows; macOS community-tested)" : "Linux and Windows (macOS community-tested)";
    el("dl-main").href = RELEASES;
  }

  const others = Object.keys(NAMES).filter((key) => key !== os && platforms[key]);
  if (others.length) {
    const box = el("dl-other-links");
    others.forEach((key, i) => {
      if (i > 0) box.append(", ");
      box.append(link(platforms[key].url, NAMES[key]));
    });
    el("dl-others").hidden = false;
  }
  if (os === "linux") {
    note.hidden = false;
    note.textContent = "Make the AppImage executable (chmod +x) and run it; it adds itself to your app menu.";
  } else if (os === "windows") {
    note.hidden = false;
    note.textContent = "The Windows build hasn't been tested on a Windows PC yet. Windows SmartScreen warns that it's unsigned: choose More info → Run anyway. Reports welcome!";
  } else if (os === "macos") {
    note.hidden = false;
    note.textContent =
      "We can't test the macOS build ourselves, but it has been reported working on macOS 27.0.1. Unzip it and move the app to Applications. It isn't signed yet: the first time macOS refuses it, choose Done, then System Settings → Privacy & Security → Open Anyway (macOS 14 and older: right-click → Open). Reports welcome!";
  }
}

void main();
