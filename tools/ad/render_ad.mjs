// The 30-second app ad, rendered from the real app, frame by frame.
//
// The camera starts tight on the live controller and zooms out at an even
// pace (constant in log scale) until the app fills the frame. It's a
// screenshot clip re-rendered at the zoom's scale (the page itself is never
// transformed: a CSS transform on the whole page renders blank in this
// Electron's software rendering), so the vector art stays sharp throughout; the controller
// blends through the 13 colorways; the app's own interface cycles through the
// 7 languages; white outlined text fades in over it: a tagline, six
// features, an end card. Text comes from the locale files (`ad` section), so
// every language has it (the i18n parity test enforces that).
//
//   ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9333   (dongle + controller connected)
//   tools/ad/master_music.sh track.mp3 music.wav
//   node tools/ad/render_ad.mjs --lang en|de|...|intl --music music.wav --out ad-en.mp4
//
// Every cut opens the same way (one shared audio track, build_audio.sh): the
// tagline follows the language the narrator is speaking.
/* global WebSocket -- Node 22's built-in client */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const LANG = opt("lang", "en");
const MUSIC = opt("music", null);
const OUT = opt("out", `ad-${LANG}.mp4`);
const PORT = Number(opt("port", "9333"));
const FRAMES_ONLY = args.includes("--frames-only");
// The opener's timing from build_audio.sh: which language she speaks when.
const SEGMENTS = JSON.parse(readFileSync(opt("segments", "segments.json"), "utf8"));
const OPEN_END = SEGMENTS[SEGMENTS.length - 1].end + 0.35;
const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = 30;
const ZOOM_END = 26; // the camera settles here; the end card holds to 30 s

