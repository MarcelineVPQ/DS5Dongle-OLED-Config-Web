// Measures the resource budgets (tools/budgets.json) on a running test copy
// of the app (never the copy you use), started by tools/check_budgets.sh on
// Linux or, inside the Windows VM, by tools/check_budgets_vm.sh: DevTools on
// --port, the main process's inspector on port + 1.
//
//   node tools/measure_budgets.mjs --port 9420 --mode quick|long --out results.json
//
// The app's processes are the main process it is attached to (its
// process.pid) and that process's tree, read by this OS's reader: /proc on
// Linux (tools/procs_linux.mjs), a CIM query on Windows
// (tools/procs_windows.mjs). Everything else is the same on both.
//
// 1. Setup: simulated board with the controller put down (ds5.dev.simRest
//    "still"), Developer card → Fake games on (a full library with art),
//    first-run notices off, then a reload. The window is set to 1920 x 1080
//    (the virtual display on Linux), or to the screen's work area when that
//    is smaller (the Windows VM's 1024 x 768), shown and focused.
// 2. Per page (Controller, Pico 2 W, Games Home, a game page, App settings,
//    About): settle, CPU per process over cpuS (CPU time of the app's
//    process tree), then a traceS trace counting the frames drawn
//    (Display::DrawAndSwap), plus requestAnimationFrame callbacks and the
//    running animations as clues.
// 3. Hidden: Fake games off (so the real running-game check runs, over the
//    test library and this PC's processes), the window goes to the tray
//    (BrowserWindow.hide()), and every app process's CPU is measured over
//    hiddenS.
// 4. Memory: the sum over the process tree (PSS on Linux, the private
//    working set on Windows) at memoryAtS after the start (0: now).
// 5. Soak (--long): the window shown again, every sampleS it visits every
//    page and comes back to Controller, then memory is sampled; samples from
//    the warm-up are dropped.
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setTimeout as sleepFor } from "node:timers/promises";
import { parseArgs } from "node:util";
import { connect, evaluators, framesOver } from "./cdp_lib.mjs";
import { cpuByType, memoryJudged, memorySummary, perSecond } from "./budgets_lib.mjs";

const { values: opts } = parseArgs({
  options: {
    port: { type: "string", default: "9420" },
    mode: { type: "string", default: "quick" },
    out: { type: "string" },
  },
});
const config = JSON.parse(readFileSync(new URL("budgets.json", import.meta.url), "utf8"));
if (!config.modes[opts.mode]) throw new Error(`--mode must be one of ${Object.keys(config.modes).join(", ")}`);
// DS5_BUDGET_MODE='{"cpuS":60}' changes a mode's timings for an experiment.
const mode = { ...config.modes[opts.mode], ...JSON.parse(process.env.DS5_BUDGET_MODE || "{}") };
const PORT = Number(opts.port);
const PAGES = process.env.DS5_BUDGET_PAGES ? process.env.DS5_BUDGET_PAGES.split(",") : config.pages;
const pause = (ms) => sleepFor(ms);
const note = (...a) => console.error("[budgets]", ...a);

// --- CDP
const page = await connect((await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page").webSocketDebuggerUrl);
const main = await connect((await (await fetch(`http://127.0.0.1:${PORT + 1}/json`)).json())[0].webSocketDebuggerUrl);
const { ev, mainEv, win } = evaluators(page, main);

// --- the app's processes: the main process we're attached to and its tree,
// read by this OS's reader (tools/procs_linux.mjs, tools/procs_windows.mjs)
const MAIN = await mainEv("process.pid");
const reader = process.platform === "win32" ? (await import("./procs_windows.mjs")).windowsReader(await mainEv("process.execPath")) : (await import("./procs_linux.mjs")).linuxReader();
const sample = () => reader.appProcs(MAIN);
// Memory per process type in MB (PSS on Linux, the private working set on
// Windows) and the total without DevTools' tracing service, which only runs
// because we measure.
const memoryNow = () => memorySummary(reader.appProcs(MAIN, { memory: true }), reader.memoryMetric, reader.alsoMetric);
// CPU per process type over `secs`, timed by the clock (a Windows sample
// takes a second or two, so the real stretch between them is used).
async function cpuDuring(secs) {
  const a = sample();
  const t0 = performance.now();
  await pause(secs * 1000);
  const b = sample();
  return cpuByType(a, b, (performance.now() - t0) / 1000, reader.hz);
}

// --- pages
const clickOn = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el; })()`);
// A rail button pressed on the page you're already on shows or hides that
// page's settings panel. The per-page measurement keeps the clicks it has
// always made; the soak (steady = true) presses a rail button only to change
// page, so every lap leaves the panels as they were and each memory sample
// sees the same page state (pressing them each lap flipped two panels a
// lap, and the renderer's PSS between two levels ~13 MB apart).
const pressRail = (name, steady) =>
  ev(
    `(() => { const el = document.querySelector('[data-rail="${name}"]'); if (!el) return false; if (!${steady} || document.querySelector(".rail-link.active")?.dataset.rail !== "${name}") el.click(); return true; })()`,
  );
const NAV = {
  controller: (steady = false) => pressRail("controller", steady),
  dongle: (steady = false) => pressRail("dongle", steady),
  gameshome: async (steady = false) => (await pressRail("games", steady)) && (await pause(1500), await clickOn(".lib-home")),
  gamepage: async (steady = false) => (await pressRail("games", steady)) && (await pause(1500), await ev(`(() => { const r = document.querySelectorAll(".lib-row")[1]; r?.click(); return !!r; })()`)),
  app: (steady = false) => pressRail("app", steady),
  about: (steady = false) => pressRail("about", steady),
};

// 1. Setup
await page.send("Page.enable");
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { window.__raf = 0; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => o((t) => { window.__raf++; cb(t); }); })()`,
});
await ev(`(async () => {
  const set = (k, v) => localStorage.setItem(k, v);
  set("ds5.dev.simulated", "1"); set("ds5.dev.tools", "1"); set("ds5.dev.simRest", "still");
  set("ds5.tour.done", "1"); set("ds5.tourDone", "1");
  ${process.env.DS5_BUDGET_BACKGROUND ? `set("ds5.background", ${JSON.stringify(process.env.DS5_BUDGET_BACKGROUND)});` : ""}
  if (typeof window.desktop.devFakeGames !== "function") throw new Error("this build has no Developer card: measure a dev build (X.Y.Z-dev.N, or DS5_DEV_TOOLS=1)");
  await window.desktop.setSetting("gamesScanAllowed", true);
  await window.desktop.setSetting("updatesAsked", true);
  await window.desktop.setSetting("updateChannel", "dev");
  await window.desktop.devFakeGames({ on: true });
  return 1;
})()`);
await page.send("Page.reload");
await pause(10000);
// 1920 x 1080, or the screen's work area when that is smaller (the Windows
// VM's screen is 1024 x 768): a window larger than its screen hangs off it
// and measures a layout nobody sees.
note(
  "window:",
  await win(
    `const a = require("electron").screen.getPrimaryDisplay().workArea; w.setBounds({ x: a.x, y: a.y, width: Math.min(1920, a.width), height: Math.min(1080, a.height) }); w.show(); w.focus(); return JSON.stringify(w.getBounds());`,
  ),
);
// The screen it ran on, and the window it got.
const display = await mainEv(
  `(() => { const e = require("electron"); const d = e.screen.getPrimaryDisplay(); return { size: d.size, scaleFactor: d.scaleFactor, window: e.BrowserWindow.getAllWindows()[0].getBounds() }; })()`,
);
await pause(3000);

