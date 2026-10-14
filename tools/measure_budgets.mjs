// Measures the resource budgets (tools/budgets.json) on a running test copy
// of the app started by tools/check_budgets.sh (never the copy you use):
// DevTools on --port, the main process's inspector on port + 1, its
// settings in <state>/userdata.
//
//   node tools/measure_budgets.mjs --port 9420 --state tmp/budgets --mode quick|long --out results.json
//
// 1. Setup: simulated board with the controller put down (ds5.dev.simRest
//    "still"), Developer card → Fake games on (a full library with art),
//    first-run notices off, then a reload. The window fills the virtual
//    1920 x 1080 display, shown and focused.
// 2. Per page (Controller, Pico 2 W, Games Home, a game page, App settings,
//    About): settle, CPU per process over cpuS (/proc ticks of the app's
//    process tree), then a traceS trace counting the frames drawn
//    (Display::DrawAndSwap), plus requestAnimationFrame callbacks and the
//    running animations as clues.
// 3. Hidden: Fake games off (so the real running-game check runs, over the
//    test home's library and this PC's /proc), the window goes to the tray
//    (BrowserWindow.hide()), and every app process's CPU is measured over
//    hiddenS.
// 4. Memory: the PSS sum of the process tree (/proc/<pid>/smaps_rollup) at
//    memoryAtS after the start (0: now).
// 5. Soak (--long): the window shown again, every sampleS it visits every
//    page and comes back to Controller, then PSS is sampled; samples from
//    the warm-up are dropped.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleepFor } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { connect, evaluators, framesOver } from "./cdp_lib.mjs";
import { MEASUREMENT_TYPES, cpuByType, descendants, parsePssKb, parseStat, perSecond, procType } from "./budgets_lib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const { values: opts } = parseArgs({
  options: {
    port: { type: "string", default: "9420" },
    state: { type: "string", default: "tmp/budgets" },
    mode: { type: "string", default: "quick" },
    out: { type: "string" },
  },
});
const config = JSON.parse(readFileSync(new URL("budgets.json", import.meta.url), "utf8"));
if (!config.modes[opts.mode]) throw new Error(`--mode must be one of ${Object.keys(config.modes).join(", ")}`);
// DS5_BUDGET_MODE='{"cpuS":60}' changes a mode's timings for an experiment.
const mode = { ...config.modes[opts.mode], ...JSON.parse(process.env.DS5_BUDGET_MODE || "{}") };
const PORT = Number(opts.port);
const STATE = resolve(opts.state);
const PAGES = process.env.DS5_BUDGET_PAGES ? process.env.DS5_BUDGET_PAGES.split(",") : config.pages;
const HZ = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const pause = (ms) => sleepFor(ms);
const note = (...a) => console.error("[budgets]", ...a);

