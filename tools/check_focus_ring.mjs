// Keyboard focus on the controller drawing must be visible on every part, on
// both drawings, in every colorway: on a running checker copy over the Chrome
// DevTools protocol, each part ([data-part] buttons and the shell) is
// screenshotted unfocused and keyboard-focused, and the two compared pixel by
// pixel. A pixel counts as the ring when its focused color is at least 3:1
// (WCAG non-text contrast) against the same pixel unfocused (WCAG 2.4.13's
// "change of contrast"). A part passes when those pixels add up to at least a
// 1 px line around three quarters of its box (a 2 px ring on a round button
// is about 1.5x that). Found 0.9.5-dev.18: most parts of the standard
// DualSense showed no change at all (focus only recolored outlines, to the
// outline's own color on some colorways).
//
//   node tools/check_focus_ring.mjs [--port 9334] [--plan fast|full] [--out DIR]
//     fast: the Controller theme with a white, a black, a red and a
//           two-tone colorway of each model, plus Light and Dark on the
//           white and black DualSense; full: every colorway of both models
//           in the Controller theme, plus Light, Dark and Desktop on those.
//     --out DIR: keeps every pair of screenshots (<model>-<code>-<theme>-<part>-{off,focus}.png).
//
// Run by tools/check_ui.sh after the layout check. Changes the copy's
// background, motion, theme and preview settings for the run and puts them
// back (never point it at your own copy). Exits 1 on any part that fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { connect, evaluators } from "./cdp_lib.mjs";
import { loadColorwayMath } from "./colorway_contrast.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const PORT = Number(opt("port", process.env.DS5_CHECK_PORT || 9334));
const PLAN = opt("plan", "fast");
const OUT = opt("out", null);
if (OUT) mkdirSync(OUT, { recursive: true });

