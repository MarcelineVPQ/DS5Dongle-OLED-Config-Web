// The screenshot look: one fixed set of look settings (theme, style, knobs,
// background, language, window size), so every screenshot in docs/ and the
// announcements matches, whatever the app is set to day to day. The preset is
// docs/screenshots/look.json.
//
//   node tools/screenshot_env.mjs save              record the running app's look as the preset
//   node tools/screenshot_env.mjs apply             switch the app to the preset (your settings are kept aside)
//   node tools/screenshot_env.mjs shot FILE.png     capture the window as it is now (after apply)
//   node tools/screenshot_env.mjs restore           put your own settings back
//   [--port 9333]
//
// "Desktop" theme colors come from this PC's KDE scheme and the colorway from
// the connected controller: apply warns when either differs from the preset.
/* global WebSocket -- Node 22's built-in client */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const cmd = args[0];
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : "9333");
const PRESET = new URL("../docs/screenshots/look.json", import.meta.url);
const BACKUP = join(tmpdir(), "ds5-screenshot-env-backup.json");
// Look settings only (not data like play history or the update notice).
const LOOK_KEYS = /^(ds5-bridge-theme|i18nextLng|ds5\.(accent|glass|knob\..*|artBackdropOff|colorVision|reduceMotion|railPinned|panelHidden|librarySort|dev\.model|dev\.colorway|devTools|tourDone))$/;

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
const readLook = () => evaluate(`Object.fromEntries(Object.keys(localStorage).filter((k) => ${LOOK_KEYS}.test(k)).map((k) => [k, localStorage.getItem(k)]))`);
const writeLook = (prefs) =>
  evaluate(
    `(() => { for (const k of Object.keys(localStorage)) if (${LOOK_KEYS}.test(k)) localStorage.removeItem(k); for (const [k, v] of Object.entries(${JSON.stringify(prefs)})) localStorage.setItem(k, v); location.reload(); })()`,
  );

if (cmd === "save") {
  const prefs = await readLook();
  const viewport = await evaluate(`({ width: innerWidth, height: innerHeight, deviceScaleFactor: Math.round(devicePixelRatio * 100) / 100 })`);
  const expect = await evaluate(
    `({ colorway: [...document.querySelectorAll(".live-spec")].map((e) => e.innerText).find((t) => /COLOR/i.test(t))?.split("\\n").pop() ?? null, desktopPanel: getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim(), desktopAccent: getComputedStyle(document.querySelector(".dk")).getPropertyValue("--dk-accent").trim() })`,
  );
  const old = existsSync(PRESET) ? JSON.parse(readFileSync(PRESET, "utf8")) : {};
  writeFileSync(PRESET, JSON.stringify({ about: old.about ?? "The look every screenshot is taken in.", prefs: { ...prefs, "ds5.devTools": "0" }, viewport, expect }, null, 2) + "\n");
  console.log(`Saved the look to ${PRESET.pathname}`);
} else if (cmd === "apply") {
  const preset = JSON.parse(readFileSync(PRESET, "utf8"));
  if (!existsSync(BACKUP)) writeFileSync(BACKUP, JSON.stringify(await readLook()));
  await writeLook(preset.prefs);
  await sleep(5000);
  await send("Emulation.setDeviceMetricsOverride", { ...preset.viewport, mobile: false });
  await sleep(1500);
  const now = await evaluate(
    `({ colorway: [...document.querySelectorAll(".live-spec")].map((e) => e.innerText).find((t) => /COLOR/i.test(t))?.split("\\n").pop() ?? null, desktopPanel: getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim(), desktopAccent: getComputedStyle(document.querySelector(".dk")).getPropertyValue("--dk-accent").trim() })`,
  );
  for (const [k, v] of Object.entries(preset.expect ?? {})) if (v && now[k] && now[k] !== v) console.warn(`Note: ${k} is ${now[k]}, the preset was taken with ${v}.`);
  console.log("Screenshot look applied. Take the shots, then: node tools/screenshot_env.mjs restore");
} else if (cmd === "shot") {
  const file = args[1];
  if (!file) throw new Error("shot needs a file name");
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`Saved ${file}`);
} else if (cmd === "restore") {
  await send("Emulation.clearDeviceMetricsOverride", {});
  if (existsSync(BACKUP)) {
    await writeLook(JSON.parse(readFileSync(BACKUP, "utf8")));
    rmSync(BACKUP);
  }
  console.log("Your own settings are back.");
} else {
  console.log("Usage: node tools/screenshot_env.mjs save | apply | shot FILE.png | restore");
}
ws.close();
