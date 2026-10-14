// HDR lighting (App settings -> Advanced, experimental): the lightbar's
// glow drawn brighter than paper white on an HDR display, like the real LEDs.
// A WebGPU canvas over the drawing, rgba16float in extended tone mapping
// (values above 1.0 are HDR; the only path that reaches KWin here, with the
// main process's scRGB color profile). The strip shapes are rasterized once
// per size into a mask (sharp core + soft halo); a tiny shader paints the
// live LED color through it at the peak set in App settings (in nits; the
// canvas is extended sRGB, 1.0 = SDR white: hdrColor.ts). Everything else on
// the page stays standard range.
import { useEffect, useRef, type RefObject } from "react";
import { parseColor } from "../theme/desktopPalette";
import { hdrBoost, ledLinear } from "./hdrColor";
import { logged } from "../../errorText";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Gpu = { requestAdapter(): Promise<{ requestDevice(): Promise<any> } | null>; getPreferredCanvasFormat(): string };
/* eslint-enable @typescript-eslint/no-explicit-any */

const SHADER = `
struct U { color: vec4f, boost: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var mask: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: V;
  o.pos = vec4f(p[i], 0, 1);
  o.uv = vec2f((p[i].x + 1) * 0.5, 1 - (p[i].y + 1) * 0.5);
  return o;
}
// Linear light to the canvas's extended sRGB (mirrored below 0: colors
// outside sRGB's gamut have negative channels).
fn enc(x: vec3f) -> vec3f {
  let a = abs(x);
  return sign(x) * select(a * 12.92, 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a > vec3f(0.0031308));
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  let m = textureSample(mask, samp, v.uv);
  let core = m.r;   // the strip itself
  let halo = m.g;   // the soft glow around it
  let pcore = m.b;  // the lit player lights (white LEDs)
  let phalo = m.a;
  let a = max(max(core, halo * 0.55) * u.color.a, max(pcore, phalo * 0.55));
  if (a <= 0.0) { return vec4f(0.0); }
  // Linear light, premultiplied: the strips at the full boost, their halos a
  // gentler one that never adds to the strip (so it can't push it past the peak).
  let strip = u.color.rgb * max(core * u.boost.x, halo * u.boost.y) * u.color.a;
  let player = vec3f(1.0) * max(pcore * u.boost.x, phalo * u.boost.y);
  // encoded per pixel: un-premultiply, encode, premultiply again
  return vec4f(enc((strip + player) / a) * a, a);
}`;

// One set of shapes (`sel`) white on transparent at the canvas size: its
// sharp and blurred alpha.
async function shapeAlpha(svg: SVGSVGElement, sel: string, w: number, h: number): Promise<[ImageData, ImageData] | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `*{fill:none!important;stroke:none!important;filter:none!important} ${sel}{fill:#fff!important}`; // theme-exempt: a mask, not a color
  clone.prepend(style);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    // error: NOT-WORTH — a part's mask that won't decode: that part gets no HDR glow (the normal glow shows)
    return null;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const sharp = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.filter = `blur(${Math.max(6, Math.round(w / 60))}px)`;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const soft = ctx.getImageData(0, 0, w, h);
  return [sharp, soft];
}

// The mask: R/G = the lightbar strips (sharp/blurred), B/A = the lit player lights.
async function buildMask(svg: SVGSVGElement, w: number, h: number): Promise<ImageData | null> {
  const bar = await shapeAlpha(svg, ".led, .led *", w, h);
  const player = await shapeAlpha(svg, ".pled rect.on", w, h);
  if (!bar || !player) return null;
  const out = new ImageData(w, h);
  // loop: FIX-HOT-PATH — full-size mask, w x h px (~1M), rebuilt every resize frame
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bar[0].data[i + 3];
    out.data[i + 1] = bar[1].data[i + 3];
    out.data[i + 2] = player[0].data[i + 3];
    out.data[i + 3] = player[1].data[i + 3];
  }
  return out;
}

