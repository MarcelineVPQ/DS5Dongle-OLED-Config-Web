// UI check of the running desktop app over the Chrome DevTools protocol, on
// every view a user can open (opened the way a user would):
//   layout:   text that's cut off or spills out of its box, in every language,
//             at a normal and at the smallest supported window size;
//   contrast: text under WCAG AA (4.5:1, 3:1 for large text) in every theme
//             and style, and every controller colorway (English, normal size);
//   names:    buttons, links, inputs and selects with no name a screen reader
//             or a tooltip could give (no text, aria-label, title or label).
// Mechanical, never sampled by eye (the AVIEW rule). Two plans:
//   --plan fast (default; dev builds): layout and names on a pairwise covering
//     array of language x size x theme x page group x model (every pair of
//     values at least once), plus the long-translation languages (de, es,
//     fr, pt-BR: RISKY_LANGS in check_plan.mjs) at the smallest size on every
//     page and every page at every size; contrast on a pairwise array
//     of theme x style x page group x model; colorways computed from the
//     app's own color code instead of rendered, cross-checked against the
//     renders (tools/check_plan.mjs, tools/colorway_contrast.mjs). ~7 min
//     instead of ~21.
//   --plan full (stable releases): every language x size x page, every theme x
//     style x page, every colorway of both models rendered, plus the computed
//     colorway check.
//
//   tools/check_ui.sh [options]   (the usual way: its own app copy with the simulated
//                                   dongle, never the copy you're using)
//   or by hand: DS5_DEV_TOOLS=1 npm run build:desktop && ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9334
//   (a dev build: the update-state and colorway passes use its Developer previews)
//   node tools/check_layout.mjs [--host 127.0.0.1] [--port 9334] [--plan fast|full] [--mode layout|contrast|names|all]
//     [--langs en,de] [--sizes 1100x900,900x650] [--themes light,dark] [--colorways off] [--seed 1] [--dry-run]
//     [--groups app,about]   only these page groups (a spot check of the pages a change touched)
//   --dry-run prints the plan (size, estimated time) and stops.
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
import { setTimeout as sleep } from "node:timers/promises";
import { RISKY_LANGS, contrastPlan, estimateMs, layoutPlan, minutes, pairCoverage } from "./check_plan.mjs";
import { ColorwayCheck, FINGERPRINT_FN, colorSources, drawingFindings, harvestExpr, loadColorwayMath, tokenNames } from "./colorway_contrast.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(opt("port", "9334"));
const host = opt("host", "127.0.0.1"); // e.g. the Windows VM (tools/windows_vm_test.py)
const PLAN = opt("plan", "fast");
if (!["fast", "full"].includes(PLAN)) throw new Error(`--plan ${PLAN}: fast or full`);
const MODE = opt("mode", "all");
const SEED = Number(opt("seed", "1"));
const DRY_RUN = args.includes("--dry-run");
const LANGS = opt("langs", "en,de,fr,es,pt-BR,zh-CN,ja").split(",");
const SIZES = opt("sizes", "1100x900,900x650").split(",");
const THEMES = opt("themes", "controller,light,dark,desktop").split(",");
const MODELS = ["dualsense", "edge"];
// Fast plan: the languages checked on every view at the smallest size.
const RISKY = opt("risky-langs", RISKY_LANGS.join(",")) === "all" ? LANGS : opt("risky-langs", RISKY_LANGS.join(",")).split(",");
const COLORWAY_PASS = opt("colorways", "on") !== "off";
const ONLY_GROUPS = opt("groups", null)?.split(",") ?? null;
const STYLES = { standard: null, glass: "1" };
const STARTED = Date.now();
const doing = (what) => MODE === what || MODE === "all";

