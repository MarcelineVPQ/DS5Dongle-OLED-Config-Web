#!/usr/bin/env node
// Sleep/wake test of the installed app in the Windows test VM (libvirt
// win11-test), with the simulated board: docs/test-plans/sleep-wake.md.
//
//   node tools/sleep_wake_vm.mjs                    3 cycles, 60 s asleep each
//   node tools/sleep_wake_vm.mjs --cycles 5 --sleep 120 --out tmp/sleep-wake-vm
//   --keep leaves the test copy running at the end
//   --no-return: the negative control, the board stays off USB after the wake
//   (the controller never comes back): every cycle must FAIL (reconnect)
//
// The VM has no sleep state (QEMU's ACPI offers no S3 / S0ix / hibernate
// while the domain's <pm> has them off, and turning them on needs a VM
// restart), so each cycle builds a sleep from the parts the app can notice:
//   1. Windows' power broadcast: WM_POWERBROADCAST PBT_APMSUSPEND to the
//      app's windows (Chromium's power monitor window included), sent in the
//      signed-in session by tools/sleep_wake_vm.ps1;
//   2. the board side of a sleep (src/usb_power.h in the firmware): the
//      controller turns off while the PC sleeps;
//   3. the PC asleep: the whole VM frozen (virsh suspend): every guest CPU,
//      timer and poll stops, as in S3;
//   4. the wake: virsh resume, the guest clock jumped forward to now (a real
//      sleep's wall-clock jump), then PBT_APMRESUMESUSPEND +
//      PBT_APMRESUMEAUTOMATIC;
//   5. the board side of the wake: with no controller the board leaves USB
//      after its 2 s resume grace; the controller comes back (PS) and the
//      board is on USB again: a USB disconnect + connect for the app.
// After every wake it checks: the guest agent answers, the page answers
// over CDP and switches pages, Electron saw the suspend and the resume, the
// board reconnects on its own, the board's audio path (core1 running, USB
// audio frames and Bluetooth packets moving), the config (haptics, speaker,
// mic settings) equal to before the sleep, a grip haptics test accepted, no
// uncaught exception or console error in the page or main, and the app's
// CPU back under the shown-idle budget (tools/budgets.json).
//
// Rules (docs/test-plans/sleep-wake.md): the VM is never started, shut
// down, restarted or reset here; a VM that doesn't come back is reported,
// not forced. No USB device is attached to the VM. The test copy has its
// own settings folder, DevTools on 9222 / inspector on 9221 (reached from
// here through the VM's portproxy on 9340 / 9341), and is stopped with
// app.quit() at the end.
/* global AbortSignal -- Node 22's built-in */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { appTree, cpuByType, cpuTotal, GPU_TYPE, MEASUREMENT_TYPES } from "./budgets_lib.mjs";
import { connect } from "./cdp_lib.mjs";
import { parseWinProcs, winQueryScript } from "./procs_windows.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const VM = process.env.DS5_SW_VM ?? "win11-test";
const CYCLES = Number(opt("cycles", 3));
const SLEEP_S = Number(opt("sleep", 60));
const OUT = opt("out", "tmp/sleep-wake-vm");
const KEEP = args.includes("--keep");
const NO_RETURN = args.includes("--no-return");
const BUDGETS = JSON.parse(readFileSync(join(HERE, "budgets.json"), "utf8"));
const CPU_MAX = BUDGETS.budgets.shownCpu.max;

const USER = "vm-lunux\\marcy";
const EXE_NAME = "DS5 Dongle OLED Edition Configurator";
const EXE = `C:\\Users\\marcy\\AppData\\Local\\Programs\\ds5-dongle-configurator\\${EXE_NAME}.exe`;
const WORK = "C:\\ds5test\\sleepwake";
const UD = "C:\\Users\\marcy\\AppData\\Local\\Temp\\ds5-sleepwake-ud";
const PAGE_PORT = 9340; // portproxy → 127.0.0.1:9222 (the app's --remote-debugging-port)
const MAIN_PORT = 9341; // portproxy → 127.0.0.1:9221 (the app's --inspect)
const FW_RULE = "DS5 sleep-wake inspector";

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);

