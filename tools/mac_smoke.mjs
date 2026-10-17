// macOS smoke test of the packaged app (.github/workflows/mac-smoke.yml, on
// GitHub's macOS runners: a real Mac with a logged-in desktop). We have no
// Mac, so this is the one place the app is driven on macOS before a release.
// The workflow installs the release-style universal build into /Applications
// and starts it with DevTools on --port and the main process's inspector on
// --inspect; this script then:
//
//   1. turns on the Developer card's Simulate board, Pretend more controllers
//      and Fake games by clicking their switches (as a developer would);
//   2. visits every page on the rail and opens every accordion section
//      (src/desktop/accordion/sections.ts, plus any section the page shows
//      that isn't listed), every controller part, and screenshots each;
//   3. checks the Mac-only parts: the menu-bar (tray) icon, the app menu,
//      launch at login (app.getLoginItemSettings round trip), the system
//      accent and dark/light mode, single instance (a second launch shows the
//      first window), the Games page hidden, Quit;
//   4. collects renderer console errors and exceptions, crashed processes and
//      the main process's output (--log) and fails on any error that isn't
//      on the ALLOW list below (each with its reason);
//   5. measures idle frames per page (a CDP trace), CPU per process type
//      shown and hidden (ps cumulative CPU time) and memory (footprint and
//      ps RSS), against tools/budgets.json when that file exists; reported,
//      not judged, until the budgets are agreed for macOS;
//   6. writes summary.md (the job summary), results.json and the screenshots.
//
//   node tools/mac_smoke.mjs --app "/Applications/X.app" --port 9334 --inspect 9335 --log stdout.log,stderr.log --out tmp/mac-smoke
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { connect, evaluators, framesOver } from "./cdp_lib.mjs";
import { GPU_TYPE, cpuByType, cpuTotal } from "./budgets_lib.mjs";
import { appProcs as macAppProcs, procTable } from "./procs_mac.mjs";