// 2. Pages
const pages = [];
for (const name of PAGES) {
  if (!NAV[name]) throw new Error(`unknown page ${name}`);
  const reached = await NAV[name]();
  await pause(mode.settleS * 1000);
  const raf0 = await ev("window.__raf");
  const cpu = await cpuDuring(mode.cpuS);
  const raf1 = await ev("window.__raf");
  // The judged rate, and the same trace's plain counts beside it (reported).
  const frameCounts = {};
  const framesPerS = await framesOver(page, mode.traceS, frameCounts);
  const info = await ev(`({ focus: document.hasFocus(), size: innerWidth + "x" + innerHeight, rail: document.querySelector(".rail-link.active")?.dataset.rail ?? null,
    anims: [...new Set(document.getAnimations().filter((a) => a.playState === "running").map((a) => (a.animationName ?? a.transitionProperty ?? "?") + "@" + String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? "").split(" ")[0]))] })`);
  const r = { page: name, reached: !!reached, framesPerS, frameCounts, cpu, rafPerS: perSecond(raf1 - raf0, mode.cpuS), ...info };
  note(JSON.stringify(r));
  pages.push(r);
}

// 3. Hidden in the tray, with the real running-game check: Fake games off
// (it stops the check), so the app scans the test home's library
// (tools/seed_test_library.mjs) and watches this PC's /proc as it would yours.
await ev("window.desktop.devFakeGames({ on: false }).then(() => 1)");
await page.send("Page.reload");
await pause(15000);
await win("w.hide(); return true;");
// The library scan and art that follow the reload finish first.
await pause(mode.hiddenSettleS * 1000);
const hiddenAttr = await ev(`document.documentElement.hasAttribute("data-window-hidden")`);
if (!hiddenAttr) note("warning: the page never saw the window hide (no data-window-hidden)");
const hidden = { secs: mode.hiddenS, cpu: await cpuDuring(mode.hiddenS), pageSawHide: hiddenAttr };
note("hidden:", JSON.stringify(hidden));

// 4. Memory (still hidden)
const uptimeOfMain = () => mainEv("process.uptime()");
const waitS = mode.memoryAtS - (await uptimeOfMain());
if (waitS > 0) await pause(waitS * 1000);
const mem = { atS: Math.round(await uptimeOfMain()), ...memoryNow() };
note("memory:", JSON.stringify(mem));

// 5. Soak
let soak = null;
if (mode.soakS > 0) {
  await win("w.show(); w.focus(); return true;");
  const t0 = Date.now();
  const samples = [];
  while ((Date.now() - t0) / 1000 < mode.soakWarmupS + mode.soakS) {
    const lap = Date.now();
    for (const name of PAGES) {
      await NAV[name](true);
      await pause(3000);
    }
    await NAV.controller(true);
    await pause(Math.max(1000, mode.sampleS * 1000 - (Date.now() - lap)));
    const t = (Date.now() - t0) / 1000;
    const now = memoryNow();
    const { mb } = now;
    // Without the GPU process too (reported: SwiftShader's PSS swings ±15 MB between samples).
    if (t >= mode.soakWarmupS) samples.push({ t: Math.round(t - mode.soakWarmupS), mb, mbWithoutGpu: memoryJudged(now) });
    note(`soak ${Math.round(t)} s: ${mb} MB${t < mode.soakWarmupS ? " (warm-up)" : ""}`);
  }
  soak = { windowS: mode.soakS, samples };
}

const results = { mode: opts.mode, platform: process.platform, display, pages, hidden, memory: mem, soak };
if (opts.out) writeFileSync(opts.out, JSON.stringify(results, null, 2));
else console.log(JSON.stringify(results, null, 2));
page.close();
main.close();
