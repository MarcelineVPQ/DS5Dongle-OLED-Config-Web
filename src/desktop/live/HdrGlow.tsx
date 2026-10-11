// HDR lighting (App settings -> Advanced, experimental): the lightbar's
// glow drawn brighter than paper white on an HDR display, like the real LEDs.
// A WebGPU canvas over the drawing, rgba16float in extended tone mapping
// (values above 1.0 are HDR; the only path that reaches KWin here, with the
// main process's scRGB color profile). The strip shapes are rasterized once
// per size into a mask (sharp core + soft halo); a tiny shader paints the
// live LED color through it at the peak set in App settings (in nits; scRGB
// 1.0 = 80 nits). Everything else on the page stays standard range.
import { useEffect, useRef, type RefObject } from "react";
import { parseColor } from "../theme/desktopPalette";

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
@fragment fn fs(v: V) -> @location(0) vec4f {
  let m = textureSample(mask, samp, v.uv);
  let core = m.r;   // the strip itself
  let halo = m.g;   // the soft glow around it
  let a = max(core, halo * 0.55) * u.color.a;
  // premultiplied: the strip gets the full boost, the halo a gentler one
  return vec4f(u.color.rgb * (core * u.boost.x + halo * u.boost.y) * u.color.a, a);
}`;

// Draw the strip shapes white on transparent at the canvas size: R = sharp, G = blurred.
async function buildMask(svg: SVGSVGElement, w: number, h: number): Promise<ImageData | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = "*{fill:none!important;stroke:none!important;filter:none!important} .led, .led *{fill:#fff!important}"; // theme-exempt: a mask, not a color
  clone.prepend(style);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
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
  const out = new ImageData(w, h);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = sharp.data[i + 3];
    out.data[i + 1] = soft.data[i + 3];
    out.data[i + 3] = 255;
  }
  return out;
}

// sRGB-encoded to linear light (the canvas is linear in extended mode).
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// `hero` holds the drawing (.live-ctl), which the glow sits over.
export default function HdrGlow({ hero, nits }: { hero: RefObject<HTMLElement | null>; nits: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const peak = useRef(nits);
  useEffect(() => {
    peak.current = nits;
  }, [nits]);
  useEffect(() => {
    const el = hero.current?.querySelector<HTMLElement>(".live-ctl") ?? null;
    const cv = canvas.current;
    const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
    if (!el || !cv || !gpu) return;
    let live = true;
    let frame = 0;
    let resizeFrame = 0;
    let ro: ResizeObserver | undefined;
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
    void (async () => {
      const adapter = await gpu.requestAdapter();
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
        Object.assign(cv.style, { left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${r.width}px`, height: `${r.height}px` });
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
      };
      await rebuild();
      if (!live) return release();
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => void rebuild());
      });
      ro.observe(el);
      if (el.parentElement) ro.observe(el.parentElement);

      // Follow the live lightbar color (set on the drawing as --ctl-led / --ctl-led-pct).
      const draw = () => {
        if (!live) return;
        frame = requestAnimationFrame(draw);
        if (!bind) return;
        const color = el.style.getPropertyValue("--ctl-led");
        const pct = parseFloat(el.style.getPropertyValue("--ctl-led-pct") || "0") / 100;
        const key = `${color}|${pct}|${peak.current}`;
        if (key === last) return;
        last = key;
        const rgb = parseColor(color)?.map((c) => c / 255);
        const on = rgb && pct > 0 ? pct : 0;
        const core = peak.current / 80; // the strip at the display's peak
        const halo = Math.min(core * 0.35, 3); // the glow around it, gentler
        device.queue.writeBuffer(uniform, 0, new Float32Array([...(rgb ?? [0, 0, 0]).map(lin), on, core, halo, 0, 0]));
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
      };
      draw();
    })();
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      ro?.disconnect();
      release();
    };
  }, [hero]);
  return <canvas ref={canvas} className="hdr-glow" aria-hidden="true" />;
}