let ws = null;
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
  const BOXES = ".dk-card, .live-tile, .live-data-card, .dash-card, .dk-notice, .dk-btn, .dk-seg button, .dk-row, .dk-sec, .dk-split-panel, .narrator-caption, .lib-row, .gp-stat";
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
// alone: those are counted (skipped), not guessed. With `names` (the color
// tokens), every judged element also comes back with the tokens its text and
// ground colors come from (tools/colorway_contrast.mjs), for the computed
// colorway check.
const CONTRAST_PROBE_FN = `(names) => {
  const out = [];
  const judged = [];
  let skipped = 0;
  const parse = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const label = (el) => (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 50);
  const rgb = (c) => "rgb(" + c.slice(0, 3).join(", ") + ")";
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
    if (names) judged.push({ el, bgNode: node, fg: rgb(fg), bg: rgb(bg), need, got, text: label(el) });
  }
  if (!names) return { out, skipped };
  const toks = (${FINGERPRINT_FN})(judged, names);
  return { out, skipped, judged: judged.map(({ el, bgNode, ...j }, i) => ({ ...j, fgTok: toks[i][0], bgTok: toks[i][1] })) };
}`;
const contrastProbe = (names = null) => evaluate(`(${NO_TRANSITIONS}, (${CONTRAST_PROBE_FN})(${JSON.stringify(names)}))`);

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
const scrollPanel = () => evaluate(`(() => { const p = document.querySelector(".dk-split-panel"); if (p) p.scrollTop = p.scrollHeight; })()`);
// An accordion section opened (left open if it is), and every section pinned open.
const openSection = (id) => evaluate(`(() => { const h = document.querySelector('[data-section="${id}"] .dk-sec-toggle'); if (h && h.getAttribute("aria-expanded") !== "true") h.click(); })()`);
const pinAll = () => evaluate(`document.querySelectorAll('.dk-sec-pin[aria-pressed="false"]').forEach((b) => b.click())`);
const unpinAll = () => evaluate(`document.querySelectorAll('.dk-sec-pin[aria-pressed="true"]').forEach((b) => b.click())`);