// --- CDP
const page = await connect((await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page").webSocketDebuggerUrl);
const main = await connect((await (await fetch(`http://127.0.0.1:${PORT + 1}/json`)).json())[0].webSocketDebuggerUrl);
const { ev, win } = evaluators(page, main);

// --- the app's processes: the main process with our --user-data-dir and its tree
const ELECTRON = `${ROOT}node_modules/electron/dist/electron`;
function procStats() {
  const out = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
      out.push({ pid: Number(pid), ppid: stat.ppid, ticks: stat.ticks });
    } catch {
      // gone between readdir and read
    }
  }
  return out;
}
function mainPid() {
  for (const p of procStats()) {
    try {
      const cmd = readFileSync(`/proc/${p.pid}/cmdline`, "utf8");
      if (cmd.startsWith(ELECTRON) && procType(cmd) === "main" && cmd.includes(`--user-data-dir=${STATE}/userdata`)) return p.pid;
    } catch {
      // gone
    }
  }
  throw new Error(`no test copy running with --user-data-dir=${STATE}/userdata`);
}
const MAIN = mainPid();
function sample() {
  const all = procStats();
  const tree = new Set(descendants(MAIN, all));
  const out = [];
  for (const p of all) {
    if (!tree.has(p.pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${p.pid}/cmdline`, "utf8");
      out.push({ pid: p.pid, type: p.pid === MAIN ? "main" : procType(cmd), ticks: p.ticks });
    } catch {
      // gone
    }
  }
  return out;
}
// The PSS sum of the app's processes in MB (without DevTools' tracing
// service, which only runs because we measure), and per process type.
function pss() {
  const byType = {};
  for (const pid of descendants(MAIN, procStats())) {
    try {
      const kb = parsePssKb(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")) ?? 0;
      const type = pid === MAIN ? "main" : procType(readFileSync(`/proc/${pid}/cmdline`, "utf8"));
      byType[type] = (byType[type] ?? 0) + kb / 1024;
    } catch {
      // gone
    }
  }
  const mb = (v) => Math.round(v * 10) / 10;
  const total = Object.entries(byType).reduce((sum, [type, v]) => (MEASUREMENT_TYPES.includes(type) ? sum : sum + v), 0);
  return { mb: mb(total), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, mb(v)])) };
}
// Seconds since the test copy's main process started.
function uptimeOfMain() {
  const f = readFileSync(`/proc/${MAIN}/stat`, "utf8");
  const start = Number(f.slice(f.lastIndexOf(")") + 2).split(" ")[19]) / HZ;
  return Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) - start;
}
async function cpuDuring(secs) {
  const a = sample();
  await pause(secs * 1000);
  return cpuByType(a, sample(), secs, HZ);
}

// --- pages
const clickOn = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el; })()`);
const NAV = {
  controller: () => clickOn('[data-rail="controller"]'),
  dongle: () => clickOn('[data-rail="dongle"]'),
  gameshome: async () => (await clickOn('[data-rail="games"]')) && (await pause(1500), await clickOn(".lib-home")),
  gamepage: async () => (await clickOn('[data-rail="games"]')) && (await pause(1500), await ev(`(() => { const r = document.querySelectorAll(".lib-row")[1]; r?.click(); return !!r; })()`)),
  app: () => clickOn('[data-rail="app"]'),
  about: () => clickOn('[data-rail="about"]'),
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
  await window.desktop.setSetting("gamesScanAllowed", true);
  await window.desktop.setSetting("updatesAsked", true);
  await window.desktop.setSetting("updateChannel", "dev");
  await window.desktop.devFakeGames({ on: true });
  return 1;
})()`);
await page.send("Page.reload");
await pause(10000);
note("window:", await win(`w.setBounds({ x: 0, y: 0, width: 1920, height: 1080 }); w.show(); w.focus(); return JSON.stringify(w.getBounds());`));
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
  const framesPerS = await framesOver(page, mode.traceS);
  const info = await ev(`({ focus: document.hasFocus(), size: innerWidth + "x" + innerHeight, rail: document.querySelector(".rail-link.active")?.dataset.rail ?? null,
    anims: [...new Set(document.getAnimations().filter((a) => a.playState === "running").map((a) => (a.animationName ?? a.transitionProperty ?? "?") + "@" + String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? "").split(" ")[0]))] })`);
  const r = { page: name, reached: !!reached, framesPerS, cpu, rafPerS: perSecond(raf1 - raf0, mode.cpuS), ...info };
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
const waitS = mode.memoryAtS - uptimeOfMain();
if (waitS > 0) await pause(waitS * 1000);
const memory = { atS: Math.round(uptimeOfMain()), ...pss() };
note("memory:", JSON.stringify(memory));

// 5. Soak
let soak = null;
if (mode.soakS > 0) {
  await win("w.show(); w.focus(); return true;");
  const t0 = Date.now();
  const samples = [];
  while ((Date.now() - t0) / 1000 < mode.soakWarmupS + mode.soakS) {
    const lap = Date.now();
    for (const name of PAGES) {
      await NAV[name]();
      await pause(3000);
    }
    await NAV.controller();
    await pause(Math.max(1000, mode.sampleS * 1000 - (Date.now() - lap)));
    const t = (Date.now() - t0) / 1000;
    const { mb } = pss();
    if (t >= mode.soakWarmupS) samples.push({ t: Math.round(t - mode.soakWarmupS), mb });
    note(`soak ${Math.round(t)} s: ${mb} MB${t < mode.soakWarmupS ? " (warm-up)" : ""}`);
  }
  soak = { windowS: mode.soakS, samples };
}

const results = { mode: opts.mode, pages, hidden, memory, soak };
if (opts.out) writeFileSync(opts.out, JSON.stringify(results, null, 2));
else console.note(JSON.stringify(results, null, 2));
page.close();
main.close();