const { values: opts } = parseArgs({
  options: {
    app: { type: "string" },
    port: { type: "string", default: "9334" },
    inspect: { type: "string", default: "9335" },
    log: { type: "string" },
    out: { type: "string", default: "tmp/mac-smoke" },
    cpuS: { type: "string", default: "20" },
    hiddenS: { type: "string", default: "60" },
    traceS: { type: "string", default: "5" },
  },
});
if (!opts.app) throw new Error("--app /Applications/<name>.app is required");
const OUT = opts.out;
const SHOTS = join(OUT, "screenshots");
mkdirSync(SHOTS, { recursive: true });
const APP_NAME = opts.app.replace(/^.*\//, "").replace(/\.app$/, "");
const BINARY = join(opts.app, "Contents/MacOS", APP_NAME);
const ROOT = new URL("..", import.meta.url).pathname;
const log = (...a) => console.log("[mac-smoke]", ...a);

// Known-harmless lines. Each needs a reason; anything else that looks like an
// error fails the run.
const ALLOW = [
  { re: /^Debugger listening on ws:\/\//, why: "the main-process inspector this test starts (--inspect)" },
  { re: /^For help, see: https:\/\/nodejs\.org/, why: "the inspector's banner, second line" },
  { re: /^DevTools listening on ws:\/\//, why: "the DevTools port this test starts (--remote-debugging-port)" },
  { re: /^Debugger attached\.$/, why: "this test attaching to the main-process inspector" },
  { re: /^(Debugger ending on ws:\/\/|Waiting for the debugger to disconnect)/, why: "the inspector this test attached, at quit" },
  {
    // A quit-time race: Chromium sets a helper's task policy (suppression or
    // category) just after that helper has already exited (dev.18's run
    // 39056315898 hit the CATEGORY line).
    re: /ERROR:base\/process\/process_mac\.cc:\d+\] task_policy_set TASK_(CATEGORY|SUPPRESSION)_POLICY: \(os\/kern\) invalid argument/,
    why: "Chromium on macOS, at quit: setting the task policy (priority) of a helper process that has already exited",
  },
];
const allowed = (line) => ALLOW.find((a) => a.re.test(line.trim()));

// --- results
const checks = []; // { area, name, ok, detail }
const record = (area, name, ok, detail = "") => {
  checks.push({ area, name, ok: ok === null ? null : !!ok, detail: String(detail) });
  log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"} ${area}: ${name}${detail ? ` (${detail})` : ""}`);
};
const rendererErrors = [];
const rendererWarnings = [];
const crashes = [];

async function waitForPort(port, secs) {
  for (let i = 0; i < secs; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`nothing answered on port ${port} in ${secs} s`);
}
const pageList = await waitForPort(Number(opts.port), 90);
const page = await connect(pageList.find((p) => p.type === "page").webSocketDebuggerUrl);
const main = await connect((await waitForPort(Number(opts.inspect), 30))[0].webSocketDebuggerUrl);

const { ev, mainEv, win } = evaluators(page, main);
const E = `require("electron")`;

// Renderer console errors, exceptions and browser log errors, across reloads.
await page.send("Runtime.enable");
await page.send("Log.enable");
await page.send("Page.enable");
const where = () => currentStep;
let currentStep = "start";
page.handlers.add((d) => {
  if (d.method === "Runtime.consoleAPICalled") {
    const text = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (d.params.type === "error" || d.params.type === "assert") (allowed(text) ? rendererWarnings : rendererErrors).push({ step: where(), kind: "console." + d.params.type, text });
    else if (d.params.type === "warning") rendererWarnings.push({ step: where(), kind: "console.warn", text });
  } else if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    rendererErrors.push({ step: where(), kind: "exception", text: x.exception?.description ?? x.text });
  } else if (d.method === "Log.entryAdded" && d.params.entry.level === "error") {
    const text = `${d.params.entry.source}: ${d.params.entry.text} ${d.params.entry.url ?? ""}`;
    (allowed(text) ? rendererWarnings : rendererErrors).push({ step: where(), kind: "log", text });
  }
});
// Crashed or killed child processes and renderers, seen by the main process.
await mainEv(`(() => {
  const { app } = ${E};
  globalThis.__smokeGone = [];
  app.on("child-process-gone", (_e, d) => globalThis.__smokeGone.push({ type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name }));
  app.on("render-process-gone", (_e, _w, d) => globalThis.__smokeGone.push({ type: "renderer", reason: d.reason, exitCode: d.exitCode }));
  return true;
})()`);

// --- helpers
let shotN = 0;
async function shot(name) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  const file = `${String(++shotN).padStart(3, "0")}-${name.replace(/[^a-z0-9.-]+/gi, "_")}.png`;
  if (r.result?.data) writeFileSync(join(SHOTS, file), Buffer.from(r.result.data, "base64"));
  else record("screenshots", name, false, JSON.stringify(r.error ?? r).slice(0, 200));
  return file;
}
function screencapture(name) {
  const file = join(SHOTS, `${String(++shotN).padStart(3, "0")}-${name}.png`);
  try {
    execFileSync("screencapture", ["-x", file], { timeout: 20000 });
    return file;
  } catch (e) {
    record("screenshots", `screencapture ${name}`, false, e.message.split("\n")[0]);
    return null;
  }
}
// The whole screen, plus a strip of the menu bar around our icon.
function menuBarShot(name, b) {
  const full = screencapture(`fullscreen-${name}`);
  if (!full || !b) return;
  try {
    const crop = join(SHOTS, `${String(++shotN).padStart(3, "0")}-${name}-icon.png`);
    const scale = result.system?.scale ?? 1;
    // sips crops around the center: a 240 x 40 pt strip centered on the icon.
    const px = Math.round(scale * (b.x + b.width / 2));
    const py = Math.round(scale * (b.y + b.height / 2));
    const w = Math.round(240 * scale);
    const h = Math.round(40 * scale);
    execFileSync("sips", ["-c", String(h), String(w), "--cropOffset", String(Math.max(0, py - h / 2)), String(Math.max(0, px - w / 2)), full, "--out", crop], { stdio: "ignore" });
  } catch (e) {
    log("menu-bar crop failed:", e.message.split("\n")[0]);
  }
}
const tap = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el; })()`);
const READY = `document.readyState === "complete" && !!document.querySelector("[data-rail]")`;
async function waitReady(ms = 20000) {
  const t = Date.now();
  await sleep(800);
  while (Date.now() - t < ms) {
    if (await ev(READY).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}
// A Developer card switch by its label (the switch's aria-label), set to `on`.
async function devSwitch(labelStart, on) {
  return ev(`(() => {
    const sw = [...document.querySelectorAll('button[role="switch"]')].find((b) => (b.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(labelStart)}));
    if (!sw) return "missing";
    if ((sw.getAttribute("aria-checked") === "true") === ${on}) return "already";
    sw.click();
    return "clicked";
  })()`);
}
async function expandSection(id) {
  return ev(`(() => {
    const s = document.querySelector('.dk-sec[data-section="${id}"]');
    if (!s) return false;
    const t = s.querySelector(".dk-sec-toggle");
    if (t.getAttribute("aria-expanded") !== "true") t.click();
    s.scrollIntoView({ block: "start" });
    return true;
  })()`);
}

// --- processes (ps: cumulative CPU time, RSS; tools/procs_mac.mjs)
const MAIN_PID = await mainEv("process.pid");
const ourProcs = () => macAppProcs(MAIN_PID);
async function cpuOver(secs) {
  const ticks = () => ourProcs().map((p) => ({ pid: p.pid, type: p.type, ticks: p.cpuS }));
  const a = ticks();
  await sleep(secs * 1000);
  const r = cpuByType(a, ticks(), secs, 1);
  r.total = cpuTotal(r);
  return r;
}
// macOS has no PSS. footprint (the "Memory" column of Activity Monitor:
// phys_footprint, the process's dirty + compressed memory) is the closest
// match; ps RSS (counts shared pages in every process) is reported beside it.
// The budget's rule (tools/budgets_lib.mjs memoryJudged): every app process
// except the GPU process is judged; the GPU process is reported apart.
function memory() {
  const procs = ourProcs();
  const gpuPids = new Set(procs.filter((p) => p.type === GPU_TYPE).map((p) => p.pid));
  const mb = (kb) => Math.round(kb / 102.4) / 10;
  const rssMb = mb(procs.filter((p) => !gpuPids.has(p.pid)).reduce((s, p) => s + p.rssKb, 0));
  const gpuRssMb = mb(procs.filter((p) => gpuPids.has(p.pid)).reduce((s, p) => s + p.rssKb, 0));
  let footprintMb = null;
  let gpuFootprintMb = null;
  let raw;
  try {
    raw = execFileSync(
      "footprint",
      procs.map((p) => String(p.pid)),
      { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const unit = { KB: 1 / 1024, MB: 1, GB: 1024 };
    let sum = 0;
    let gpu = 0;
    // footprint prints "<name> [pid]: <64-bit> Footprint: 123 MB (16384 bytes per page)" per process
    for (const m of raw.matchAll(/\[(\d+)\][^\n]*?Footprint:\s*([\d.]+)\s*(KB|MB|GB)/g)) {
      const v = Number(m[2]) * unit[m[3]];
      if (gpuPids.has(Number(m[1]))) gpu += v;
      else sum += v;
    }
    if (sum > 0) footprintMb = Math.round(sum * 10) / 10;
    if (gpu > 0) gpuFootprintMb = Math.round(gpu * 10) / 10;
  } catch (e) {
    raw = `footprint failed: ${e.message}`;
  }
  writeFileSync(join(OUT, `footprint-${Date.now()}.txt`), raw);
  return { footprintMb, gpuFootprintMb, rssMb, gpuRssMb, processes: procs.length, byType: Object.fromEntries(procs.map((p) => [`${p.type}:${p.pid}`, mb(p.rssKb)])) };
}

const result = { app: opts.app, startedAt: new Date().toISOString() };
const step = async (name, fn) => {
  currentStep = name;
  try {
    return await fn();
  } catch (e) {
    record(name, "ran to the end", false, e.message.split("\n")[0].slice(0, 300));
    return undefined;
  }
};

// ============================================================================
// 0. The system and the window
await step("system", async () => {
  await waitReady(30000);
  result.system = await mainEv(`(() => {
    const { app, screen, systemPreferences, nativeTheme } = ${E};
    const d = screen.getPrimaryDisplay();
    return { macos: process.getSystemVersion(), arch: process.arch, electron: process.versions.electron, appVersion: app.getVersion(),
      display: d.size, scale: d.scaleFactor, gpu: app.getGPUFeatureStatus().gpu_compositing,
      isTranslated: app.runningUnderARM64Translation, dark: nativeTheme.shouldUseDarkColors,
      accent: systemPreferences.getAccentColor(), userData: app.getPath("userData") };
  })()`);
  log("system:", JSON.stringify(result.system));
  record("system", "native arm64, not under Rosetta", result.system.arch === "arm64" && !result.system.isTranslated, `${result.system.arch}, translated=${result.system.isTranslated}`);
  // A fixed size that fits the runner's display (1024 x 768 on GitHub's
  // macOS runners): screenshots match between runs.
  log(
    "window:",
    await win(
      `const a = ${E}.screen.getPrimaryDisplay().workArea; w.setBounds({ x: a.x, y: a.y, width: Math.min(1100, a.width), height: Math.min(900, a.height) }); w.show(); w.focus(); return JSON.stringify(w.getBounds());`,
    ),
  );
  await sleep(1000);
  await shot("first-start");
});

// 1. The Developer card's switches, clicked as a developer would
await step("dev switches", async () => {
  await ev(`localStorage.setItem("ds5.tourDone", "1"); window.desktop.setSetting("updatesAsked", true).then(() => 1)`);
  // Each switch (the first two reload the page), from the Developer section.
  // loop: SERIAL-REQUIRED — one page: each switch is clicked after the previous reload
  for (const [label, reloads] of [
    ["Simulate", true],
    ["Fake games", true],
    ["Pretend more controllers", false],
  ]) {
    await tap('[data-rail="app"]');
    await sleep(800);
    record("dev switches", `Developer section is there for ${label} (a dev-tools build)`, await expandSection("developer"));
    await sleep(600);
    const got = await devSwitch(label, true);
    record("dev switches", `${label} switch`, got === "clicked" || got === "already", got);
    if (reloads) {
      await waitReady();
      await sleep(4000);
    }
  }
  await sleep(1000);
  const state = await ev(`({ simulated: localStorage.getItem("ds5.dev.simulated"), fakeSlots: localStorage.getItem("ds5.dev.fakeSlots") })`);
  const fg = await ev(`window.desktop.devFakeGames({}).then((s) => s.on)`);
  record("dev switches", "all three on", state.simulated === "1" && state.fakeSlots === "1" && fg === true, JSON.stringify({ ...state, fakeGames: fg }));
  await shot("app-developer-on");
});

// 2. Every page, every section, every controller part
const SECTIONS = (() => {
  const src = readFileSync(join(ROOT, "src/desktop/accordion/sections.ts"), "utf8");
  const body = /SECTIONS = \{([\s\S]*?)\} as const/.exec(src)[1];
  return Object.fromEntries([...body.matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, k, v]) => [k, [...v.matchAll(/"(\w+)"/g)].map((m) => m[1])]));
})();
const PARTS = ["lightbar", "l2", "r1", "cross", "dpad-up", "stick-l", "touchpad", "speaker", "mute", "ps", "create", "options", "player-leds"];
result.pages = {};
await step("pages", async () => {
  const rail = await ev(`[...document.querySelectorAll("[data-rail]")].map((e) => e.dataset.rail)`);
  result.rail = rail;
  record("mac", "Games page hidden on macOS", !rail.includes("games"), `rail: ${rail.join(", ")}`);
  for (const item of rail) {
    currentStep = `page ${item}`;
    await tap(`[data-rail="${item}"]`);
    await sleep(1500);
    await shot(`${item}`);
    const listed = SECTIONS[item] ?? [];
    const shown = await ev(`[...document.querySelectorAll(".dk-sec[data-section]")].map((s) => s.dataset.section)`);
    const ids = [...listed.filter((id) => shown.includes(id)), ...shown.filter((id) => !listed.includes(id))];
    const missing = listed.filter((id) => !shown.includes(id));
    result.pages[item] = { sections: ids, notShown: missing };
    if (missing.length) record("pages", `${item}: sections in sections.ts not on the page`, null, missing.join(", "));
    // loop: SERIAL-REQUIRED — one window: each section is opened, then captured
    for (const id of ids) {
      currentStep = `page ${item} / ${id}`;
      await expandSection(id);
      await sleep(900);
      await shot(`${item}-${id}`);
    }
    if (item === "controller") {
      // loop: SERIAL-REQUIRED — one window: each part is selected, then captured
      for (const part of PARTS) {
        currentStep = `controller part ${part}`;
        const hit = await ev(`(() => { const el = document.querySelector('.live-ctl [data-part="${part}"]'); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!el; })()`);
        if (!hit) {
          record("pages", `controller part ${part} is drawn`, false);
          continue;
        }
        await sleep(700);
        await shot(`controller-part-${part}`);
      }
      if (await tap('[data-view="buttons"]')) {
        await sleep(900);
        await shot("controller-buttons");
      }
    }
    // The bottom of everything on the page that scrolls (the page, the stage, the side panel).
    const scrolled = await ev(
      `(() => { let n = 0; for (const b of document.querySelectorAll("main.dk-body, .live-stage, .live-panel .dk-panel-body, .live-panel")) { if (b.scrollHeight > b.clientHeight + 4) { b.scrollTop = b.scrollHeight; n++; } } return n; })()`,
    );
    if (scrolled) {
      await sleep(600);
      await shot(`${item}-scrolled`);
    }
  }
  record("pages", "visited every page on the rail", rail.length >= 4, `${rail.length} pages, ${shotN} screenshots`);
});

// 3. Mac-specific checks
await step("tray", async () => {
  // The app's status items in the menu bar, as macOS sees them
  // (accessibility: System Events, menu bar 2 = the status area).
  let items = [];
  try {
    const out = execFileSync("osascript", ["-e", `tell application "System Events" to tell process "${APP_NAME}" to get {position, size} of every menu bar item of menu bar 2`], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });
    // "x, y, w, h" per item, flattened: positions first, then sizes.
    const n = out.trim() ? out.split(",").map((v) => Number(v.trim())) : [];
    const half = n.length / 2;
    for (let i = 0; i < half / 2; i++) items.push({ x: n[i * 2], y: n[i * 2 + 1], width: n[half + i * 2], height: n[half + i * 2 + 1] });
  } catch (e) {
    record(
      "mac",
      "menu-bar items readable (System Events)",
      false,
      String(e.stderr ?? e.message)
        .trim()
        .split("\n")[0],
    );
  }
  result.tray = items;
  record("mac", "menu-bar (tray) icon exists", items.length === 1, JSON.stringify(items));
  const b = items[0];
  record("mac", "menu-bar icon is on screen in the menu bar", b && b.width > 0 && b.y < 40, JSON.stringify(b));
  // A template image (black + alpha) follows the menu bar's light/dark look
  // (tray.ts, tools/prepare_tray_template.py; the live one from trayIcon.ts).
  const files = readdirSync(join(opts.app, "Contents/Resources/resources")).filter((f) => f.startsWith("tray"));
  record(
    "mac",
    "menu-bar icon is a template image (follows menu bar light/dark)",
    files.includes("trayTemplate.png") && files.includes("trayTemplate@2x.png"),
    files.filter((f) => /Template/.test(f)).join(", ") || "no template files",
  );
  menuBarShot("menubar", b);
});

await step("app menu", async () => {
  const menu = await mainEv(`(() => {
    const m = ${E}.Menu.getApplicationMenu();
    if (!m) return null;
    const walk = (items) => items.map((i) => ({ label: i.label, role: i.role ?? null, accelerator: i.accelerator ?? null, sub: i.submenu ? walk(i.submenu.items) : undefined }));
    return walk(m.items);
  })()`);
  result.appMenu = menu;
  record("mac", "an application menu is set", !!menu, menu ? menu.map((i) => i.label).join(" | ") : "none");
  const roles = JSON.stringify(menu ?? []);
  for (const role of ["quit", "copy", "paste", "selectall", "undo", "close", "minimize"])
    record("mac", `app menu has ${role} (Cmd shortcuts in text fields)`, new RegExp(`"role":"${role}"`, "i").test(roles));
});

await step("launch at login", async () => {
  const read = () => mainEv(`(() => { const s = ${E}.app.getLoginItemSettings(); return { openAtLogin: s.openAtLogin, status: s.status ?? null, openAsHidden: s.openAsHidden ?? null }; })()`);
  const before = await read();
  await ev(`window.desktop.setSetting("launchAtLogin", true).then(() => 1)`);
  await sleep(1500);
  const on = await read();
  await ev(`window.desktop.setSetting("launchAtLogin", false).then(() => 1)`);
  await sleep(1500);
  const off = await read();
  result.loginItem = { before, on, off };
  record("mac", "Launch at login turns on (app.getLoginItemSettings)", on.openAtLogin === true || on.status === "requires-approval", JSON.stringify(on));
  record("mac", "Launch at login turns off again", off.openAtLogin === false, JSON.stringify(off));
  const setting = await ev(`window.desktop.getSettings ? window.desktop.getSettings().then((s) => s.launchAtLogin) : null`).catch(() => null);
  if (setting !== null) record("mac", "the app's setting matches", setting === false, String(setting));
});

await step("appearance", async () => {
  // The "Match desktop" theme: the system accent and light/dark.
  await ev(`localStorage.setItem("ds5-bridge-theme", "desktop"); location.reload()`);
  await waitReady();
  await sleep(3000);
  await tap('[data-rail="app"]');
  await sleep(800);
  await expandSection("appearance");
  await sleep(800);
  const look = () =>
    ev(
      `(() => { const dk = getComputedStyle(document.querySelector(".dk") ?? document.documentElement); return { accent: dk.getPropertyValue("--dk-accent").trim(), bg: dk.getPropertyValue("--bg-panel").trim(), scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" }; })()`,
    );
  const sys = () => mainEv(`({ dark: ${E}.nativeTheme.shouldUseDarkColors, accent: ${E}.systemPreferences.getAccentColor() })`);
  const first = { system: await sys(), page: await look() };
  await shot(`appearance-desktop-${first.system.dark ? "dark" : "light"}`);
  record("mac", "system accent color read", /^[0-9a-f]{8}$/i.test(first.system.accent ?? ""), first.system.accent);
  // Flip the system appearance the way a user does (System Events), else
  // fall back to the app's own nativeTheme.themeSource (app-only flip).
  const target = !first.system.dark;
  let how = "System Events";
  try {
    execFileSync("osascript", ["-e", `tell application "System Events" to tell appearance preferences to set dark mode to ${target}`], { timeout: 30000, stdio: "pipe" });
  } catch (e) {
    how = `nativeTheme.themeSource (System Events refused: ${
      String(e.stderr ?? e.message)
        .trim()
        .split("\n")[0]
    })`;
    await mainEv(`${E}.nativeTheme.themeSource = ${JSON.stringify(target ? "dark" : "light")}`);
  }
  await sleep(3000);
  const second = { system: await sys(), page: await look() };
  await shot(`appearance-desktop-${second.system.dark ? "dark" : "light"}`);
  menuBarShot(`menubar-${second.system.dark ? "dark" : "light"}`, result.tray?.[0]);
  result.appearance = { how, first, second };
  record("mac", `dark/light switch reaches the app (${how.split(" (")[0]})`, second.system.dark === target, `system dark ${first.system.dark} -> ${second.system.dark}`);
  record("mac", "Match desktop theme follows light/dark", second.page.bg !== first.page.bg, `--bg-panel ${first.page.bg} -> ${second.page.bg}`);
  // Back to how it was.
  if (how === "System Events") execFileSync("osascript", ["-e", `tell application "System Events" to tell appearance preferences to set dark mode to ${!target}`], { timeout: 30000, stdio: "pipe" });
  else await mainEv(`${E}.nativeTheme.themeSource = "system"`);
  await ev(`localStorage.removeItem("ds5-bridge-theme"); location.reload()`);
  await waitReady();
  await sleep(3000);
});