// [model, colorway code, theme]
const FAST = [
  ...["00", "01", "02", "30", "Z6"].map((c) => ["dualsense", c, "controller"]),
  ...["00", "01"].map((c) => ["edge", c, "controller"]),
  ...["light", "dark"].flatMap((t) => ["00", "01"].map((c) => ["dualsense", c, t])),
];
const MARGIN = 8; // px around the part's box: the ring sits outside it
const MIN_SHARE = 0.75; // of the box's perimeter, as a 1 px line

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = await connect(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
const { ev } = evaluators(page, null);

let combos = FAST;
if (PLAN === "full") {
  const { COLORWAYS, EDGE_COLORWAYS } = await loadColorwayMath();
  combos = [
    ...Object.keys(COLORWAYS).map((c) => ["dualsense", c, "controller"]),
    ...Object.keys(EDGE_COLORWAYS).map((c) => ["edge", c, "controller"]),
    ...["light", "dark", "desktop"].flatMap((t) =>
      ["00", "01"].flatMap((c) => [
        ["dualsense", c, t],
        ["edge", c, t],
      ]),
    ),
  ];
}

const KEYS = ["ds5.dev.model", "ds5.dev.colorway", "ds5-bridge-theme", "ds5.background", "ds5.reduceMotion", "ds5.accent"];
const original = await ev(`(${JSON.stringify(KEYS)}).reduce((o, k) => ({ ...o, [k]: localStorage.getItem(k) }), {})`);
const READY = `(() => document.readyState === "complete" && !!document.querySelector(".live-ctl svg [data-part]") && !!document.querySelector("[data-rail]"))()`;
async function reload(prefs) {
  await ev(
    `(() => { ${Object.entries(prefs)
      .map(([k, v]) => (v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`))
      .join(" ")} location.reload(); })()`,
  );
  await sleep(800);
  // loop: SERIAL-REQUIRED — a deadline: polls until the page is back, at most 10 s
  for (let i = 0; i < 50 && !(await ev(READY).catch(() => false)); i++) await sleep(200);
  await ev(`document.querySelector('[data-rail="controller"]')?.click()`);
  await sleep(600);
}
const setLivePref = (key, value) =>
  ev(
    `(() => { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); window.dispatchEvent(new CustomEvent("ds5:pref", { detail: { key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)} } })); })()`,
  );

// The parts: every keyboard stop in the drawing, with its box.
const PARTS = `[...document.querySelectorAll('.live-ctl svg [data-part][tabindex="0"]')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-part"), box: [r.left, r.top, r.width, r.height] }; }).filter((p) => p.box[2] > 0 && p.box[3] > 0)`;
const shot = async ([x, y, w, h]) =>
  (await page.send("Page.captureScreenshot", { format: "png", clip: { x: x - MARGIN, y: y - MARGIN, width: w + 2 * MARGIN, height: h + 2 * MARGIN, scale: 1 } })).result.data;
// In the page: pixels that changed at all, and pixels whose focused color is
// ≥ 3:1 against the unfocused one.
const COMPARE = `async (a, b) => {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = "data:image/png;base64," + src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const data = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const [da, db] = [data(ia), data(ib)];
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  let changed = 0, ring = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) <= 12) continue;
    changed++;
    const [p, q] = [lum(da, i), lum(db, i)].sort((m, n) => n - m);
    if ((p + 0.05) / (q + 0.05) >= 3) ring++;
  }
  return { changed, ring };
}`;

let failures = 0;
let checked = 0;
// Still, no backdrop behind the drawing (the swirls move), nothing focused.
await reload({ "ds5.background": "off", "ds5.reduceMotion": "1", "ds5.accent": null });
let theme = null;
// loop: SERIAL-REQUIRED — one page: each combination reloads or switches the preview it screenshots
for (const [model, code, t] of combos) {
  if (t !== theme) {
    await reload({ "ds5-bridge-theme": t });
    theme = t;
  }
  await setLivePref("ds5.dev.model", model);
  await setLivePref("ds5.dev.colorway", code);
  await sleep(500);
  const parts = await ev(PARTS);
  const worst = [];
  // loop: SERIAL-REQUIRED — one page: focus moves part by part
  for (const p of parts) {
    const sel = `.live-ctl svg [data-part="${p.id}"]`;
    // Unfocused and not hovered or selected (a selection's thinner ring would be the baseline).
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await ev(`(() => { document.activeElement?.blur(); document.querySelector(${JSON.stringify(sel)})?.classList.remove("sel"); })()`);
    await sleep(120);
    const off = await shot(p.box);
    await ev(`document.querySelector(${JSON.stringify(sel)}).focus({ focusVisible: true })`);
    await sleep(120);
    const on = await shot(p.box);
    const { changed, ring } = await ev(`(${COMPARE})(${JSON.stringify(off)}, ${JSON.stringify(on)})`);
    const need = Math.round(MIN_SHARE * 2 * (p.box[2] + p.box[3]));
    checked++;
    if (OUT) {
      const name = `${model}-${code}-${t}-${p.id}`;
      writeFileSync(join(OUT, `${name}-off.png`), Buffer.from(off, "base64"));
      writeFileSync(join(OUT, `${name}-focus.png`), Buffer.from(on, "base64"));
    }
    worst.push({ id: p.id, share: ring / need });
    if (ring < need) {
      failures++;
      console.log(`FAIL ${model.padEnd(9)} ${code} ${t.padEnd(10)} ${p.id.padEnd(10)} focus ring ${ring} px at 3:1 (${changed} changed), needs ${need}`);
    }
  }
  await ev(`document.activeElement?.blur()`);
  worst.sort((a, b) => a.share - b.share);
  console.log(
    `${model.padEnd(9)} ${code} ${t.padEnd(10)} ${parts.length} parts; weakest: ${worst
      .slice(0, 3)
      .map((w) => `${w.id} ${w.share.toFixed(2)}x`)
      .join(", ")}`,
  );
}
await reload(original);
page.close();
console.log(failures ? `\nfocus ring: ${failures} of ${checked} parts not visible enough.` : `\nfocus ring: all ${checked} parts visible (≥ 3:1 change, ≥ ${MIN_SHARE} of the box's perimeter).`);
process.exit(failures ? 1 : 0);
