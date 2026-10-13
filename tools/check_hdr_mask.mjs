// HDR lighting's mask (src/desktop/live/HdrGlow.tsx) against the drawing it
// glows over, on a running checker copy over the Chrome DevTools protocol:
// switches the model DualSense -> Edge -> DualSense -> Edge and after each
// switch checks that a new mask was built from that model's own drawing and
// that its lit pixels line up with the drawing's light strips (`.led`) and
// lit player lights (`.pled rect.on`), canvas placement included.
//
// HDR can't render on the checker's virtual display, so WebGPU and the HDR
// media query are stubbed in the page: the app's own mask code runs
// unchanged, the stub only keeps the mask it uploads.
//
//   node tools/check_hdr_mask.mjs [--port 9334]   (on a checker copy left
//                                    running: DS5_CHECK_KEEP=1 tools/check_ui.sh)
//
// Run by tools/check_ui.sh after the layout check. Turns HDR lighting on in
// that copy's own settings for the run (never point it at your own copy).
/* global WebSocket -- Node 22's built-in client */
import { setTimeout as sleep } from "node:timers/promises";

const argPort = process.argv.indexOf("--port");
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.DS5_CHECK_PORT || 9334);

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  waiting.get(m.id)?.(m);
  waiting.delete(m.id);
});
const call = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    waiting.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const m = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value;
}

// The stub: an HDR display and a WebGPU that keeps each uploaded mask's lit
// boxes (R = strips, B = player lights, as fractions of the canvas).
const STUB = `(() => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q.includes("dynamic-range: high") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
  window.__hdrMasks = [];
  const box = (data, w, h, ch) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + ch] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  };
  const nop = () => undefined;
  const device = {
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => ({}),
    createSampler: () => ({}),
    createTexture: () => ({ destroy: nop, createView: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline: nop, setBindGroup: nop, draw: nop, end: nop }), finish: () => ({}) }),
    queue: {
      writeBuffer: nop,
      submit: nop,
      writeTexture(_dst, data, _layout, [w, h]) {
        // in the canvas's own units (0..1): placed on the page when checked
        const unit = (b) => b && [b[0] / w, b[1] / h, b[2] / w, b[3] / h];
        window.__hdrMasks.push({ model: document.querySelector(".live-ctl svg")?.dataset.model ?? "dualsense", bar: unit(box(data, w, h, 0)), player: unit(box(data, w, h, 2)) });
      },
    },
    destroy: nop,
  };
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ requestDevice: async () => device }), getPreferredCanvasFormat: () => "rgba16float" } });
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    return kind === "webgpu" ? { configure: nop, unconfigure: nop, getCurrentTexture: () => ({ createView: () => ({}) }) } : gc.call(this, kind, ...rest);
  };
})()`;

await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await evaluate(
  `(async () => { await window.desktop.setSetting("hdrLighting", true); await window.desktop.setSetting("hardwareAcceleration", true); localStorage.setItem("ds5.dev.model", "dualsense"); location.reload(); })()`,
);
await sleep(1500);
for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector(".live-ctl svg") && !!document.querySelector(".hdr-glow")`).catch(() => false)); i++) await sleep(200);

// The drawing's own boxes (union of the elements' client rects).
const DRAWN = `(() => {
  const u = (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).reduce((a, r) => (a ? [Math.min(a[0], r.left), Math.min(a[1], r.top), Math.max(a[2], r.right), Math.max(a[3], r.bottom)] : [r.left, r.top, r.right, r.bottom]), null);
  const svg = document.querySelector(".live-ctl svg");
  const c = document.querySelector(".hdr-glow").getBoundingClientRect();
  return { canvas: [c.left, c.top, c.width, c.height], model: svg?.dataset.model ?? "dualsense", bar: u([...svg.querySelectorAll(".led")]), player: u([...svg.querySelectorAll(".pled rect.on")]) };
})()`;

// Lit pixels within the shapes' box (a clip-path can only trim them), and
// covering most of it (a mask from the other drawing doesn't).
const boxArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function lines(mask, shape, name) {
  if (!mask || !shape) return [`${name}: ${!mask ? "nothing lit in the mask" : "no shapes in the drawing"}`];
  const out = mask[0] < shape[0] - 2 || mask[1] < shape[1] - 2 || mask[2] > shape[2] + 2 || mask[3] > shape[3] + 2;
  const inter = [Math.max(mask[0], shape[0]), Math.max(mask[1], shape[1]), Math.min(mask[2], shape[2]), Math.min(mask[3], shape[3])];
  const cover = boxArea(inter) / boxArea(shape);
  return out || cover < 0.6 ? [`${name}: mask ${mask.map(Math.round)} vs drawing ${shape.map(Math.round)} (covers ${(cover * 100).toFixed(0)}%)`] : [];
}

let problems = 0;
for (const model of ["dualsense", "edge", "dualsense", "edge", "dualsense"]) {
  const before = await evaluate(`window.__hdrMasks.length`);
  await evaluate(`(() => { localStorage.setItem("ds5.dev.model", "${model}"); window.dispatchEvent(new CustomEvent("ds5:pref", { detail: { key: "ds5.dev.model", value: "${model}" } })); })()`);
  let mask = null;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const masks = await evaluate(`window.__hdrMasks`);
    const last = masks[masks.length - 1];
    if (last?.model === model && (masks.length > before || model === "dualsense")) {
      mask = last;
      break;
    }
  }
  const drawn = await evaluate(DRAWN);
  // The mask where the canvas is now (it moves with the drawing's hero).
  const [cx, cy, cw, ch] = drawn.canvas;
  const place = (b) => b && [cx + b[0] * cw, cy + b[1] * ch, cx + b[2] * cw, cy + b[3] * ch];
  if (mask) mask = { ...mask, bar: place(mask.bar), player: place(mask.player) };
  const errs = !mask
    ? [`no mask built for the ${model} drawing`]
    : drawn.model !== model
      ? [`the drawing is ${drawn.model}`]
      : [...lines(mask.bar, drawn.bar, "light strips"), ...lines(mask.player, drawn.player, "player lights")];
  problems += errs.length;
  console.log(`${model.padEnd(9)} ${errs.length ? "PROBLEM " + errs.join("; ") : `ok (strips ${mask.bar.map(Math.round)}, player ${mask.player?.map(Math.round)})`}`);
}
// Back as the checker copy had it (HDR off: the main process would start the
// next run in scRGB), the stub gone with a reload.
await evaluate(`(async () => { localStorage.removeItem("ds5.dev.model"); await window.desktop.setSetting("hdrLighting", false); })()`);
await call("Page.reload");
ws.close();
console.log(problems ? `${problems} problem(s)` : "No problems found");
process.exit(problems ? 1 : 0);