// GPU: what Chromium really runs on (informational: the runner's GPU is
// virtual), and the HDR lighting path (live/HdrGlow.tsx): WebGPU, an
// rgba16float canvas in extended tone mapping. The runner's display isn't
// HDR, so the glow itself never shows; this proves the path starts cleanly.
await step("gpu", async () => {
  const gpu = await mainEv(`(async () => {
    const { app } = ${E};
    const info = await app.getGPUInfo("basic");
    return { status: app.getGPUFeatureStatus(), devices: info.gpuDevice ?? [], aux: info.auxAttributes ?? {}, machine: info.machineModelName ?? null };
  })()`);
  const accel = await ev(`window.desktop.getSettings().then((s) => s.hardwareAcceleration)`);
  result.gpu = { ...gpu, hardwareAccelerationSetting: accel };
  const st = gpu.status;
  const software = !/^enabled/.test(st.gpu_compositing ?? "");
  record("gpu", "compositing on the GPU while Hardware acceleration is on", !(software && accel), `gpu_compositing=${st.gpu_compositing}, setting=${accel}`);
  const dev = gpu.devices.find((d) => d.active) ?? gpu.devices[0];
  record(
    "gpu",
    "Chromium's GPU status",
    null,
    `${dev ? `${dev.vendorString || dev.vendorId} ${dev.deviceString || dev.deviceId}` : "no device"}; ${[
      "gpu_compositing",
      "rasterization",
      "webgl",
      "webgl2",
      "webgpu",
      "video_decode",
      "skia_graphite",
    ]
      .map((k) => `${k}=${st[k] ?? "?"}`)
      .join(", ")}`,
  );
  // The HDR path, as HdrGlow.tsx starts it, on a canvas that is never shown.
  const hdr = await ev(`(async () => {
    const out = { dynamicRangeHigh: matchMedia("(dynamic-range: high)").matches, videoDynamicRangeHigh: matchMedia("(video-dynamic-range: high)").matches, hasGpu: "gpu" in navigator };
    if (!out.hasGpu) return out;
    try {
      out.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      const adapter = await navigator.gpu.requestAdapter();
      out.adapter = !!adapter;
      if (!adapter) return out;
      const i = adapter.info ?? {};
      out.adapterInfo = { vendor: i.vendor, architecture: i.architecture, description: i.description, device: i.device };
      out.features = [...adapter.features].sort();
      const device = await adapter.requestDevice();
      const errors = [];
      device.pushErrorScope("validation");
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext("webgpu");
      ctx.configure({ device, format: "rgba16float", toneMapping: { mode: "extended" }, alphaMode: "premultiplied" });
      out.configured = ctx.getConfiguration ? ctx.getConfiguration().toneMapping?.mode ?? "configured" : "configured";
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 4, g: 4, b: 4, a: 1 }, loadOp: "clear", storeOp: "store" }] });
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      const e = await device.popErrorScope();
      if (e) errors.push(e.message);
      out.validationErrors = errors;
      ctx.unconfigure?.();
      device.destroy();
    } catch (e) {
      out.error = String(e && e.message || e);
    }
    return out;
  })()`);
  result.hdr = hdr;
  record("hdr", "WebGPU there (navigator.gpu)", hdr.hasGpu, `dynamic-range: high = ${hdr.dynamicRangeHigh} (the runner's display isn't HDR)`);
  record("hdr", "an adapter", hdr.adapter === true, hdr.adapterInfo ? JSON.stringify(hdr.adapterInfo) : (hdr.error ?? ""));
  record(
    "hdr",
    "rgba16float + extended tone mapping configures and draws with no error",
    hdr.configured && !hdr.error && (hdr.validationErrors ?? []).length === 0,
    hdr.error ?? `toneMapping=${hdr.configured}; ${(hdr.features ?? []).length} features`,
  );
  // The Developer card's HDR test (three swatches; only a person on an HDR
  // display can judge them), screenshotted.
  await tap('[data-rail="app"]');
  await sleep(800);
  await expandSection("developer");
  await sleep(1500);
  const swatch = await ev(
    `(() => { const t = document.querySelector(".hdr-test"); t?.scrollIntoView({ block: "center" }); return t ? [...t.querySelectorAll("figcaption")].map((f) => f.textContent).join(" | ") : null; })()`,
  );
  await sleep(600);
  await shot("app-developer-hdr-test");
  record("hdr", "Developer card's HDR test: the WebGPU swatch starts", !!swatch && !/✗/.test(swatch), swatch ?? "no HDR test on the page");
});

