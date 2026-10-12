// The Controller page's background when there's no game art (Games off, or
// Windows / macOS for now): slow swirls of warped sine waves in four colors,
// all from the controller (its colorway, or the player's custom colors): the
// shell, the buttons, the outlines and a deeper shade of the shell. No
// controller known: the theme's accent and its two neighbors on the color
// wheel (analogous colors, never a clashing opposite).
//
// With hardware acceleration (App settings) the field is a WebGL2 fragment
// shader (the same math as swirlPixel below), drawn at a third of the
// window's size and stretched up smoothly. Without it, or when the GPU
// context fails or is lost, the CPU fallback draws the field tiny (128 x 72)
// and CSS stretches it, which blurs it for free. Redrawn ~12 times a second
// (4 while the window is behind another one), not at all while the window is
// minimized or in the tray, and once (still) with Reduce motion.
// The colors come from the colorway or the theme tokens, never literals.
import { useEffect, useRef, useState } from "react";
import { useWindowFocused, useWindowShown } from "../useWindowShown";

// The CPU fallback's size (stretched and blurred by CSS).
export const CPU_W = 128;
export const CPU_H = 72;
// The GPU field: this fraction of the canvas's size on screen, capped.
const GPU_SCALE = 1 / 3;
const GPU_MAX_W = 960;
const FRAME_MS = 80;
// Behind another window: about 4 frames a second.
const UNFOCUSED_MS = 250;

type Rgb = [number, number, number];

