// UI check of the running desktop app over the Chrome DevTools protocol, on
// every view a user can open (opened the way a user would):
//   layout:   text that's cut off or spills out of its box, in every language,
//             at a normal and at the smallest supported window size;
//   contrast: text under WCAG AA (4.5:1, 3:1 for large text) in every theme
//             and style (English, normal size);
//   names:    buttons, links, inputs and selects with no name a screen reader
//             or a tooltip could give (no text, aria-label, title or label).
// Mechanical, exhaustive (the AVIEW rule): nothing sampled by eye.
//
//   tools/check_ui.sh [options]   (the usual way: its own app copy with the simulated
//                                   dongle, never the copy you're using)
//   or by hand: DS5_DEV_TOOLS=1 npm run build:desktop && ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9333
//   (a dev build: the update-state and colorway passes use its Developer previews)
//   node tools/check_layout.mjs [--host 127.0.0.1] [--port 9333] [--mode layout|contrast|names|all] [--langs en,de] [--sizes 1100x900,900x650] [--themes light,dark] [--colorways off]
//
// Every layout and contrast pass also runs the controller and Dongle views in
// each update state (available, in progress, ready) through the app's own
// developer preview (src/desktop/updatePreview.ts), since a real update is
// rarely on offer when this runs.
//
// Needs a dongle connected (most panels only exist then). Exits 1 on any
// problem. A label shortened with "…" counts only if it has no tooltip. The
// user's language, theme and style are put back at the end.
/* global WebSocket -- Node 22's built-in client */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(opt("port", "9333"));
const host = opt("host", "127.0.0.1"); // e.g. the Windows VM (tools/windows_vm_test.py)
const MODE = opt("mode", "all");
const LANGS = opt("langs", "en,de,fr,es,pt-BR,zh-CN,ja").split(",");
const SIZES = opt("sizes", "1100x900,900x650")
  .split(",")
  .map((s) => s.split("x").map(Number));
const THEMES = opt("themes", "controller,light,dark,desktop").split(",");
const COLORWAY_PASS = opt("colorways", "on") !== "off";
// Every colorway, per model, read from the app's own list
// (src/desktop/live/colorways.ts); the Edge comes in White and Midnight Black
// (devPreview.ts MODEL_COLORWAYS).
const COLORWAY_CODES = [...readFileSync(new URL("../src/desktop/live/colorways.ts", import.meta.url), "utf8").matchAll(/^ {2}"(\w\w)": \{ name:/gm)].map((m) => m[1]);
const COLORWAY_MODELS = [
  ["dualsense", COLORWAY_CODES],
  ["edge", ["00", "01"]],
];
const STYLES = [
  ["standard", null],
  ["glass", "1"],
];

const pages = await (await fetch(`http://${host}:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const send = (method, params) =>
  new Promise((res) => {
    const my = ++id;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === my) {
        ws.removeEventListener("message", h);
        res(m.result);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
// Colors ease between themes (button transitions); measured mid-way they
// read as failures (seen on the Windows VM, which renders slowly). Switch
// transitions and animations off for the check, again after every reload.
const NO_TRANSITIONS = `(() => { if (document.getElementById("check-no-transitions")) return; const s = document.createElement("style"); s.id = "check-no-transitions"; s.textContent = "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }"; document.head.append(s); })()`;

// In the page: clipped or spilling text in what's visible now.
const LAYOUT_PROBE = `(() => {
  const BOXES = ".dk-card, .live-tile, .live-data-card, .dash-card, .dk-notice, .dk-btn, .dk-seg button, .dk-row, .live-panel, .narrator-caption, .lib-row, .gp-stat";
  const out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const label = (el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 60);
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || !el.childNodes.length) continue;
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const cs = getComputedStyle(el);
    const cut = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible";
    if (cut && cs.textOverflow === "ellipsis") {
      if (!el.title && !el.closest("[title]")) out.push({ kind: "shortened, no tooltip", text: label(el) });
    } else if (cut) out.push({ kind: "cut off", text: label(el) });
    const box = el.parentElement?.closest(BOXES);
    if (box) {
      const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.right > b.right + 1 || r.left < b.left - 1) out.push({ kind: "spills out of " + box.className.split(" ")[0], text: label(el) });
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: "page scrolls sideways", text: "" });
  // The controller drawing must never be drawn over the tiles and cards below
  // it (it did on short windows: its height limit didn't reach the svg).
  const art = document.querySelector(".live-ctl svg");
  if (art && visible(art)) {
    const a = art.getBoundingClientRect();
    for (const el of document.querySelectorAll(".live-tile, .live-data-card")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) > 4 && Math.min(a.right, r.right) - Math.max(a.left, r.left) > 4) out.push({ kind: "drawing covers", text: label(el) });
    }
  }
  return out;
})()`;

// In the page: text below WCAG AA against the first opaque background behind
// it. Text over art, glass or a translucent card can't be judged from styles
// alone: those are counted (skipped), not guessed.
const CONTRAST_PROBE_BODY = `(() => {
  const out = [];
  let skipped = 0;
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const label = (el) => (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 50);
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !el.childNodes.length) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest("[aria-hidden='true'], :disabled, [disabled], svg, .dcon, .gp-hero")) continue; // disabled text is exempt; console and hero titles are fixed by design
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const fg = parse(cs.color);
    if (!fg || (fg[3] ?? 1) < 0.99) { skipped++; continue; }
    let bg = null, node = el, unsure = false;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage !== "none" || (s.backdropFilter && s.backdropFilter !== "none")) { unsure = true; break; }
      const c = parse(s.backgroundColor);
      if (c && (c[3] ?? 1) >= 0.99) { bg = c; break; }
      if (c && (c[3] ?? 1) > 0.01) { unsure = true; break; }
      node = node.parentElement;
    }
    if (unsure || !bg) { skipped++; continue; }
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) out.push({ kind: "contrast " + got.toFixed(2) + " < " + need, text: label(el) });
  }
  return { out, skipped };
})()`;
const CONTRAST_PROBE = `(${NO_TRANSITIONS}, (${CONTRAST_PROBE_BODY}))`;

// In the page: interactive elements with no accessible name.
const NAMES_PROBE = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=radio]")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest("[aria-hidden='true']")) continue;
    const named =
      (el.innerText || "").trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      el.title ||
      (el.id && document.querySelector("label[for='" + el.id + "']")) ||
      el.closest("label") ||
      el.getAttribute("placeholder");
    if (!named) out.push({ kind: "no name", text: el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + " in " + (el.closest("section, nav, header, .dk-bar")?.className.split(" ")[0] ?? "?") });
  }
  return out;
})()`;