// 5. Budgets (before the single-instance and quit checks, which hide and end it)
const budgetsFile = join(ROOT, "tools/budgets.json");
const budgets = existsSync(budgetsFile) ? JSON.parse(readFileSync(budgetsFile, "utf8")).budgets : null;
await step("budgets", async () => {
  await ev(`localStorage.setItem("ds5.dev.simRest", "still"); location.reload()`);
  await waitReady();
  await sleep(4000);
  await win(`w.show(); w.focus(); return true;`);
  const pages = [];
  for (const item of result.rail.filter((r) => r !== "games")) {
    currentStep = `budgets ${item}`;
    await tap(`[data-rail="${item}"]`);
    await sleep(8000);
    const cpu = await cpuOver(Number(opts.cpuS));
    const framesPerS = await framesOver(page, Number(opts.traceS));
    const anims = await ev(
      `[...new Set(document.getAnimations().filter((a) => a.playState === "running").map((a) => (a.animationName ?? a.transitionProperty ?? "?") + "@" + String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? "").split(" ")[0]))]`,
    );
    pages.push({ page: item, framesPerS, cpu, anims });
    log(`budgets ${item}:`, JSON.stringify(pages.at(-1)));
  }
  const memShown = memory();
  currentStep = "budgets hidden";
  await win(`w.hide(); return true;`);
  await sleep(10000);
  const pageSawHide = await ev(`document.documentElement.hasAttribute("data-window-hidden")`);
  const hidden = { secs: Number(opts.hiddenS), cpu: await cpuOver(Number(opts.hiddenS)), pageSawHide };
  const memHidden = memory();
  result.budgets = { limits: budgets, pages, hidden, memory: { shown: memShown, hidden: memHidden } };
  record("lean", "the page knows it's hidden (data-window-hidden)", pageSawHide);
  await win(`w.show(); w.focus(); return true;`);
  await sleep(1500);
});

