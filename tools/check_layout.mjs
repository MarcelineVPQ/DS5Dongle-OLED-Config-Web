// UI check of the running desktop app over the Chrome DevTools protocol, on
// every view a user can open (opened the way a user would):
//   layout:   text that's cut off or spills out of its box, in every language,
//             at a normal and at the smallest supported window size;
//   contrast: text under WCAG AA (4.5:1, 3:1 for large text) in every theme
//             and style (English, normal size).
// Mechanical, exhaustive (the AVIEW rule): nothing sampled by eye.
//
//   npm run build:desktop && ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9333
//   node tools/check_layout.mjs [--port 9333] [--mode layout|contrast|all] [--langs en,de] [--sizes 1100x900,900x650]
//
// Needs a dongle connected (most panels only exist then). Exits 1 on any
// problem. A label shortened with "…" counts only if it has no tooltip. The
// user's language, theme and style are put back at the end.
/* global WebSocket -- Node 22's built-in client */
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(opt("port", "9333"));
const MODE = opt("mode", "all");
const LANGS = opt("langs", "en,de,fr,es,pt-BR,zh-CN,ja").split(",");
const SIZES = opt("sizes", "1100x900,900x650")
  .split(",")
  .map((s) => s.split("x").map(Number));
const THEMES = ["controller", "light", "dark", "desktop"];
const STYLES = [
  ["standard", null],
  ["glass", "1"],
];

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
  return out;
})()`;

// In the page: text below WCAG AA against the first opaque background behind
// it. Text over art, glass or a translucent card can't be judged from styles
// alone: those are counted (skipped), not guessed.
const CONTRAST_PROBE = `(() => {
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
  for (const tab of [0, 1, 2, 3])
    list.push([
      `about tab ${tab}`,
      async () => {
        await rail("about");
        await sleep(400);
        await evaluate(`document.querySelectorAll('[role="tab"]')[${tab}]?.click()`);
      },
    ]);
  list.push(["games home", () => rail("games")]);
  for (const [name, pick] of [
    ["game page (profile)", `[...document.querySelectorAll(".lib-row")].find((r) => r.innerText.includes("◆"))`],
    ["game page (GOG)", `[...document.querySelectorAll(".lib-row")].find((r) => r.querySelector(".lib-glyph")?.innerText === "G")`],
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
      for (const [name, open] of views()) {
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
      for (const [name, open] of views()) {
        await open();
        await sleep(700);
        const r = (await evaluate(CONTRAST_PROBE)) ?? { out: [], skipped: 0 };
        skippedTotal += r.skipped;
        report(`contrast ${theme.padEnd(10)} ${style.padEnd(8)} ${name.padEnd(28)}`, r.out);
      }
    }
  console.log(`(contrast: ${skippedTotal} text items over art, glass or translucency not judged)`);
}

await setPrefs({ i18nextLng: original.lang, "ds5-bridge-theme": original.theme, "ds5.glass": original.glass });
ws.close();
console.log(problems ? `\n${problems} problem(s).` : "No problems found.");
process.exit(problems ? 1 : 0);