// Any CSS color the browser understands -> RGB (the canvas normalizes it).
function toRgb(css: string, ctx: CanvasRenderingContext2D): Rgb | null {
  ctx.fillStyle = "#000"; // theme-exempt: a reset value for parsing, never drawn
  ctx.fillStyle = css.trim();
  const v = String(ctx.fillStyle);
  if (v.startsWith("#") && v.length === 7) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// The same color with its hue turned by `degrees` (lightness and saturation
// kept). Small turns give analogous colors, which sit well together; the
// opposite hue (complementary) clashed (pink with green).
export function rotateHue([r, g, b]: Rgb, degrees: number): Rgb {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [r, g, b];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h = (((h * 60 + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// Four wave fields, domain-warped, turned into blend weights (squared, then
// normalized): each pixel mostly one color, with soft swirling borders.
export function swirlPixel(x: number, y: number, t: number, out: number[]): void {
  // Three layers of warping (coarse, medium, fine) for dense, curling bands.
  let u = x + 0.42 * Math.sin(4.6 * y + t * 0.21) + 0.18 * Math.sin(10.2 * x - t * 0.13);
  let v = y + 0.42 * Math.cos(3.8 * x - t * 0.17) + 0.18 * Math.cos(8.6 * y + t * 0.11);
  u += 0.08 * Math.sin(17 * v + t * 0.29);
  v += 0.08 * Math.cos(15 * u - t * 0.23);
  const a = Math.atan2(v - 0.5, u - 0.5);
  const d = Math.hypot(u - 0.5, v - 0.5);
  const f = [Math.sin(6.2 * u + 2.0 * Math.sin(2 * a + t * 0.05)), Math.cos(5.4 * v - 6.0 * d + t * 0.07), Math.sin(8.0 * d - 2 * a + t * 0.04), Math.cos(4.4 * (u + v) + t * 0.09)];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    // Power 4: each band mostly one color, so they don't average into grey.
    const w = (f[i] + 1.2) ** 4;
    out[i] = w;
    sum += w;
  }
  for (let i = 0; i < 4; i++) out[i] /= sum;
}

// A deeper shade: `amount` of the way to the dark parts' color.
const mixRgb = (a: Rgb, b: Rgb, amount: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * amount)) as Rgb;

// The controller's parts: shell, buttons, outlines, dark parts (CSS colors).
export type SwirlColors = { body: string; cap: string; line: string; dark: string };

// swirlPixel in GLSL (keep the two in step): the same warps, fields and
// weights, so both renderers draw the same picture.
export const SWIRL_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float t;
uniform vec3 palette[4];
out vec4 color;
void main() {
  float x = gl_FragCoord.x / size.x;
  float y = 1.0 - gl_FragCoord.y / size.y;
  float u = x + 0.42 * sin(4.6 * y + t * 0.21) + 0.18 * sin(10.2 * x - t * 0.13);
  float v = y + 0.42 * cos(3.8 * x - t * 0.17) + 0.18 * cos(8.6 * y + t * 0.11);
  u += 0.08 * sin(17.0 * v + t * 0.29);
  v += 0.08 * cos(15.0 * u - t * 0.23);
  float a = atan(v - 0.5, u - 0.5);
  float d = length(vec2(u - 0.5, v - 0.5));
  vec4 f = vec4(sin(6.2 * u + 2.0 * sin(2.0 * a + t * 0.05)), cos(5.4 * v - 6.0 * d + t * 0.07), sin(8.0 * d - 2.0 * a + t * 0.04), cos(4.4 * (u + v) + t * 0.09));
  vec4 w = f + 1.2;
  w = w * w;
  w = w * w;
  w /= w.x + w.y + w.z + w.w;
  color = vec4((w.x * palette[0] + w.y * palette[1] + w.z * palette[2] + w.w * palette[3]) / 255.0, 1.0);
}`;
const SWIRL_VERTEX = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

interface Renderer {
  draw(t: number, palette: Rgb[]): void;
  dispose(): void;
}

// The GPU renderer, or null when WebGL2 isn't there (or a shader fails).
function glRenderer(c: HTMLCanvasElement): Renderer | null {
  const gl = c.getContext("webgl2", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = shader(gl.VERTEX_SHADER, SWIRL_VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, SWIRL_FRAGMENT);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  // One triangle covering the canvas.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uSize = gl.getUniformLocation(prog, "size");
  const uT = gl.getUniformLocation(prog, "t");
  const uPalette = gl.getUniformLocation(prog, "palette");
  return {
    draw(t, palette) {
      // A third of the size on screen (the stretch keeps it smooth).
      const r = c.getBoundingClientRect();
      const w = Math.max(16, Math.min(GPU_MAX_W, Math.round(r.width * GPU_SCALE)));
      const h = Math.max(9, Math.round((w * Math.max(1, r.height)) / Math.max(1, r.width)));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uSize, w, h);
      gl.uniform1f(uT, t);
      gl.uniform3fv(uPalette, palette.flat());
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

// The CPU fallback: every pixel of a tiny image in JavaScript.
function cpuRenderer(c: HTMLCanvasElement): Renderer | null {
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  c.width = CPU_W;
  c.height = CPU_H;
  const image = ctx.createImageData(CPU_W, CPU_H);
  const weights = [0, 0, 0, 0];
  return {
    draw(t, palette) {
      const px = image.data;
      for (let y = 0; y < CPU_H; y++)
        for (let x = 0; x < CPU_W; x++) {
          swirlPixel(x / CPU_W, y / CPU_H, t, weights);
          const o = (y * CPU_W + x) * 4;
          for (let ch = 0; ch < 3; ch++) px[o + ch] = weights[0] * palette[0][ch] + weights[1] * palette[1][ch] + weights[2] * palette[2][ch] + weights[3] * palette[3][ch];
          px[o + 3] = 255;
        }
      ctx.putImageData(image, 0, 0);
    },
    dispose() {},
  };
}

type Mode = "gpu" | "cpu";

// Does the shader build here? Tried once on a throwaway canvas.
let gpuOk: boolean | null = null;
function gpuWorks(): boolean {
  if (gpuOk === null) {
    const canvas = document.createElement("canvas");
    const probe = glRenderer(canvas);
    gpuOk = probe !== null;
    probe?.dispose();
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return gpuOk;
}

// Shared across remounts and pauses, so the swirl doesn't jump back to its start.
const swirlClock = { elapsed: 0 };

// Reduce motion (the app setting on <html>, or the system's), followed live:
// turning it off again restarts the swirl without a reload.
const reduceMotionNow = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-reduce-motion");
function useReduceMotionOn(): boolean {
  const [on, setOn] = useState(reduceMotionNow);
  useEffect(() => {
    const update = () => setOn(reduceMotionNow());
    const attr = new MutationObserver(update);
    attr.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", update);
    return () => {
      attr.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return on;
}

export default function SwirlField({ colors }: { colors: SwirlColors | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // GPU with hardware acceleration on; the CPU fallback without it, or once
  // the GPU context failed or was lost (a new canvas: one can't hold both).
  const [mode, setMode] = useState<Mode | null>(() => (window.desktop ? null : "cpu"));
  useEffect(() => {
    void window.desktop?.getSettings().then(
      (s) => setMode((m) => m ?? (s.hardwareAcceleration && gpuWorks() ? "gpu" : "cpu")),
      () => setMode("cpu"),
    );
  }, []);
  const shown = useWindowShown();
  const focused = useWindowFocused();
  const still = useReduceMotionOn();
  useEffect(() => {
    const c = ref.current;
    if (!c || !mode) return;
    const renderer = mode === "gpu" ? glRenderer(c) : cpuRenderer(c);
    if (!renderer) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setMode("cpu");
    };
    c.addEventListener("webglcontextlost", onLost);
    // Colors are parsed on a scratch 2D canvas (the GPU canvas has no 2D context).
    const scratch = document.createElement("canvas").getContext("2d");
    // Re-read whenever the theme changes (it sets its tokens on <html>).
    let palette: Rgb[] = [];
    const readPalette = () => {
      if (!scratch) return;
      const body = colors && toRgb(colors.body, scratch);
      if (colors && body) {
        const part = (css: string) => toRgb(css, scratch) ?? body;
        palette = [body, part(colors.cap), part(colors.line), mixRgb(body, part(colors.dark), 0.45)];
        return;
      }
      const accent = getComputedStyle(c).getPropertyValue("--dk-accent") || getComputedStyle(c).color;
      const acc = toRgb(accent, scratch) ?? [0, 0, 0];
      // The accent's two neighbors on the color wheel, so every band blends.
      palette = [acc, rotateHue(acc, -35), acc, rotateHue(acc, 35)];
    };
    readPalette();
    // The field's clock carries on where it was across pauses.
    const start = performance.now() - swirlClock.elapsed;
    const now = () => (swirlClock.elapsed = performance.now() - start) / 1000;
    const draw = (t: number) => renderer.draw(t, palette);
    const themeWatch = new MutationObserver(() => {
      readPalette();
      if (still) draw(0);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-glass"] });
    draw(still ? 0 : now());
    // Minimized or in the tray: nothing runs at all.
    const timer = still || !shown ? undefined : setInterval(() => draw(now()), focused ? FRAME_MS : UNFOCUSED_MS);
    return () => {
      clearInterval(timer);
      themeWatch.disconnect();
      c.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
    };
  }, [colors, mode, shown, focused, still]);
  if (!mode) return null;
  return <canvas key={mode} ref={ref} className={`art-bd-layer art-bd-swirl on ${mode}`} aria-hidden="true" />;
}