// `hero` holds the drawing (.live-ctl), which the glow sits over. `model` is
// the drawing shown (LiveController's `model`): each model mounts its own
// .live-ctl with its own art, so a switch starts over on the new element and
// the mask comes from that drawing's own shapes (`.led` strips, `.pled` lights).
export default function HdrGlow({ hero, model, nits }: { hero: RefObject<HTMLElement | null>; model: string | null; nits: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const peak = useRef(nits);
  // Asks for one redraw (set once the GPU is ready).
  const redraw = useRef<(() => void) | null>(null);
  // lifetime: OK — acquires nothing (stores the peak, asks for one redraw)
  useEffect(() => {
    peak.current = nits;
    redraw.current?.();
  }, [nits]);
  // lifetime: OK — cleanup: stops frames and observers, destroys the GPU device and texture
  useEffect(() => {
    const el = hero.current?.querySelector<HTMLElement>(".live-ctl") ?? null;
    const cv = canvas.current;
    const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
    if (!el || !cv || !gpu) return;
    let live = true;
    let frame = 0;
    let resizeFrame = 0;
    let ro: ResizeObserver | undefined;
    let styleWatch: MutationObserver | undefined;
    let svgWatch: MutationObserver | undefined;
    // Everything the GPU holds, released on cleanup (also when cleanup ran
    // while the device was still being created).
    let device: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    let ctx: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    let tex: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    const release = () => {
      tex?.destroy();
      ctx?.unconfigure?.();
      device?.destroy();
    };
    (async () => {
      const adapter = await gpu.requestAdapter();
      // lifetime: OK — destroyed in release() (cleanup, or at once if unmounted while starting)
      device = (await adapter?.requestDevice()) ?? null;
      if (!live) return release();
      ctx = cv.getContext("webgpu");
      if (!device || !ctx) return;
      ctx.configure({ device, format: "rgba16float", toneMapping: { mode: "extended" }, alphaMode: "premultiplied" });
      const module = device.createShaderModule({ code: SHADER });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      });
      const uniform = device.createBuffer({ size: 32, usage: 0x40 | 0x8 }); // UNIFORM | COPY_DST
      const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
      let bind: unknown = null;
      let last = "";
      let generation = 0;
      let draw: () => void = () => undefined;
      const schedule = () => {
        // lifetime: OK — cancelled in the effect cleanup; one frame only when something changed
        if (live && !frame) frame = requestAnimationFrame(() => draw());
      };

      // The mask for the drawing's current size and place. Only the newest
      // rebuild lands (resizes can overlap).
      const rebuild = async () => {
        const mine = ++generation;
        const svg = el.querySelector("svg");
        const r = el.getBoundingClientRect();
        if (!svg || r.width < 10) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(r.width * dpr);
        const h = Math.round(r.height * dpr);
        // Placed over the drawing measured from the canvas's own containing
        // block (the drawing's offsetParent can be a different element).
        const host = (cv.offsetParent ?? document.body).getBoundingClientRect();
        Object.assign(cv.style, { left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        const mask = await buildMask(svg as SVGSVGElement, w, h);
        if (!mask || !live || mine !== generation) return;
        if (cv.width !== w) cv.width = w; // resizing clears the canvas: redrawn below
        if (cv.height !== h) cv.height = h;
        const next = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: 0x4 | 0x2 }); // TEXTURE_BINDING | COPY_DST
        device.queue.writeTexture({ texture: next }, mask.data, { bytesPerRow: w * 4 }, [w, h]);
        tex?.destroy();
        tex = next;
        bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: tex.createView() },
          ],
        });
        last = ""; // draw again with the new mask
        schedule();
      };
      await rebuild();
      if (!live) return release();
      // lifetime: OK — disconnected in the effect cleanup
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        // lifetime: OK — cancelled by the next resize and in the effect cleanup
        resizeFrame = requestAnimationFrame(() => void rebuild().catch(logged("rebuilding the HDR glow mask after a resize")));
      });
      ro.observe(el);
      if (el.parentElement) ro.observe(el.parentElement);
      // The hero's padding (room for the model title, sized from the
      // drawing) moves the drawing down without resizing it: its border box.
      if (hero.current) ro.observe(hero.current, { box: "border-box" });

      // Follow the live lightbar color (set on the drawing's <svg> as
      // --ctl-led / --ctl-led-pct, LiveController): redrawn only when it (or
      // the peak, or the mask) changes, at most once a frame; nothing runs
      // while it stays the same.
      draw = () => {
        frame = 0;
        if (!live || !bind) return;
        const svg = el.querySelector("svg");
        const color = svg?.style.getPropertyValue("--ctl-led") ?? "";
        const pct = parseFloat(svg?.style.getPropertyValue("--ctl-led-pct") || "0") / 100;
        const key = `${color}|${pct}|${peak.current}`;
        if (key === last) return;
        last = key;
        const rgb = parseColor(color);
        const on = rgb && pct > 0 ? pct : 0;
        const { core, halo } = hdrBoost(peak.current); // the strip at the display's peak, its glow gentler
        device.queue.writeBuffer(uniform, 0, new Float32Array([...(rgb ? ledLinear(rgb) : [0, 0, 0]), on, core, halo, 0, 0]));
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
      };
      // The <svg>'s style (the live color), and the player lights the PC set
      // (their "on" class): a new mask for those. The <svg> itself never
      // changes here: another model mounts a new .live-ctl (see `model`).
      // lifetime: OK — disconnected in the effect cleanup
      styleWatch = new MutationObserver(schedule);
      const svg = el.querySelector("svg");
      if (svg) styleWatch.observe(svg, { attributes: true, attributeFilter: ["style"] });
      // class changes elsewhere (button presses) don't touch the mask
      // lifetime: OK — disconnected in the effect cleanup
      svgWatch = new MutationObserver((records) => {
        if (records.some((m) => (m.target as Element).hasAttribute?.("data-led"))) rebuild().catch(logged("rebuilding the HDR glow mask after an LED change"));
      });
      svgWatch.observe(el, { subtree: true, attributes: true, attributeFilter: ["class"] });
      redraw.current = schedule;
      draw();
    })().catch(logged("starting the HDR glow (WebGPU): the normal glow stays"));
    return () => {
      live = false;
      redraw.current = null;
      styleWatch?.disconnect();
      svgWatch?.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      ro?.disconnect();
      release();
    };
  }, [hero, model]);
  return <canvas ref={canvas} className="hdr-glow" aria-hidden="true" />;
}