await step("single instance", async () => {
  // Dock / Finder / Spotlight: LaunchServices re-opens the running copy (activate).
  await win(`w.hide(); return true;`);
  await sleep(1500);
  execFileSync("open", ["-a", opts.app], { timeout: 30000 });
  await sleep(4000);
  record("mac", "opening it again (open -a) shows the hidden window", await win(`return w.isVisible();`));
  // A second process (a shortcut or script that runs the binary): it must
  // quit at once and bring the first window forward.
  await win(`w.hide(); return true;`);
  await sleep(1500);
  const second = spawn(BINARY, [], { stdio: "ignore" });
  const code = await Promise.race([new Promise((r) => second.on("exit", (c) => r(c))), sleep(20000).then(() => "still running")]);
  if (code === "still running") second.kill("SIGKILL");
  await sleep(2500);
  record("mac", "a second process exits by itself", code === 0, `exit ${code}`);
  record("mac", "and the first window comes forward", await win(`return w.isVisible();`));
  const mains = procTable().filter((p) => p.cmd.startsWith(BINARY) && !/--type=/.test(p.cmd));
  record("mac", "one app process left", mains.length === 1, mains.map((p) => p.pid).join(", "));
});

// 4. Errors (before Quit: the inspector goes with the app)
await step("errors", async () => {
  await sleep(2000);
  const gone = await mainEv("globalThis.__smokeGone");
  crashes.push(...gone.filter((g) => !(g.reason === "clean-exit")));
  result.crashes = crashes;
  record("errors", "no crashed processes", crashes.length === 0, JSON.stringify(crashes));
  record("errors", "no renderer console errors or exceptions", rendererErrors.length === 0, `${rendererErrors.length} errors`);
});

