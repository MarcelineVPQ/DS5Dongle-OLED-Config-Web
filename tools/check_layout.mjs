// Layout check across every language: drives the running desktop app over
// the Chrome DevTools protocol and reports text that's cut off or spills out
// of its box, on every screen and panel, at a normal and at the smallest
// supported window size.
//
//   npm run build:desktop && ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9333
//   node tools/check_layout.mjs [--port 9333] [--langs en,de] [--sizes 1100x900,900x650]
//
// Needs a dongle connected (most panels only exist then). Exits 1 if anything
// is clipped. A label shortened with "…" counts only if it has no tooltip.
/* global WebSocket -- Node 22's built-in client */
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(opt("port", "9333"));
const LANGS = opt("langs", "en,de,fr,es,pt-BR,zh-CN,ja").split(",");
const SIZES = opt("sizes", "1100x900,900x650")
  .split(",")
  .map((s) => s.split("x").map(Number));

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

// In the page: find clipped or spilling text in what's visible now.
const PROBE = `(() => {
  const BOXES = ".dk-card, .live-tile, .live-data-card, .tour-card, .dk-notice, .dk-btn, .dk-seg button, .dk-row, .live-panel, .narrator-caption";
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
    // Spills past the box it sits in.
    const box = el.parentElement?.closest(BOXES);
    if (box) {
      const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.right > b.right + 1 || r.left < b.left - 1) out.push({ kind: "spills out of " + box.className.split(" ")[0], text: label(el) });
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: "page scrolls sideways", text: "" });
  return out;
})()`;

const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!el; })()`);
const clickText = (text) =>
  evaluate(`(() => { const b = [...document.querySelectorAll("button, summary")].find((x) => (x.title || x.innerText).trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);

// Every view worth checking, opened the way a user would.
const PARTS = ["lightbar", "l2", "cross", "stick-l", "speaker", "body", "mute", "ps", "touchpad"];
async function views(t) {
  const list = [];
  list.push(["main", async () => {}]);
  for (const part of PARTS) list.push([`part:${part}`, () => click(`.live-ctl [data-part="${part}"]`)]);
  list.push(["dongle", () => clickText(t.dongle)]);
  list.push([
    "dongle advanced",
    async () => {
      await clickText(t.dongle);
      await sleep(400);
      await evaluate(`document.querySelector(".live-panel details:not([open]) summary")?.click()`);
    },
  ]);
  list.push(["app settings", () => clickText(t.appSettings)]);
  list.push(["about", () => clickText(t.about)]);
  list.push(["games", () => clickText(t.games)]);
  return list;
}

let problems = 0;
// The user's own language choice, put back at the end.
const original = await evaluate(`localStorage.getItem("i18nextLng")`);
for (const lang of LANGS) {
  await evaluate(`(() => { localStorage.setItem("i18nextLng", ${JSON.stringify(lang)}); location.reload(); })()`);
  await sleep(5000);
  // The top bar's own labels in this language, to click them.
  // The top bar's buttons in this language: Dongle, Games (Linux), About, App settings.
  const t = await evaluate(
    `(() => { const b = [...document.querySelectorAll("header.dk-top button")].map((x) => (x.title || x.innerText).trim()); return { dongle: b[0], games: b[1], about: b[2], appSettings: b[3] }; })()`,
  );
  for (const [w, h] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const [name, open] of await views(t)) {
      await open();
      await sleep(700);
      const found = (await evaluate(PROBE)) ?? [];
      const seen = new Set();
      for (const f of found) {
        const key = f.kind + f.text;
        if (seen.has(key)) continue;
        seen.add(key);
        problems++;
        console.log(`${lang.padEnd(5)} ${w}x${h} ${name.padEnd(16)} ${f.kind}: ${f.text}`);
      }
      // Back to the controller for the next view.
      await evaluate(`document.querySelector("header.dk-top button svg.lucide-arrow-left")?.closest("button")?.click()`);
    }
  }
}
await send("Emulation.clearDeviceMetricsOverride", {});
await evaluate(`(() => { ${original === null ? `localStorage.removeItem("i18nextLng")` : `localStorage.setItem("i18nextLng", ${JSON.stringify(original)})`}; location.reload(); })()`);
ws.close();
console.log(problems ? `\n${problems} layout problem(s).` : "No clipped or spilling text in any language.");
process.exit(problems ? 1 : 0);