// ---- the VM, through libvirt and the guest agent ----
const virsh = (...a) => execFileSync("virsh", ["-c", "qemu:///system", ...a], { encoding: "utf8", timeout: 60000 }).trim();
const ga = (cmd, timeoutS = 10) => JSON.parse(virsh("qemu-agent-command", VM, "--timeout", String(timeoutS), JSON.stringify(cmd))).return;
function agentAnswers() {
  try {
    ga({ execute: "guest-ping" }, 5);
    return true;
  } catch {
    return false;
  }
}
// PowerShell as SYSTEM in the guest; returns stdout (throws on a non-zero exit).
async function ps(script, timeoutS = 120) {
  const enc = Buffer.from("$ProgressPreference='SilentlyContinue'\n" + script, "utf16le").toString("base64");
  const { pid } = ga({ execute: "guest-exec", arguments: { path: "powershell.exe", arg: ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc], "capture-output": true } });
  const until = Date.now() + timeoutS * 1000;
  // loop: SERIAL-REQUIRED — a deadline: polls the one guest process until it exits
  while (Date.now() < until) {
    const s = ga({ execute: "guest-exec-status", arguments: { pid } });
    if (s.exited) {
      const out = Buffer.from(s["out-data"] ?? "", "base64")
        .toString("utf8")
        .trim();
      if (s.exitcode)
        throw new Error(
          `guest PowerShell exit ${s.exitcode}: ${out} ${Buffer.from(s["err-data"] ?? "", "base64")
            .toString("utf8")
            .slice(0, 400)}`,
        );
      return out;
    }
    await sleep(200);
  }
  throw new Error("guest PowerShell timed out");
}
// A program in the signed-in session (a scheduled task with an interactive
// token): GUI apps and window messages need it, the agent runs in session 0.
const asUser = (name, exe, argline, wait) => `
$a = New-ScheduledTaskAction -Execute '${exe}' -Argument '${argline.replace(/'/g, "''")}'
$p = New-ScheduledTaskPrincipal -UserId '${USER}' -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName '${name}' -Action $a -Principal $p -Settings $s -Force | Out-Null
Start-ScheduledTask -TaskName '${name}'
${wait ? `Start-Sleep -Milliseconds 500; $sw = [Diagnostics.Stopwatch]::StartNew(); while ($sw.Elapsed.TotalSeconds -lt 30 -and (Get-ScheduledTask -TaskName '${name}').State -eq 'Running') { Start-Sleep -Milliseconds 200 }` : ""}
Unregister-ScheduledTask -TaskName '${name}' -Confirm:$false`;

async function powerBroadcast(event) {
  const out =
    await ps(`${asUser("DS5 sleepwake pbt", "powershell.exe", `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ${WORK}\\pbt.ps1 -Event ${event} -Out ${WORK}\\pbt.log`, true)}
Get-Content '${WORK}\\pbt.log'`);
  return out;
}

function guestIp() {
  const m = /ipv4\s+(\d+\.\d+\.\d+\.\d+)\/\d+/.exec(virsh("domifaddr", VM, "--source", "agent").replace(/127\.0\.0\.1\/8/, ""));
  if (!m) throw new Error("no guest IPv4 address from the agent");
  return m[1];
}

// ---- report ----
const report = {
  vm: VM,
  cycles: CYCLES,
  sleepS: SLEEP_S,
  cpuMax: CPU_MAX,
  method: "power broadcast + VM freeze + simulated board sleep/wake",
  startedAt: new Date().toISOString(),
  baseline: null,
  results: [],
  bugs: [],
  notes: [],
};
mkdirSync(OUT, { recursive: true });
const save = () => writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
function fail(msg) {
  report.aborted = msg;
  save();
  console.error(`ABORT: ${msg}`);
  process.exit(2);
}