await step("quit", async () => {
  // Close-to-tray is on by default: closing the window keeps it running;
  // Quit (Cmd+Q, the app menu's Quit) must end every process.
  await win(`w.close(); return true;`);
  await sleep(2000);
  record(
    "mac",
    "closing the window keeps it in the menu bar (close to tray)",
    procTable().some((p) => p.pid === MAIN_PID),
  );
  await win(`w.show(); return true;`);
  await sleep(1000);
  // The inspector client must be gone first: Node waits for an attached
  // debugger before the process exits ("Debugger ending on ...").
  main.close();
  let how = "osascript quit (Apple Event, as Cmd+Q / Dock Quit)";
  try {
    execFileSync("osascript", ["-e", `tell application "${APP_NAME}" to quit`], { timeout: 30000, stdio: "pipe" });
  } catch (e) {
    how = `app menu Quit item (osascript refused: ${
      String(e.stderr ?? e.message)
        .trim()
        .split("\n")[0]
    })`;
    const again = await connect((await waitForPort(Number(opts.inspect), 10))[0].webSocketDebuggerUrl);
    await again.send("Runtime.evaluate", {
      expression: `(() => { const find = (items) => { for (const i of items) { if (i.role === "quit") return i; const s = i.submenu && find(i.submenu.items); if (s) return s; } }; setTimeout(() => find(${E}.Menu.getApplicationMenu().items)?.click(), 500); return true; })()`,
      includeCommandLineAPI: true,
    });
    again.close();
  }
  const t = Date.now();
  const alive = () => procTable().some((p) => p.pid === MAIN_PID);
  while (Date.now() - t < 20000 && alive()) await sleep(500);
  const left = procTable().filter((p) => p.pid === MAIN_PID || p.cmd.includes(`${opts.app}/`));
  result.quit = { how, secs: Math.round((Date.now() - t) / 100) / 10, left: left.map((p) => p.cmd.slice(0, 120)) };
  record("mac", `Quit ends every process (${how.split(" (")[0]})`, left.length === 0, left.length ? `${left.length} left after ${result.quit.secs} s` : `${result.quit.secs} s`);
});