// Every view worth checking: its page group (the unit the fast plan
// combines), the update state it's shown in, and a rough cost (ms: its own
// waits plus the settle time and the probe) for the time estimate.
const SETTLE_MS = 700;
const PARTS = ["lightbar", "l2", "r1", "cross", "dpad-up", "stick-l", "touchpad", "speaker", "mute", "ps", "create", "options", "player-leds"];
const gamesHome = async () => {
  await rail("games");
  await sleep(1500);
  await click(".lib-home"); // home, not the game page the last view left open
};
const view = (group, name, cost, open) => ({ group, name, cost: cost + SETTLE_MS + 150, open });
const BASE_VIEWS = [
  view("controller", "controller", 0, () => rail("controller")),
  ...PARTS.map((part) =>
    view("controller", `part:${part}`, 300, async () => {
      await rail("controller");
      await sleep(300);
      await click(`.live-ctl [data-part="${part}"]`);
    }),
  ),
  ...["sticks", "info"].map((id) =>
    view("controller", `section:${id}`, 300, async () => {
      await rail("controller");
      await sleep(300);
      await openSection(id);
    }),
  ),
  // Every section pinned open (pins are kept per board and slot: taken off again after), scrolled down.
  view("controller", "controller, every section open, scrolled", 1200, async () => {
    await rail("controller");
    await sleep(400);
    await pinAll();
    await sleep(700);
    await scrollPanel();
  }),
  view("controller", "controller, pins taken off", 300, async () => {
    await rail("controller");
    await sleep(300);
    await unpinAll();
  }),
  view("dongle", "dongle (console + dashboard)", 0, () => rail("dongle")),
  view("dongle", "dongle, scrolled", 800, async () => {
    await rail("dongle");
    await sleep(800);
    await evaluate(`(() => { const s = document.querySelector(".dk-split-main"); if (s) s.scrollTop = s.scrollHeight; })()`);
  }),
  ...["firmware", "device", "power", "oled", "usb", "diagnostics"].map((id) =>
    view("dongle", `dongle section:${id}`, 900, async () => {
      await rail("dongle");
      await sleep(300);
      await openSection(id);
      await sleep(500);
      await scrollPanel();
    }),
  ),
  view("app", "app settings", 0, () => rail("app")),
  // Every section pinned open (the accordion: one open otherwise), scrolled down.
  view("app", "app settings, every section open, scrolled", 700, async () => {
    await rail("app");
    await sleep(400);
    await pinAll();
    await sleep(300);
    await scrollPanel();
  }),
  view("controller", "buttons & layouts", 900, async () => {
    await rail("controller");
    await sleep(400);
    await openSection("buttons");
    await sleep(500);
    await scrollPanel();
  }),
  ...[0, 1, 2, 3, 4, 5].map((i) =>
    view("about", `about section ${i}`, 400, async () => {
      await rail("about");
      await sleep(400);
      await evaluate(`(() => { const h = document.querySelectorAll(".dk-sec-toggle")[${i}]; if (h && h.getAttribute("aria-expanded") !== "true") h.click(); })()`);
    }),
  ),
  view("games", "games home", 1500, gamesHome),
  view("games", "games home, cover grid", 2300, async () => {
    await gamesHome();
    await sleep(800);
    await evaluate(`document.querySelector(".lib-grid")?.scrollIntoView({ block: "start" })`);
  }),
  view("games", "games, Show menu open", 1500, async () => {
    await gamesHome();
    await evaluate(`(() => { const d = document.querySelector(".lib-show"); if (d) d.open = true; })()`);
  }),
  ...[
    ["game page (profile)", `[...document.querySelectorAll(".lib-row")].find((r) => r.innerText.includes("◆"))`],
    ["game page (GOG)", `document.querySelector('.lib-row[data-store="gog"]')`],
    ["game page (soundtrack or software)", `[...document.querySelectorAll(".lib-row")].find((r) => r.querySelector(".lib-kind"))`],
    ["game page (first)", `document.querySelectorAll(".lib-row")[1]`],
  ].map(([name, pick]) =>
    view("games", name, 2000, async () => {
      await rail("games");
      await sleep(2000);
      await evaluate(`(${pick} ?? document.querySelectorAll(".lib-row")[1])?.click()`);
    }),
  ),
];
// The update states, shown through the developer preview (no reload needed:
// the app listens for preference changes), on the controller and Dongle views.
const UPDATE_STATES = ["available", "progress", "ready"];
const VIEWS = [
  ...BASE_VIEWS,
  ...UPDATE_STATES.flatMap((state) =>
    BASE_VIEWS.filter((v) => v.name === "controller" || v.name === "dongle (console + dashboard)").map((v) => ({ ...v, group: "updates", name: `${v.name}, update ${state}`, update: state })),
  ),
];
const GROUPS = [...new Set(VIEWS.map((v) => v.group))].filter((g) => !ONLY_GROUPS || ONLY_GROUPS.includes(g));
const groupViews = (group) => VIEWS.filter((v) => v.group === group);
const GROUP_SIZES = Object.fromEntries(GROUPS.map((g) => [g, groupViews(g).length]));
// The views a combination renders: its slice of the group (fast plan), or all.
const viewsOf = (t) => (t.views ? t.views.map((i) => groupViews(t.group)[i]) : groupViews(t.group));
const byName = new Map(VIEWS.map((v) => [v.name, v]));

const setPref = (key, value) =>
  evaluate(
    `(() => { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); window.dispatchEvent(new CustomEvent("ds5:pref", { detail: { key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)} } })); })()`,
  );