const LANGS = ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"];
const locale = (l) => JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${l}.json`, import.meta.url), "utf8"));
const AD = Object.fromEntries(LANGS.map((l) => [l, locale(l).ad]));
const textLang = LANG === "intl" ? "en" : LANG;
if (!AD[textLang]) throw new Error(`no ad text for ${LANG}`);
// The interface cycles every language, starting with the text's.
const uiOrder = [...LANGS.slice(LANGS.indexOf(textLang)), ...LANGS.slice(0, LANGS.indexOf(textLang))];

// Colorways (the art's own palette, as in the marketing renders), Cosmic Red
// first and last.
const DARK = "#171b20";
const COLORWAYS = [
  ["Cosmic Red", "#aa1450", "#a51249", "#ffbfbf"],
  ["White", "#ebeef0", "#e1e3e6", "#707373"],
  ["Midnight Black", "#232529", "#19191b", "#5d5d5d"],
  ["Nova Pink", "#d94e9a", "#cd4e91", "#5e0f3b"],
  ["Galactic Purple", "#493199", "#402787", "#c4b8f2"],
  ["Starlight Blue", "#6dbaf0", "#82bdf2", "#2b5a8a"],
  ["Grey Camouflage", "#7b8086", "#6f747a", "#3b3f44"],
  ["Volcanic Red", "#8f1d24", "#86191f", "#e8a3a7"],
  ["Sterling Silver", "#b9bdc3", "#aeb2b8", "#5c6066"],
  ["Cobalt Blue", "#2443a8", "#1f3b96", "#a9b8ec"],
  ["Chroma Teal", "#2aa39c", "#25958e", "#0f4f4b"],
  ["Chroma Indigo", "#3b3c9c", "#34358d", "#b9baf0"],
  ["Chroma Pearl", "#e9e5ee", "#dfdae6", "#77727f"],
  ["Cosmic Red", "#aa1450", "#a51249", "#ffbfbf"],
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) =>
  `rgb(${hex(a)
    .map((v, i) => Math.round(v + (hex(b)[i] - v) * k))
    .join(",")})`;
const lum = (h) => {
  const c = hex(h).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const lineDark = (line) => (contrast(line, DARK) >= 3 ? line : "#9aa1a9");

// Even pacing everywhere: each colorway gets the same time, blending into the next.
function colorwayAt(t) {
  const seg = DUR / (COLORWAYS.length - 1);
  const i = Math.min(COLORWAYS.length - 2, Math.floor(t / seg));
  const local = (t - i * seg) / seg;
  const k = Math.max(0, Math.min(1, (local - 0.7) / 0.3)); // hold, then blend over the last 30 %
  const [na, ba, ca, la] = COLORWAYS[i];
  const [nb, bb, cb, lb] = COLORWAYS[i + 1];
  return {
    name: k < 0.5 ? na : nb,
    vars: { "--ctl-body": mix(ba, bb, k), "--ctl-cap": mix(ca, cb, k), "--ctl-line": mix(la, lb, k), "--ctl-line-dark": mix(lineDark(la), lineDark(lb), k), "--ctl-dark": DARK },
  };
}

// The overlay's text and opacity at time t.
const FADE = 0.35;
const window01 = (t, a, b) => Math.max(0, Math.min(1, (t - a) / FADE, (b - t) / FADE));
// While she says "There you are." in each language, the tagline is in the
// language she's speaking; then the features, in the cut's language.
function overlayAt(t) {
  const ad = AD[textLang];
  if (t < OPEN_END) {
    const i = Math.max(
      0,
      SEGMENTS.findLastIndex((g) => g.start <= t),
    );
    const g = SEGMENTS[i];
    const until = i + 1 < SEGMENTS.length ? SEGMENTS[i + 1].start : OPEN_END;
    return { kind: "tagline", text: AD[g.lang].tagline, lang: g.lang, o: Math.max(0, Math.min(1, (t - g.start + 0.15) / 0.15, (until - t) / 0.12)) };
  }
  const FEAT0 = OPEN_END + 0.2;
  if (t < ZOOM_END) {
    const span = (ZOOM_END - FEAT0) / ad.features.length;
    const i = Math.min(ad.features.length - 1, Math.floor((t - FEAT0) / span));
    if (i < 0) return { o: 0 };
    const a = FEAT0 + i * span;
    return { kind: "feature", text: ad.features[i], lang: textLang, o: window01(t, a, a + span - 0.25) };
  }
  return { kind: "end", lang: textLang, free: ad.free, credit: ad.credit, o: Math.min(1, (t - ZOOM_END) / 0.8) };
}

// A line may break only between words: each word (Latin, incl. hyphenated
// ones like "haut-parleur") or, in Chinese and Japanese, each phrase up to
// 、 。 ， is kept whole, so nothing splits mid-word ("マイ/ク").
function unbreakable(text, lang) {
  const cjk = lang === "ja" || lang === "zh-CN";
  const parts = cjk ? text.split(/(?<=[、。，,])/u) : text.split(" ");
  // Breaks are allowed between the pieces: a plain space (Latin) or <wbr> (CJK).
  return parts.map((p) => `<span style="white-space:nowrap">${p}</span>`).join(cjk ? "<wbr>" : " ");
}

// ---- CDP ----
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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

const saved = await evaluate(`JSON.stringify({ lang: localStorage.getItem("i18nextLng"), panel: localStorage.getItem("ds5.panelHidden") })`);
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const STYLE = `
  .dk-notice, .narrator-caption, .tour-card, .tour-dim, [class*="tour-spot"] { display: none !important; }
  #ad-overlay { position: fixed; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; z-index: 99999; pointer-events: none; display: grid; }
  #ad-overlay .line { align-self: end; justify-self: center; margin-bottom: 110px; max-width: 1500px; text-align: center;
    color: #fff; font: 700 64px/1.18 "Space Grotesk", "Noto Sans CJK JP", "Noto Sans CJK SC", sans-serif; letter-spacing: -0.01em;
    -webkit-text-stroke: 9px #000; paint-order: stroke fill; text-shadow: 0 4px 24px rgba(0,0,0,0.55); }
  #ad-overlay .line.tagline { font-size: 82px; }
  #ad-overlay .line[lang="zh-CN"] { font-family: "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif; }
  #ad-overlay .line[lang="ja"] { font-family: "Noto Sans CJK JP", "Noto Sans CJK SC", sans-serif; }
  #ad-overlay .end { align-self: center; justify-self: center; text-align: center; color: #fff; padding: 48px 72px; border-radius: 28px;
    background: rgba(10, 12, 16, 0.72); box-shadow: 0 20px 80px rgba(0,0,0,0.6); }
  #ad-overlay .end h1 { margin: 0 0 10px; font: 700 76px/1.05 "Space Grotesk", sans-serif; -webkit-text-stroke: 8px #000; paint-order: stroke fill; }
  #ad-overlay .end .free { font: 600 44px "Space Grotesk", "Noto Sans CJK JP", "Noto Sans CJK SC", sans-serif; color: #f472b6; }
  #ad-overlay .end .url { margin-top: 14px; font: 500 30px "DM Sans", sans-serif; color: #e8e9ec; }
  #ad-overlay .end .credit { margin-top: 26px; font: 500 28px "DM Sans", "Noto Sans CJK JP", "Noto Sans CJK SC", sans-serif; color: #9aa1a9; }