// ---- preflight: never starts the VM ----
const state = virsh("domstate", VM);
if (state !== "running") fail(`the VM ${VM} is "${state}". Start it and sign in; this test never starts, stops or resets it.`);
if (!agentAnswers()) fail("the guest agent doesn't answer (the VM is running)");
const HOST = process.env.DS5_SW_HOST ?? guestIp();
log(`VM ${VM} running, agent answers, guest ${HOST}`);

// ---- set up the guest: the broadcast script, port proxies, the test copy ----
const pbt = readFileSync(join(HERE, "sleep_wake_vm.ps1")).toString("base64");
log(
  await ps(`
New-Item -ItemType Directory -Force '${WORK}' | Out-Null
[IO.File]::WriteAllBytes('${WORK}\\pbt.ps1', [Convert]::FromBase64String('${pbt}'))
netsh interface portproxy add v4tov4 listenport=${PAGE_PORT} listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1 | Out-Null
netsh interface portproxy add v4tov4 listenport=${MAIN_PORT} listenaddress=0.0.0.0 connectport=9221 connectaddress=127.0.0.1 | Out-Null
if (-not (Get-NetFirewallPortFilter | ? LocalPort -eq '${PAGE_PORT}')) { New-NetFirewallRule -DisplayName 'DS5 sleep-wake devtools' -Direction Inbound -Protocol TCP -LocalPort ${PAGE_PORT} -Action Allow | Out-Null }
if (-not (Get-NetFirewallRule -DisplayName '${FW_RULE}' -EA 0)) { New-NetFirewallRule -DisplayName '${FW_RULE}' -Direction Inbound -Protocol TCP -LocalPort ${MAIN_PORT} -Action Allow | Out-Null }
$i = Get-ItemProperty 'Registry::HKEY_USERS\\*\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA 0 | ? DisplayName -like 'DS5 Dongle OLED Edition*' | select -First 1
if (-not (Test-Path '${EXE}')) { 'app not installed'; exit 5 }
Get-Process -Name '${EXE_NAME}' -EA 0 | Stop-Process -Force -EA 0; Start-Sleep 2
Remove-Item -Recurse -Force '${UD}' -EA 0
${asUser("DS5 sleepwake launch", EXE, `--remote-debugging-port=9222 --inspect=9221 --user-data-dir="${UD}"`, false)}
"installed $($i.DisplayVersion); launched"`),
);

async function targetUrl(port, type) {
  // loop: SERIAL-REQUIRED — a deadline: the app's DevTools come up after the launch
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://${HOST}:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
      const t = list.find((x) => (type ? x.type === type : true));
      if (t) return t.webSocketDebuggerUrl.replace(/127\.0\.0\.1:\d+|localhost:\d+/, `${HOST}:${port}`);
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`no DevTools target on ${HOST}:${port}`);
}
// Uncaught exceptions and console errors in the page and in main; warnings
// (the app's logged() notes) kept apart, reported, not judged. Runtime.enable
// replays earlier console messages after a reconnect: each counts once.
const events = { errors: [], warnings: [] };
const seenEvents = new Set();
const watch = (where) => (d) => {
  const p = d.params ?? {};
  let kind = null;
  let text = "";
  if (d.method === "Runtime.exceptionThrown") {
    kind = "errors";
    text = `${where} exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").slice(0, 400)}`;
  } else if (d.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "warning")) {
    kind = p.type === "error" ? "errors" : "warnings";
    text = `${where} console.${p.type}: ${p.args
      .map((a) => a.value ?? a.description ?? "")
      .join(" ")
      .slice(0, 400)}`;
  }
  if (!kind || seenEvents.has(`${p.timestamp}|${text}`)) return;
  seenEvents.add(`${p.timestamp}|${text}`);
  events[kind].push(text);
};