if (existsSync(join(OUT, "launch-refused.txt"))) record("mac", "starts from /Applications with open -a (LaunchServices)", false, readFileSync(join(OUT, "launch-refused.txt"), "utf8").trim());
else record("mac", "starts from /Applications with open -a (LaunchServices)", true);

// Crash reports macOS wrote for the app during the run.
const reports = (() => {
  const dir = join(process.env.HOME, "Library/Logs/DiagnosticReports");
  try {
    const since = Date.parse(result.startedAt) - 120000;
    return readdirSync(dir).filter((f) => /DS5|Electron|Helper/i.test(f) && statSync(join(dir, f)).mtimeMs > since);
  } catch {
    return [];
  }
})();
record("errors", "no macOS crash reports", reports.length === 0, reports.join(", "));

// Main-process output (stdout + stderr via open --stdout/--stderr).
const mainLines = (opts.log ?? "")
  .split(",")
  .filter((f) => f && existsSync(f))
  .flatMap((f) => readFileSync(f, "utf8").split("\n"))
  .filter((l) => l.trim());
const ERRORISH = /error|fail|crash|exception|uncaught|unhandled|fatal|\[\d+:\d+\/[\d.]+:(ERROR|FATAL)/i;
const mainErrors = mainLines.filter((l) => ERRORISH.test(l) && !allowed(l));
const mainAllowed = mainLines.filter((l) => allowed(l));
record("errors", "no errors from the main process", mainErrors.length === 0, `${mainErrors.length} lines`);

// ============================================================================
// 6. The report
result.checks = checks;
result.errors = { renderer: rendererErrors, rendererWarnings, main: mainErrors, mainAllowed, mainLines: mainLines.length, crashReports: reports };
writeFileSync(join(OUT, "results.json"), JSON.stringify(result, null, 2));

const md = [];
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const failed = checks.filter((c) => c.ok === false);
md.push(`## macOS smoke test: ${failed.length ? `${failed.length} failed` : "passed"}`, "");
if (result.system)
  md.push(
    `macOS ${result.system.macos} (${result.system.arch}), app ${result.system.appVersion}, Electron ${result.system.electron}, display ${result.system.display.width}x${result.system.display.height} @${result.system.scale}x, GPU compositing: ${result.system.gpu}`,
    "",
  );
md.push("| | Area | Check | Detail |", "|---|---|---|---|");
for (const c of checks) md.push(`| ${c.ok === null ? "ℹ️" : c.ok ? "✅" : "❌"} | ${c.area} | ${esc(c.name)} | ${esc(c.detail).slice(0, 200)} |`);
if (result.gpu) {
  const st = result.gpu.status;
  md.push("", "### GPU and HDR path", "", "| | |", "|---|---|");
  for (const [k, v] of Object.entries(st)) md.push(`| ${k} | ${v} |`);
  for (const d of result.gpu.devices) md.push(`| GPU device${d.active ? " (active)" : ""} | ${esc(`${d.vendorString || d.vendorId} ${d.deviceString || d.deviceId}`)} |`);
  if (result.hdr) {
    const h = result.hdr;
    md.push(`| dynamic-range: high | ${h.dynamicRangeHigh} |`, `| navigator.gpu | ${h.hasGpu} |`, `| preferred canvas format | ${h.preferredFormat ?? "?"} |`);
    md.push(
      `| adapter | ${esc(JSON.stringify(h.adapterInfo ?? h.adapter ?? null))} |`,
      `| rgba16float, extended | ${h.error ? esc(h.error) : `toneMapping ${h.configured}, ${(h.validationErrors ?? []).length} validation errors`} |`,
    );
    md.push(`| adapter features | ${esc((h.features ?? []).join(", "))} |`);
  }
}
if (result.budgets) {
  const b = result.budgets;
  const lim = (k) => (b.limits?.[k] ? ` (budget ${b.limits[k].max})` : "");
  md.push("", `### Resources (reported, not judged yet${b.limits ? "; budgets from tools/budgets.json" : "; tools/budgets.json not on this branch"})`, "");
  md.push(`| Page | Idle frames/s${lim("idleFrames")} | CPU % of a core: main / renderer / GPU / utility / total | Running animations |`, "|---|---|---|---|");
  for (const p of b.pages)
    md.push(
      `| ${p.page} | ${p.framesPerS} | ${p.cpu.main ?? 0} / ${p.cpu.renderer ?? 0} / ${p.cpu["gpu-process"] ?? 0} / ${p.cpu.utility ?? 0} / **${p.cpu.total}** | ${esc(p.anims.join(", ")) || "none"} |`,
    );
  md.push("", `Hidden (window in the menu bar, ${b.hidden.secs} s): **${b.hidden.cpu.total}%** of a core in all${lim("hiddenCpu")}; ${esc(JSON.stringify(b.hidden.cpu))}`);
  md.push(
    "",
    `Memory without the GPU process (the budget's rule), shown: footprint **${b.memory.shown.footprintMb ?? "n/a"} MB**, RSS ${b.memory.shown.rssMb} MB (${b.memory.shown.processes} processes in all); hidden: footprint ${b.memory.hidden.footprintMb ?? "n/a"} MB, RSS ${b.memory.hidden.rssMb} MB${lim("memory")}${b.limits?.memory && b.memory.shown.footprintMb != null ? ` → ${b.memory.shown.footprintMb <= b.limits.memory.max ? "within" : "over"} budget` : ""}. GPU process (reported only): footprint ${b.memory.shown.gpuFootprintMb ?? "n/a"} MB, RSS ${b.memory.shown.gpuRssMb} MB. macOS has no PSS: footprint (Activity Monitor's Memory) is the closest; RSS counts shared pages in every process.`,
  );
}
md.push(
  "",
  `### Errors`,
  "",
  `Renderer: ${rendererErrors.length} errors, ${rendererWarnings.length} warnings. Main process: ${mainErrors.length} error lines of ${mainLines.length}; allowed: ${mainAllowed.length}.`,
);
for (const e of [...rendererErrors, ...mainErrors.map((t) => ({ step: "main", kind: "stderr/stdout", text: t }))].slice(0, 40)) md.push(`- \`${esc(e.step)}\` ${e.kind}: ${esc(e.text).slice(0, 300)}`);
if (rendererWarnings.length)
  md.push("", "<details><summary>Renderer warnings</summary>", "", ...rendererWarnings.slice(0, 40).map((w) => `- \`${esc(w.step)}\` ${esc(w.text).slice(0, 300)}`), "", "</details>");
md.push("", `Allowed lines: ${ALLOW.map((a) => `\`${a.re.source}\` (${a.why})`).join("; ")}.`);
writeFileSync(join(OUT, "summary.md"), md.join("\n") + "\n");
page.close();
log(failed.length ? `${failed.length} checks failed` : "all checks passed");
process.exit(failed.length ? 1 : 0);