`;

let uiLang = null;
let P = null; // controller center at identity
let ctlH = 0;
async function loadUi(lang) {
  await evaluate(`(() => { localStorage.setItem("i18nextLng", ${JSON.stringify(lang)}); localStorage.setItem("ds5.panelHidden", "0"); location.reload(); })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evaluate(`!!document.querySelector(".live-ctl svg") && !!document.querySelector(".live-panel")`)) break;
  }
  await sleep(1200);
  const m = await evaluate(`(() => {
    const st = document.createElement("style"); st.textContent = ${JSON.stringify(STYLE)}; document.head.appendChild(st);
    const o = document.createElement("div"); o.id = "ad-overlay"; document.body.appendChild(o);
    document.activeElement?.blur?.();
    // The controller's own outline (the svg's box is wider than the drawing).
    const parts = [...document.querySelectorAll(".live-ctl svg [data-part]")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    const x0 = Math.min(...parts.map((b) => b.left)), x1 = Math.max(...parts.map((b) => b.right));
    const y0 = Math.min(...parts.map((b) => b.top)), y1 = Math.max(...parts.map((b) => b.bottom));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, h: y1 - y0, w: x1 - x0 };
  })()`);
  P = m;
  ctlH = Math.max(m.h, (m.w * H) / W);
  uiLang = lang;
}