// The page and main sessions. Chromium drops DevTools sockets when the PC
// suspends (seen: the suspend broadcast closes them), so a call on a closed
// socket reconnects once and is sent again; every reconnect is reported.
const S = { page: null, main: null };
const reconnects = [];
async function openSessions() {
  S.page?.close();
  S.main?.close();
  S.page = await connect(await targetUrl(PAGE_PORT, "page"));
  S.main = await connect(await targetUrl(MAIN_PORT, null));
  S.page.handlers.add(watch("page"));
  S.main.handlers.add(watch("main"));
  await S.page.send("Runtime.enable");
  await S.main.send("Runtime.enable");
}
let where = "start";
async function call(which, method, params = {}) {
  let r = await S[which].send(method, params);
  if (r.error?.message === "socket closed") {
    reconnects.push(`${where}: ${which} socket closed, reconnected`);
    log(`${where}: the ${which} DevTools socket was closed; reconnecting`);
    await openSessions();
    r = await S[which].send(method, params);
  }
  if (r.error) throw new Error(`${which} ${method}: ${r.error.message}`);
  return r;
}
async function evIn(which, expression) {
  const r = await call(which, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: which === "main" });
  if (r.result?.exceptionDetails) throw new Error(`${which}: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
}
const ev = (expression) => evIn("page", expression);
const mainEv = (expression) => evIn("main", expression);
await openSessions();

const version = await mainEv(`require("electron").app.getVersion()`);
report.appVersion = version;
log(`app ${version}`);
// Electron's own record of what the power monitor heard.
await mainEv(
  `(() => { const { powerMonitor } = require("electron"); globalThis.__ds5sw = []; for (const e of ["suspend", "resume", "lock-screen", "unlock-screen"]) powerMonitor.on(e, () => globalThis.__ds5sw.push(e)); return 1; })()`,
);

// The simulated board, controller put down (no motion: idle CPU), as the
// budget gate sets it; updates asked so no first-start prompt.
await ev(
  `(async () => { localStorage.setItem("ds5.dev.simulated", "1"); localStorage.setItem("ds5.dev.simRest", "still"); await window.desktop.setSetting("updatesAsked", true); setTimeout(() => location.reload(), 100); return 1; })()`,
);
await sleep(3000);

// In the page: the bridge hook's current client (React state, found by
// walking the fiber tree; the bundle has no globals), the rail status.
const PAGE_HELPERS = `
window.__ds5swClient = () => {
  const root = document.getElementById("root");
  const key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  if (!key) return null;
  const stack = [root[key]], seen = new Set(), found = [];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    for (let h = f.memoizedState, n = 0; h && typeof h === "object" && n < 300; h = h.next, n++) {
      for (const v of [h.memoizedState, h.memoizedState && h.memoizedState.current]) if (v && typeof v === "object" && v.transport && "controllerConnected" in v.transport && !found.includes(v)) found.push(v);
    }
    stack.push(f.child, f.sibling);
  }
  const board = window.__ds5swBoard;
  return found.find((c) => board && c.transport === board.dongle()) ?? found.find((c) => !c.transport.gone) ?? null;
};
window.__ds5swStatus = () => { const s = document.querySelector(".rail-status"); return s ? { ok: s.classList.contains("ok"), title: s.getAttribute("title") } : { ok: false, title: "no rail" }; };
1`;
async function waitConnected(secs) {
  const start = Date.now();
  let st = null;
  // loop: SERIAL-REQUIRED — a deadline: waits for the app to reconnect on its own
  while (Date.now() - start < secs * 1000) {
    st = await ev(PAGE_HELPERS)
      .then(() => ev(`window.__ds5swStatus()`))
      .catch((e) => ({ ok: false, title: String(e).slice(0, 200) }));
    if (st.ok) return { ...st, afterS: (Date.now() - start) / 1000 };
    await sleep(250);
  }
  return { ...st, afterS: null };
}
const first = await waitConnected(40);
if (!first.ok) fail(`the simulated board never connected: ${first.title}`);
log(`simulated board connected: ${first.title}`);

// The simulated board object (protocol/simulatedBoard.ts): devPreview.ts
// keeps the one board in a module-level `simBoard`. The bundle has no
// globals, but any of its functions' [[Scopes]] (DevTools) shows the
// module's variables; the running dongle's BOOTSEL callback is one.
async function findBoard() {
  const fn = await call("page", "Runtime.evaluate", { expression: `window.__ds5swClient().transport.opts.onBootsel` });
  const fnId = fn.result?.result?.objectId;
  if (!fnId) throw new Error("no onBootsel closure on the simulated dongle");
  const props = await call("page", "Runtime.getProperties", { objectId: fnId, ownProperties: false });
  const scopes = props.result.internalProperties?.find((p) => p.name === "[[Scopes]]")?.value?.objectId;
  const list = await call("page", "Runtime.getProperties", { objectId: scopes, ownProperties: true });
  const moduleScope = list.result.result.find((s) => s.value?.description === "Module")?.value?.objectId;
  if (!moduleScope) throw new Error("no module scope on the BOOTSEL callback");
  const vars = await call("page", "Runtime.getProperties", { objectId: moduleScope, ownProperties: true });
  const board = vars.result.result.find((v) => v.name === "simBoard" && v.value?.className === "SimulatedBoard") ?? vars.result.result.find((v) => v.value?.className === "SimulatedBoard");
  if (!board) throw new Error("no SimulatedBoard in the bundle's module scope");
  const r = await call("page", "Runtime.callFunctionOn", {
    objectId: board.value.objectId,
    functionDeclaration: `function () { window.__ds5swBoard = this; return typeof this.set === "function" && typeof this.dongle === "function"; }`,
    returnByValue: true,
  });
  if (!r.result?.result?.value) throw new Error("the SimulatedBoard found has no set()/dongle()");
}
await findBoard();
log("found the simulated board");

// ---- one look at the app: what each wake is compared against ----
async function cpuNow(secs) {
  const mainPid = await mainEv("process.pid");
  const q = winQueryScript(`${EXE_NAME}.exe`, false);
  const sample = async () => appTree(mainPid, parseWinProcs(await ps(q)), (r) => r.cmd);
  const a = await sample();
  const ta = Date.now();
  await sleep(secs * 1000);
  const b = await sample();
  const byType = cpuByType(a, b, (Date.now() - ta) / 1000, 1e7);
  return { byType, total: cpuTotal(byType, [GPU_TYPE, ...MEASUREMENT_TYPES]), gpu: byType[GPU_TYPE] ?? 0, processes: b.length };
}
async function look(label) {
  const r = { label };
  // Responsive: a round trip, a frame, and two page switches on the rail.
  const t = Date.now();
  r.evalMs = await ev("1").then(() => Date.now() - t);
  r.frame = await ev(`new Promise((ok) => { const t = setTimeout(() => ok(false), 3000); requestAnimationFrame(() => { clearTimeout(t); ok(true); }); })`);
  r.pages = await ev(`(async () => {
    const items = [...document.querySelectorAll("[data-rail]")].map((b) => b.dataset.rail);
    const out = {};
    for (const item of [items.find((i) => i !== items[0]), items[0]]) {
      document.querySelector('[data-rail="' + item + '"]').click();
      await new Promise((ok) => setTimeout(ok, 1200));
      out[item] = document.querySelector('[data-rail="' + item + '"]')?.getAttribute("aria-current") === "page";
    }
    return out;
  })()`);
  r.status = await ev(`window.__ds5swStatus()`);
  // The board through the app's own client: identity, config, audio path, a haptics command.
  r.board = await ev(`(async () => {
    const c = window.__ds5swClient();
    if (!c) return { client: false };
    const id = await c.identity();
    const cfg = await c.readConfig();
    const a1 = await c.readAudioCounters();
    await new Promise((ok) => setTimeout(ok, 1000));
    const a2 = await c.readAudioCounters();
    let grip = "ok";
    try { await c.gripTest("both", 1); } catch (e) { grip = String(e && e.message || e); }
    return {
      client: true,
      sameDongle: c.transport === window.__ds5swBoard.dongle(),
      controllerConnected: id.controllerConnected,
      powerFlags: id.powerFlags,
      config: JSON.stringify(cfg),
      core1Stage: a2.core1Stage ?? null,
      core1Flags: a2.core1Flags ?? null,
      usbFramesMoving: a2.usbFrames > a1.usbFrames,
      btOutMoving: a2.btOut > a1.btOut,
      core1LoopsMoving: a2.core1Loops > a1.core1Loops,
      drops: { raw: a2.dropRaw - a1.dropRaw, enc: a2.dropEnc - a1.dropEnc, hap: a2.dropHap - a1.dropHap },
      grip,
    };
  })()`);
  await sleep(10000); // let the page settle after the checks before measuring idle CPU
  r.cpu = await cpuNow(20);
  r.powerEvents = await mainEv("globalThis.__ds5sw.splice(0)");
  r.errors = events.errors.splice(0);
  r.warnings = events.warnings.splice(0);
  return r;
}

// An error's first line, the same at every occurrence.
const errorKind = (e) => e.split("\n")[0].slice(0, 160);
const newErrors = (r, base) => r.errors.filter((e) => r === base || !base.errors.map(errorKind).includes(errorKind(e)));
const verdicts = (r, base, extra) => {
  const b = r.board;
  const v = {
    agent: extra.agent,
    pageAnswers: r.evalMs < 2000 && r.frame,
    pageSwitches: Object.values(r.pages).every(Boolean),
    reconnected: extra.reconnected,
    controllerBack: b.client && b.controllerConnected,
    // The simulated board models core1 only (no PC audio reaches it: USB
    // frames and Bluetooth packets stay 0, reported, not judged).
    audioPath: b.client && b.core1Stage === 9 && (b.core1Flags & 0x07) === 0x01 && b.core1LoopsMoving,
    configKept: b.client && b.config === base.board.config,
    haptics: b.grip === "ok",
    powerEvents: extra.expectEvents ? r.powerEvents.includes("suspend") && r.powerEvents.includes("resume") : true,
    // Errors the baseline already had are reported (r.knownErrors), not judged here.
    noErrors: newErrors(r, base).length === 0,
    cpuIdle: r.cpu.total < CPU_MAX,
  };
  return v;
};

report.baseline = await look("baseline");
report.baseline.verdicts = verdicts(report.baseline, report.baseline, { agent: true, reconnected: true, expectEvents: false });
log(`baseline: ${JSON.stringify(report.baseline.verdicts)} cpu ${report.baseline.cpu.total}%`);
save();

// ---- the cycles ----
for (let n = 1; n <= CYCLES; n++) {
  const c = { cycle: n, steps: [] };
  where = `cycle ${n}`;
  const step = (m) => {
    c.steps.push(`${((Date.now() - t0) / 1000).toFixed(1)} s ${m}`);
    log(`cycle ${n}: ${m}`);
  };
  step(`suspend broadcast: ${(await powerBroadcast("suspend")).replace(/\s+/g, " ")}`);
  // The board while the PC sleeps: the controller goes off (3 s of USB suspend).
  await ev(`(window.__ds5swBoard.dongle().controllerConnected = false, 1)`);
  const before = virsh("domtime", VM);
  virsh("suspend", VM);
  step(`VM frozen (${virsh("domstate", VM)}), asleep ${SLEEP_S} s`);
  await sleep(SLEEP_S * 1000);
  virsh("resume", VM);
  step(`VM resumed (${virsh("domstate", VM)})`);
  // The VM must come back fully: the agent answers. If not, stop and say so (no reset).
  let agent = false;
  // loop: SERIAL-REQUIRED — a deadline: the guest agent after the wake
  for (let i = 0; i < 60 && !(agent = agentAnswers()); i++) await sleep(1000);
  if (!agent) {
    c.agent = false;
    report.results.push(c);
    fail(`cycle ${n}: the guest agent doesn't answer 60 s after the wake (VM state: ${virsh("domstate", VM)}). Not reset; look at it first.`);
  }
  const lagged = virsh("domtime", VM);
  try {
    virsh("domtime", VM, "--now");
  } catch (e) {
    report.notes.push(`cycle ${n}: the guest clock could not be set (${String(e).slice(0, 200)})`);
  }
  step(`agent answers; guest clock ${lagged} → ${virsh("domtime", VM)} (before sleep ${before})`);
  step(`resume broadcast: ${(await powerBroadcast("resume")).replace(/\s+/g, " ")}`);
  // The board after the wake: no controller, so it leaves USB after its resume grace...
  await sleep(2000);
  await ev(`(window.__ds5swBoard.set("away"), 1)`);
  step("board off USB (no controller after the wake)");
  await sleep(8000);
  // ...and the controller comes back (PS): the board is on USB again.
  const awayStatus = await ev(`window.__ds5swStatus()`);
  if (!NO_RETURN) await ev(`(window.__ds5swBoard.set("dongle"), 1)`);
  step(`${NO_RETURN ? "negative control: the board stays off USB" : "controller back, board on USB"} (app showed: ${awayStatus.title})`);
  const re = await waitConnected(NO_RETURN ? 10 : 30);
  step(`reconnected: ${re.ok} after ${re.afterS} s`);
  const r = await look(`cycle ${n}`);
  Object.assign(c, r, { awayStatus, reconnectS: re.afterS });
  c.verdicts = verdicts(r, report.baseline, { agent, reconnected: re.ok, expectEvents: true });
  c.pass = Object.values(c.verdicts).every(Boolean);
  log(`cycle ${n}: ${c.pass ? "PASS" : "FAIL"} ${JSON.stringify(c.verdicts)} cpu ${r.cpu.total}% (gpu ${r.cpu.gpu}%)`);
  report.results.push(c);
  save();
}