const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!el; })()`);
const rail = (item) => click(`[data-rail="${item}"]`);

// Every view worth checking.
const PARTS = ["lightbar", "l2", "r1", "cross", "dpad-up", "stick-l", "touchpad", "speaker", "mute", "ps", "create", "options", "player-leds"];
function views() {
  const list = [["controller", () => rail("controller")]];
  for (const part of PARTS)
    list.push([
      `part:${part}`,
      async () => {
        await rail("controller");
        await sleep(300);
        await click(`.live-ctl [data-part="${part}"]`);
      },
    ]);
  list.push([
    "calibration",
    async () => {
      await rail("controller");
      await sleep(300);
      await evaluate(`[...document.querySelectorAll(".live-shortcut")].at(-1)?.click()`);
    },
  ]);
  list.push(["dongle (console + dashboard)", () => rail("dongle")]);
  list.push([
    "dongle, scrolled",
    async () => {
      await rail("dongle");
      await sleep(800);
      await evaluate(`(() => { const s = document.querySelector(".live-stage"); if (s) s.scrollTop = s.scrollHeight; })()`);
    },
  ]);
  list.push(["app settings", () => rail("app")]);
  list.push([
    "app settings, scrolled",
    async () => {
      await rail("app");
      await sleep(500);
      await evaluate(`(() => { const p = document.querySelector(".live-panel .dk-panel-body, .live-panel"); if (p) p.scrollTop = p.scrollHeight; })()`);
    },
  ]);
  list.push([
    "buttons & layouts",
    async () => {
      await rail("controller");
      await sleep(400);
      await click('[data-view="buttons"]');
      await sleep(500);
      await evaluate(`(() => { const p = document.querySelector(".live-panel .dk-panel-body, .live-panel"); if (p) p.scrollTop = p.scrollHeight; })()`);
    },
  ]);
  for (const tab of [0, 1, 2, 3, 4])
    list.push([
      `about tab ${tab}`,
      async () => {
        await rail("about");
        await sleep(400);
        await evaluate(`document.querySelectorAll('[role="tab"]')[${tab}]?.click()`);
      },
    ]);
  // Home, not the game page the last view left open.
  const gamesHome = async () => {
    await rail("games");
    await sleep(1500);
    await click(".lib-home");
  };
  list.push(["games home", gamesHome]);
  list.push([
    "games home, cover grid",
    async () => {
      await gamesHome();
      await sleep(800);
      await evaluate(`document.querySelector(".lib-grid")?.scrollIntoView({ block: "start" })`);
    },
  ]);
  list.push([
    "games, Show menu open",
    async () => {
      await gamesHome();
      await evaluate(`(() => { const d = document.querySelector(".lib-show"); if (d) d.open = true; })()`);
    },
  ]);
  for (const [name, pick] of [
    ["game page (profile)", `[...document.querySelectorAll(".lib-row")].find((r) => r.innerText.includes("◆"))`],
    ["game page (GOG)", `document.querySelector('.lib-row[data-store="gog"]')`],
    ["game page (soundtrack or software)", `[...document.querySelectorAll(".lib-row")].find((r) => r.querySelector(".lib-kind"))`],
    ["game page (first)", `document.querySelectorAll(".lib-row")[1]`],
  ])
    list.push([
      name,
      async () => {
        await rail("games");
        await sleep(2000);
        await evaluate(`(${pick} ?? document.querySelectorAll(".lib-row")[1])?.click()`);
      },
    ]);
  return list;
}

// The update states, shown through the developer preview (no reload needed:
// the app listens for preference changes).
const UPDATE_STATES = ["available", "progress", "ready"];
const UPDATE_VIEWS = ["controller", "dongle (console + dashboard)"];
const setUpdatePreview = (value) =>
  evaluate(
    `(() => { localStorage.setItem("ds5.dev.updates", ${JSON.stringify(value)}); window.dispatchEvent(new CustomEvent("ds5:pref", { detail: { key: "ds5.dev.updates", value: ${JSON.stringify(value)} } })); })()`,
  );
async function* withUpdateStates() {
  for (const [name, open] of views()) yield [name, open];
  const byName = new Map(views());
  for (const state of UPDATE_STATES) {
    await setUpdatePreview(state);
    for (const name of UPDATE_VIEWS) yield [`${name}, update ${state}`, byName.get(name)];
  }
  await setUpdatePreview("");
}

let problems = 0;
const report = (prefix, found) => {
  const seen = new Set();
  for (const f of found) {
    const key = f.kind + f.text;
    if (seen.has(key)) continue;
    seen.add(key);
    problems++;
    console.log(`${prefix} ${f.kind}: ${f.text}`);
  }
};
const original = await evaluate(`({ lang: localStorage.getItem("i18nextLng"), theme: localStorage.getItem("ds5-bridge-theme"), glass: localStorage.getItem("ds5.glass") })`);
await setUpdatePreview(""); // never start inside a preview
const setPrefs = (p) =>
  evaluate(
    `(() => { ${Object.entries(p)
      .map(([k, v]) => (v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`))
      .join(" ")} location.reload(); })()`,
  );

if (MODE === "layout" || MODE === "all") {
  for (const lang of LANGS) {
    await setPrefs({ i18nextLng: lang });
    await sleep(5000);
    for (const [w, h] of SIZES) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      for await (const [name, open] of withUpdateStates()) {
        await open();
        await sleep(700);
        report(`layout   ${lang.padEnd(5)} ${w}x${h} ${name.padEnd(28)}`, (await evaluate(LAYOUT_PROBE)) ?? []);
      }
    }
  }
  await send("Emulation.clearDeviceMetricsOverride", {});
}

if (MODE === "contrast" || MODE === "all") {
  let skippedTotal = 0;
  for (const theme of THEMES)
    for (const [style, glass] of STYLES) {
      await setPrefs({ i18nextLng: "en", "ds5-bridge-theme": theme, "ds5.glass": glass });
      await sleep(5000);
      for await (const [name, open] of withUpdateStates()) {
        await open();
        await sleep(700);
        const r = (await evaluate(CONTRAST_PROBE)) ?? { out: [], skipped: 0 };
        skippedTotal += r.skipped;
        report(`contrast ${theme.padEnd(10)} ${style.padEnd(8)} ${name.padEnd(28)}`, r.out);
      }
    }
  // "Match my controller" in every colorway of both models, through the
  // developer preview (src/desktop/devPreview.ts), on the views it colors.
  await setPrefs({ i18nextLng: "en", "ds5-bridge-theme": "controller", "ds5.glass": null });
  await sleep(5000);
  const setPref = (key, value) =>
    evaluate(
      `(() => { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); window.dispatchEvent(new CustomEvent("ds5:pref", { detail: { key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)} } })); })()`,
    );
  const byName = new Map(views());
  for (const [model, codes] of COLORWAY_PASS ? COLORWAY_MODELS : [])
    for (const code of codes) {
      await setPref("ds5.dev.model", model);
      await setPref("ds5.dev.colorway", code);
      for (const name of ["controller", "dongle (console + dashboard)", "app settings"]) {
        await byName.get(name)();
        await sleep(700);
        const r = (await evaluate(CONTRAST_PROBE)) ?? { out: [], skipped: 0 };
        skippedTotal += r.skipped;
        report(`contrast colorway ${model} ${code} ${name.padEnd(28)}`, r.out);
      }
    }
  await setPref("ds5.dev.model", "");
  await setPref("ds5.dev.colorway", "");
  console.log(`(contrast: ${skippedTotal} text items over art, glass or translucency not judged)`);
}

if (MODE === "names" || MODE === "all") {
  await setPrefs({ i18nextLng: "en" });
  await sleep(5000);
  for (const [name, open] of views()) {
    await open();
    await sleep(700);
    report(`names    ${name.padEnd(28)}`, (await evaluate(NAMES_PROBE)) ?? []);
  }
}

await setPrefs({ i18nextLng: original.lang, "ds5-bridge-theme": original.theme, "ds5.glass": original.glass });
ws.close();
console.log(problems ? `\n${problems} problem(s).` : "No problems found.");
process.exit(problems ? 1 : 0);