const tmp = join(tmpdir(), `ds5-ad-${LANG}-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const total = FPS * DUR;
const uiSeg = DUR / uiOrder.length;
let lastOverlay = "";
for (let f = 0; f < total; f++) {
  const t = f / FPS;
  const lang = uiOrder[Math.min(uiOrder.length - 1, Math.floor(t / uiSeg))];
  if (lang !== uiLang) await loadUi(lang);

  // Camera: a clip of the page from the controller filling the frame to the
  // whole window, rendered at W x H.
  const k = Math.min(1, t / ZOOM_END);
  const S0 = (H * 0.9) / ctlH;
  const s = Math.pow(S0, 1 - k);
  const cw = W / s;
  const chh = H / s;
  const cx = P.x + (W / 2 - P.x) * k;
  const cy = P.y + (H / 2 - P.y) * k;
  const clip = { x: Math.max(0, Math.min(W - cw, cx - cw / 2)), y: Math.max(0, Math.min(H - chh, cy - chh / 2)), width: cw, height: chh, scale: s };
  const col = colorwayAt(t);
  const ov = overlayAt(t);
  const html =
    ov.kind === "end"
      ? `<div class="end" style="opacity:${ov.o}"><h1>DS5 Dongle OLED Edition</h1><div class="free">${ov.free}</div><div class="url">marcelinevpq.github.io/DS5Dongle-OLED-Config-Web</div><div class="credit">${ov.credit}</div></div>`
      : ov.text
        ? `<div class="line ${ov.kind}" lang="${ov.lang}" style="opacity:${ov.o.toFixed(3)}">${unbreakable(ov.text, ov.lang)}</div>`
        : "";
  const overlayKey = ov.kind + (ov.text ?? "") + ov.lang;
  await evaluate(`(() => {
    const svg = document.querySelector(".live-ctl svg");
    for (const [k, v] of Object.entries(${JSON.stringify(col.vars)})) svg.style.setProperty(k, v, "important");
    const model = document.querySelector(".live-model");
    if (model) {
      // Every text piece before the status span is the model and colorway.
      const texts = [...model.childNodes].filter((n) => n.nodeType === 3);
      texts.forEach((n, i) => (n.textContent = i === 0 ? "DualSense · ${col.name}" : ""));
    }
    const o = document.getElementById("ad-overlay");
    // The overlay sits on the clip, counter-scaled: it comes out at frame size.
    o.style.left = "${clip.x.toFixed(2)}px"; o.style.top = "${clip.y.toFixed(2)}px"; o.style.transform = "scale(${(1 / s).toFixed(5)})";
    if (${JSON.stringify(overlayKey)} !== o.dataset.key) { o.innerHTML = ${JSON.stringify(html)}; o.dataset.key = ${JSON.stringify(overlayKey)}; fit(o); }
    const el = o.firstElementChild; if (el) el.style.opacity = ${ov.o.toFixed(3)};
    function fit(o) {
      const line = o.querySelector(".line"); if (!line) return;
      let size = parseFloat(getComputedStyle(line).fontSize);
      const lh = size * 1.18;
      while ((line.scrollWidth > 1500 || line.offsetHeight > lh * 2 + 4) && size > 30) { size -= 2; line.style.fontSize = size + "px"; }
    }
  })()`);
  lastOverlay = overlayKey;
  await sleep(f === 0 ? 300 : 30);
  // The live view needs the controller: if it dropped, stop with a reason.
  if (!(await evaluate(`!!document.querySelector(".live-ctl svg")`))) {
    console.error(`${LANG}: the controller disconnected at ${t.toFixed(1)} s (press PS and run this cut again)`);
    process.exit(2);
  }
  const shot = await send("Page.captureScreenshot", { format: "png", clip });
  if (!shot?.data) throw new Error(`screenshot failed at ${t.toFixed(1)} s`);
  const { data } = shot;
  writeFileSync(join(tmp, `${String(f).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
  if (f % 90 === 0) console.log(`${LANG}: ${Math.round(t)} s`);
}
void lastOverlay;

// Put the user's app back as it was.
const was = JSON.parse(saved);
await send("Emulation.clearDeviceMetricsOverride", {});
await evaluate(`(() => {
  ${was.lang === null ? `localStorage.removeItem("i18nextLng")` : `localStorage.setItem("i18nextLng", ${JSON.stringify(was.lang)})`};
  ${was.panel === null ? `localStorage.removeItem("ds5.panelHidden")` : `localStorage.setItem("ds5.panelHidden", ${JSON.stringify(was.panel)})`};
  location.reload();
})()`);
ws.close();

if (FRAMES_ONLY) {
  console.log(`frames in ${tmp}`);
  process.exit(0);
}
// Encode: H.264 1080p30; music faded out at the very end, loudness -14 LUFS.
const ff = ["-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(tmp, "%04d.png")];
// Every frame to exactly W x H (a zoomed clip can round to a pixel less).
const video = `[0:v]scale=${W}:${H}:flags=lanczos,setsar=1[v]`;
// The music comes mastered (tools/ad/master_music.sh: -14 LUFS, limited,
// faded out): a live loudnorm in this chain cut the audio after ~4 s.
if (MUSIC) ff.push("-i", MUSIC, "-filter_complex", video, "-map", "[v]", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest");
else ff.push("-filter_complex", video, "-map", "[v]");
ff.push("-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(DUR), OUT);
execFileSync("ffmpeg", ff, { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${OUT}`);