// ---- end: stop the test copy (app.quit), tidy the guest, the VM left running ----
if (!KEEP) {
  // require() exists only while DevTools evaluates (the command-line API),
  // so app is taken before the timer, not inside it. Our DevTools sessions
  // close first: one left open held the quit (processes still there 30 s on).
  S.page.close();
  await mainEv(`(() => { const { app } = require("electron"); setTimeout(() => app.quit(), 100); return 1; })()`).catch(() => undefined);
  S.main.close();
  await sleep(4000);
  report.stop = await ps(`
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 30 -and (Get-Process -Name '${EXE_NAME}' -EA 0)) { Start-Sleep -Milliseconds 500 }
$left = @(Get-Process -Name '${EXE_NAME}' -EA 0)
$forced = $left.Count
$left | Stop-Process -Force -EA 0
"gone $([int]$sw.Elapsed.TotalSeconds + 4) s after app.quit()"
Remove-Item -Recurse -Force '${UD}', '${WORK}' -EA 0
netsh interface portproxy delete v4tov4 listenport=${MAIN_PORT} listenaddress=0.0.0.0 | Out-Null
Remove-NetFirewallRule -DisplayName '${FW_RULE}' -EA 0
"processes force-stopped (still there 30 s after app.quit()): $forced; test profile, work folder, inspector proxy and rule removed"`);
  log(report.stop);
} else {
  S.page.close();
  S.main.close();
}
report.reconnects = reconnects;
report.vmAtEnd = { state: virsh("domstate", VM), agent: agentAnswers() };
report.pass = report.results.length === CYCLES && report.results.every((c) => c.pass);
report.finishedAt = new Date().toISOString();
save();
log(`VM at the end: ${report.vmAtEnd.state}, agent ${report.vmAtEnd.agent ? "answers" : "DOES NOT answer"}`);
console.log(`\n${report.pass ? "PASS" : "FAIL"}: ${report.results.filter((c) => c.pass).length}/${CYCLES} cycles (report: ${join(OUT, "report.json")})`);
process.exit(report.pass ? 0 : 1);