let shownUpdate = "";
async function show(v) {
  const state = v.update ?? "";
  if (state !== shownUpdate) {
    await setPref("ds5.dev.updates", state);
    shownUpdate = state;
  }
  await v.open();
  await sleep(SETTLE_MS);
}
// Preferences that need a reload (language, theme, style), then the wait for
// the app to come back with the (simulated) dongle: its rail and controller
// drawing up, fonts loaded and the controller's colors applied (the identity
// is read once a second), then a short settle; at most RELOAD_MS.
const RELOAD_MS = 5000;
const READY = `(() => !window.__checkOld && document.readyState === "complete" && !!document.querySelector("[data-rail]") && !!document.querySelector(".live-ctl svg") && document.fonts.status === "loaded" && (!!document.getElementById("ds5-controller-accent") || localStorage.getItem("ds5.accent") === "desktop"))()`;
const reloadWaits = [];
const setPrefs = async (p) => {
  await evaluate(
    `(() => { window.__checkOld = true; ${Object.entries(p)
      .map(([k, v]) => (v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`))
      .join(" ")} location.reload(); })()`,
  );
  const t = Date.now();
  await sleep(800);
  while (Date.now() - t < RELOAD_MS && !(await evaluate(READY).catch(() => false))) await sleep(150);
  await sleep(Math.max(0, Math.min(600, RELOAD_MS - (Date.now() - t))));
  reloadWaits.push(Date.now() - t);
};
const setSize = ([w, h]) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const dims = (s) => s.split("x").map(Number);

// --- the plan ----------------------------------------------------------------

const product = (...xs) => xs.reduce((a, b) => a * b, 1);
const STYLE_NAMES = Object.keys(STYLES);
// Layout (and, in the fast plan, names) combinations.
const layout = (() => {
  if (!doing("layout") && !(PLAN === "fast" && doing("names"))) return null;
  if (PLAN === "full") {
    const tests = LANGS.flatMap((lang) => SIZES.flatMap((size) => GROUPS.map((group) => ({ lang, size, group }))));
    return { tests, reloadKeys: ["lang"], factors: null };
  }
  const p = layoutPlan({ langs: LANGS, sizes: SIZES, themes: THEMES, groups: GROUPS, groupSizes: GROUP_SIZES, models: MODELS, riskyLangs: RISKY, seed: SEED });
  return { ...p, reloadKeys: ["lang", "theme"] };
})();
const contrast = (() => {
  if (!doing("contrast")) return null;
  if (PLAN === "full") {
    const tests = THEMES.flatMap((theme) => STYLE_NAMES.flatMap((style) => GROUPS.map((group) => ({ theme, style, group }))));
    return { tests, reloadKeys: ["theme", "style"], factors: null };
  }
  const p = contrastPlan({ themes: THEMES, styles: STYLE_NAMES, groups: GROUPS, groupSizes: GROUP_SIZES, models: MODELS, seed: SEED });
  return { ...p, reloadKeys: ["theme", "style"] };
})();
// Rendered colorways: every one of both models (full), or a few sanity
// renders the computed check is compared against (fast).
const SANITY = [
  ["dualsense", "05"], // a light colorway: the Controller theme's light shade
  ["dualsense", "Z4"], // a two-tone special edition
  ["edge", "00"],
];
const SANITY_VIEWS = ["controller", "app settings"];
const COLORWAY_VIEWS = ["controller", "dongle (console + dashboard)", "app settings"];
const math = doing("contrast") && COLORWAY_PASS ? await loadColorwayMath() : null;
const renderedColorways = !math ? [] : PLAN === "full" ? [...Object.keys(math.COLORWAYS).map((c) => ["dualsense", c]), ...Object.keys(math.EDGE_COLORWAYS).map((c) => ["edge", c])] : SANITY;
const colorwayViews = PLAN === "full" ? COLORWAY_VIEWS : SANITY_VIEWS;
const sources = math ? colorSources(math) : [];

const RELOAD_EST = 1600; // measured: the app is back in ~1.4 s
const viewRenders = (tests) => tests.reduce((n, t) => n + viewsOf(t).length, 0);
const est = {
  layout: layout ? estimateMs(layout.tests, { reloadKeys: layout.reloadKeys, viewsOf, reloadMs: RELOAD_EST }) : 0,
  contrast: contrast
    ? estimateMs(contrast.tests, { reloadKeys: contrast.reloadKeys, viewsOf, reloadMs: RELOAD_EST }) +
      (math ? RELOAD_EST + renderedColorways.length * colorwayViews.reduce((n, v) => n + byName.get(v).cost, 0) : 0)
    : 0,
  names: PLAN === "full" && doing("names") ? RELOAD_EST + BASE_VIEWS.reduce((n, v) => n + v.cost, 0) : 0,
};
const fullLayoutRenders = product(LANGS.length, SIZES.length, VIEWS.length);
const fullContrastRenders = product(THEMES.length, STYLE_NAMES.length, VIEWS.length);
console.log(`== Plan: ${PLAN} (seed ${SEED})`);
if (layout) {
  const pairs = layout.factors ? pairCoverage(layout.factors, layout.tests) : null;
  console.log(
    `   layout${PLAN === "fast" ? " + names" : ""}: ${layout.tests.length} combinations, ${viewRenders(layout.tests)} view renders` +
      (pairs
        ? ` (all ${pairs.covered}/${pairs.pairs} value pairs of ${Object.entries(layout.factors)
            .map(([k, v]) => `${v.length} ${k}`)
            .join(" x ")} = ${product(...Object.values(layout.factors).map((v) => v.length))} combinations)`
        : ` (every language x size x page; theme and model as set)`) +
      `, ~${minutes(est.layout)}`,
  );
}
if (contrast) {
  const pairs = contrast.factors ? pairCoverage(contrast.factors, contrast.tests) : null;
  console.log(
    `   contrast: ${contrast.tests.length} combinations, ${viewRenders(contrast.tests)} view renders` +
      (pairs
        ? ` (all ${pairs.covered}/${pairs.pairs} value pairs of ${Object.entries(contrast.factors)
            .map(([k, v]) => `${v.length} ${k}`)
            .join(" x ")} = ${product(...Object.values(contrast.factors).map((v) => v.length))} combinations)`
        : ` (every theme x style x page)`) +
      (math ? `; colorways: ${renderedColorways.length} rendered on ${colorwayViews.length} views, ${sources.length} computed in ${THEMES.length} themes` : "") +
      `, ~${minutes(est.contrast)}`,
  );
}
if (est.names) console.log(`   names: ${BASE_VIEWS.length} views in English, ~${minutes(est.names)}`);
console.log(`   estimated ${minutes(est.layout + est.contrast + est.names)} (the full plan's matrix: ${fullLayoutRenders} layout and ${fullContrastRenders} contrast view renders)`);
if (DRY_RUN) process.exit(0);

// --- the run -----------------------------------------------------------------

const pages = await (await fetch(`http://${host}:${port}/json`)).json();
ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let problems = 0;
const seenGlobal = new Set();
// `once` (a view name): each finding reported once for that view in the whole
// run (the fast plan's names pass sees a view in several languages).
const report = (prefix, found, once = null) => {
  const seen = new Set();
  for (const f of found) {
    const key = f.kind + f.text;
    if (seen.has(key) || (once && seenGlobal.has(once + key))) continue;
    seen.add(key);
    if (once) seenGlobal.add(once + key);
    problems++;
    console.log(`${prefix} ${f.kind}: ${f.text}`);
  }
};
// The look settings a run starts from at their defaults: the checker copy's
// settings persist between runs (tmp/check/userdata), and any of these left
// set changes what the renders show. Accent: Desktop (controllerAccent.ts)
// drops the simulated dongle's Cosmic Red, so every rendered sample labelled
// Cosmic Red disagreed with the computed Cosmic Red; color vision swaps
// status colors; the knobs (lookKnobs.ts: translucent cards, backdrop) and
// the background change what is judged at all.
const LOOK_KEYS = ["ds5.accent", "ds5.colorVision", "ds5.background", "ds5.artBackdropOff", ...["cardOpacity", "backdropDim", "backdropBlur", "depth", "hdrNits"].map((k) => `ds5.knob.${k}`)];
const PREF_KEYS = ["i18nextLng", "ds5-bridge-theme", "ds5.glass", "ds5.dev.model", "ds5.dev.colorway", "ds5.dev.updates", "ds5.customColors.on", ...LOOK_KEYS];
const original = await evaluate(`(${JSON.stringify(PREF_KEYS)}).reduce((o, k) => ({ ...o, [k]: localStorage.getItem(k) }), {})`);
// Never start inside a preview; the player's own colors off (the colorway
// check covers them); the look at its defaults.
await setPrefs({ "ds5.dev.model": null, "ds5.dev.colorway": null, "ds5.dev.updates": null, "ds5.customColors.on": null, ...Object.fromEntries(LOOK_KEYS.map((k) => [k, null])) });
const timing = {};
const phase = async (name, fn) => {
  const t = Date.now();
  await fn();
  timing[name] = Date.now() - t;
  console.log(`== ${name}: ${minutes(timing[name])}${est[name] ? ` (estimated ${minutes(est[name])})` : ""}`);
};
// Runs combinations in order: a reload when a reload key changes, the model
// (live) and the window size when they change, then every view of its group.
async function runTests(tests, reloadKeys, prefsOf, perView) {
  let lastReload = null;
  let lastModel;
  let lastSize = null;
  for (const t of tests) {
    const key = reloadKeys.map((k) => t[k]).join("/");
    if (key !== lastReload) {
      await setPrefs(prefsOf(t));
      lastReload = key;
      lastModel = undefined;
      await perView.reloaded?.(t);
    }
    if (t.model && t.model !== lastModel) {
      await setPref("ds5.dev.model", t.model);
      lastModel = t.model;
    }
    if (t.size && t.size !== lastSize) {
      await setSize(dims(t.size));
      lastSize = t.size;
    }
    for (const v of viewsOf(t)) {
      await show(v);
      await perView(t, v);
    }
  }
}
const SIMULATED = { code: "02", label: "02 Cosmic Red (simulated dongle)" }; // src/protocol/simulatedDongle.ts

if (layout)
  await phase("layout", async () => {
    const tag = (t) => `${t.lang.padEnd(5)} ${t.size}${PLAN === "fast" ? ` ${t.theme.padEnd(10)} ${t.model.padEnd(9)}` : ""}`;
    await runTests(
      layout.tests,
      layout.reloadKeys,
      (t) => (PLAN === "full" ? { i18nextLng: t.lang } : { i18nextLng: t.lang, "ds5-bridge-theme": t.theme, "ds5.glass": null }),
      async (t, v) => {
        if (doing("layout")) report(`layout   ${tag(t)} ${v.name.padEnd(28)}`, (await evaluate(LAYOUT_PROBE)) ?? []);
        if (PLAN === "fast" && doing("names") && !v.update) report(`names    ${v.name.padEnd(28)}`, (await evaluate(NAMES_PROBE)) ?? [], v.name);
      },
    );
    await send("Emulation.clearDeviceMetricsOverride", {});
    await setPref("ds5.dev.model", "");
  });

if (contrast)
  await phase("contrast", async () => {
    const check = new ColorwayCheck();
    const names = math ? tokenNames() : null;
    let skippedTotal = 0;
    const probe = async (where, theme, style, src) => {
      const fingerprint = math && style === "standard";
      const r = (await contrastProbe(fingerprint ? names : null)) ?? { out: [], skipped: 0 };
      skippedTotal += r.skipped;
      if (fingerprint) check.add(theme, src, r.judged ?? [], where);
      return r.out;
    };
    const harvest = async (theme) => check.addBase(theme, await evaluate(harvestExpr(names)));
    const perView = async (t, v) => {
      const src = { ...SIMULATED, model: t.model ?? "dualsense", custom: null };
      report(`contrast ${t.theme.padEnd(10)} ${t.style.padEnd(8)}${t.model ? ` ${t.model.padEnd(9)}` : ""} ${v.name.padEnd(28)}`, await probe(v.name, t.theme, t.style, src));
    };
    perView.reloaded = async (t) => {
      if (math && t.style === "standard") await harvest(t.theme);
    };
    await runTests(contrast.tests, contrast.reloadKeys, (t) => ({ i18nextLng: "en", "ds5-bridge-theme": t.theme, "ds5.glass": STYLES[t.style] }), perView);
    await setPref("ds5.dev.model", "");
    if (math) {
      // "Match my controller" in the rendered colorways, through the developer
      // preview (src/desktop/devPreview.ts).
      await setPrefs({ i18nextLng: "en", "ds5-bridge-theme": "controller", "ds5.glass": null });
      for (const [model, code] of renderedColorways) {
        await setPref("ds5.dev.model", model);
        await setPref("ds5.dev.colorway", code);
        await sleep(300);
        await harvest("controller");
        const src = { code, model, custom: null, label: `${model === "edge" ? "edge " : ""}${code} ${math.colorway(code, model)?.name}` };
        for (const name of colorwayViews) {
          await show(byName.get(name));
          report(`contrast colorway ${model} ${code} ${name.padEnd(28)}`, await probe(name, "controller", "standard", src));
        }
      }
      await setPref("ds5.dev.model", "");
      await setPref("ds5.dev.colorway", "");
      // Computed: every colorway and custom sample in every theme, on the
      // token pairs the renders showed; cross-checked against the renders.
      const agree = check.agreement(math);
      report("colorway computed path disagrees with the render:", agree.off);
      const found = check.findings(math, THEMES, sources);
      report("contrast colorway (computed)", found.out);
      report("colorway drawing", drawingFindings(math, sources));
      console.log(
        `(colorways: ${sources.length} computed x ${THEMES.length} themes on ${found.pairs} token pairs the UI draws, ${found.checked} ratios; ` +
          `${agree.compared} rendered text items matched the computed ratio within 0.05, ${agree.off.length} didn't; ${check.unmapped} drawn in colors no colorway changes` +
          `${found.missingBase.length ? `; no base tokens for ${found.missingBase.join(", ")}, not computed there` : ""})`,
      );
      if (found.missingBase.length) problems++;
    }
    console.log(`(contrast: ${skippedTotal} text items over art, glass or translucency not judged)`);
  });

if (PLAN === "full" && doing("names"))
  await phase("names", async () => {
    await setPrefs({ i18nextLng: "en" });
    for (const v of BASE_VIEWS) {
      await show(v);
      report(`names    ${v.name.padEnd(28)}`, (await evaluate(NAMES_PROBE)) ?? []);
    }
  });

await setPrefs(original);
ws.close();
const total = Date.now() - STARTED;
const avgReload = reloadWaits.reduce((a, b) => a + b, 0) / Math.max(1, reloadWaits.length);
const fullColorwayRenders = math ? (Object.keys(math.COLORWAYS).length + Object.keys(math.EDGE_COLORWAYS).length) * COLORWAY_VIEWS.length : 0;
console.log(
  `\n== ${PLAN} plan: ${minutes(total)} (estimated ${minutes(est.layout + est.contrast + est.names)}; ${Object.entries(timing)
    .map(([k, v]) => `${k} ${minutes(v)}`)
    .join(", ")}; ${reloadWaits.length} reloads, ${(avgReload / 1000).toFixed(1)} s each)`,
);
console.log(
  `   view renders checked, of the full plan's: ` +
    [
      layout && `layout ${viewRenders(layout.tests)}/${fullLayoutRenders}`,
      contrast && `contrast ${viewRenders(contrast.tests)}/${fullContrastRenders}`,
      contrast && math && `colorways ${renderedColorways.length * colorwayViews.length}/${fullColorwayRenders} (all ${sources.length} computed)`,
      PLAN === "full" && doing("names") && `names ${BASE_VIEWS.length}/${BASE_VIEWS.length}`,
    ]
      .filter(Boolean)
      .join(", "),
);
console.log(problems ? `\n${problems} problem(s).` : "No problems found.");
process.exit(problems ? 1 : 0);
