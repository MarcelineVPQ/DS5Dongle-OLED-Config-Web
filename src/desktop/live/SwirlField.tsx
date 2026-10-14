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
import { useReducedMotion } from "../motion";
import { hsvToRgb, rgbToHsv, type Rgb } from "../theme/desktopPalette";
import { onThemeChange } from "./controllerAccent";
import { logged } from "../../errorText";

// The CPU fallback's size (stretched and blurred by CSS).
export const CPU_W = 128;
export const CPU_H = 72;
// The GPU field: this fraction of the canvas's size on screen, capped.
const GPU_SCALE = 1 / 3;
const GPU_MAX_W = 960;
const FRAME_MS = 80;
// Behind another window: about 4 frames a second.
const UNFOCUSED_MS = 250;

// Any CSS color the browser understands -> RGB (the canvas normalizes it).
function toRgb(css: string, ctx: CanvasRenderingContext2D): Rgb | null {
  ctx.fillStyle = "#000"; // theme-exempt: a reset value for parsing, never drawn
  ctx.fillStyle = css.trim();
  const v = String(ctx.fillStyle);
  if (v.startsWith("#") && v.length === 7) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// The same color with its hue turned by `degrees` (saturation and value, so
// also lightness, kept). Small turns give analogous colors, which sit well
// together; the opposite hue (complementary) clashed (pink with green).
export function rotateHue(rgb: Rgb, degrees: number): Rgb {
  const hsv = rgbToHsv(rgb);
  return hsv.s === 0 ? rgb : hsvToRgb({ ...hsv, h: hsv.h + degrees });
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
  // loop: HOT-PATH-OK — N = 4 colors per pixel; the cost is the pixel loop at 173
  for (let i = 0; i < 4; i++) {
    // Power 4: each band mostly one color, so they don't average into grey.
    const w = (f[i] + 1.2) ** 4;
    out[i] = w;
    sum += w;
  }
  // loop: HOT-PATH-OK — N = 4 colors per pixel; the cost is the pixel loop at 173
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
  if (!gl || gl.isContextLost()) return null;
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
      // loop: FIX-HOT-PATH — CPU fallback: 128 x 72 px in JS every 80 ms (no GPU / GPU lost)
      for (let y = 0; y < CPU_H; y++)
        // loop: FIX-HOT-PATH — CPU fallback pixel loop, inner row
        for (let x = 0; x < CPU_W; x++) {
          swirlPixel(x / CPU_W, y / CPU_H, t, weights);
          const o = (y * CPU_W + x) * 4;
          // loop: FIX-HOT-PATH — CPU fallback, 3 channels per pixel
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

export default function SwirlField({ colors }: { colors: SwirlColors | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // GPU with hardware acceleration on; the CPU fallback without it, or once
  // the GPU context failed or was lost (a new canvas: one can't hold both).
  const [mode, setMode] = useState<Mode | null>(() => (window.desktop ? null : "cpu"));
  useEffect(() => {
    window.desktop
      ?.getSettings()
      .then((s) => setMode((m) => m ?? (s.hardwareAcceleration && gpuWorks() ? "gpu" : "cpu")))
      .catch(logged("reading hardware acceleration for the backdrop (the CPU drawing is used)"))
      .finally(() => setMode((m) => m ?? "cpu"));
  }, []);
  const shown = useWindowShown();
  const focused = useWindowFocused();
  const still = useReducedMotion();
  // The renderer lives as long as the canvas (one per mode); colors, the
  // theme, focus and Reduce motion only change what it's handed or how often
  // it draws, never rebuild it.
  const renderer = useRef<Renderer | null>(null);
  const palette = useRef<Rgb[]>([]);
  const stillRef = useRef(still);
  useEffect(() => {
    stillRef.current = still;
  }, [still]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !mode) return;
    const r = mode === "gpu" ? glRenderer(c) : cpuRenderer(c);
    // A GPU context that failed to start or was already lost before this ran
    // (seen at cold start on Windows' basic display driver) never fires
    // "webglcontextlost" here: fall back to the CPU swirl instead of a frozen
    // canvas.
    if (!r) {
      if (mode === "gpu") queueMicrotask(() => setMode("cpu"));
      return;
    }
    renderer.current = r;
    const onLost = (e: Event) => {
      e.preventDefault();
      setMode("cpu");
    };
    c.addEventListener("webglcontextlost", onLost);
    return () => {
      c.removeEventListener("webglcontextlost", onLost);
      renderer.current = null;
      r.dispose();
    };
  }, [mode]);
  // The palette: read now, and again whenever the theme changes.
  useEffect(() => {
    const c = ref.current;
    if (!c || !mode) return;
    // Colors are parsed on a scratch 2D canvas (the GPU canvas has no 2D context).
    const scratch = document.createElement("canvas").getContext("2d");
    const readPalette = () => {
      if (!scratch) return;
      const body = colors && toRgb(colors.body, scratch);
      if (colors && body) {
        const part = (css: string) => toRgb(css, scratch) ?? body;
        palette.current = [body, part(colors.cap), part(colors.line), mixRgb(body, part(colors.dark), 0.45)];
        return;
      }
      const accent = getComputedStyle(c).getPropertyValue("--dk-accent") || getComputedStyle(c).color;
      const acc = toRgb(accent, scratch) ?? [0, 0, 0];
      // The accent's two neighbors on the color wheel, so every band blends.
      palette.current = [acc, rotateHue(acc, -35), acc, rotateHue(acc, 35)];
    };
    // Still: the one frame shown is redrawn in the new colors (moving, the
    // next frame picks them up).
    const update = () => {
      readPalette();
      if (stillRef.current) renderer.current?.draw(0, palette.current);
    };
    update();
    return onThemeChange(update);
  }, [colors, mode]);
  // The clock: a frame now, then ~12 a second (4 behind another window), none
  // while minimized or in the tray, and just the one with Reduce motion.
  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    // The field's clock carries on where it was across pauses.
    const start = performance.now() - swirlClock.elapsed;
    const now = () => (swirlClock.elapsed = performance.now() - start) / 1000;
    const draw = (t: number) => r.draw(t, palette.current);
    draw(still ? 0 : now());
    const timer = still || !shown ? undefined : setInterval(() => draw(now()), focused ? FRAME_MS : UNFOCUSED_MS);
    return () => clearInterval(timer);
  }, [mode, shown, focused, still]);
  if (!mode) return null;
  return <canvas key={mode} ref={ref} className={`art-bd-layer art-bd-swirl on ${mode}`} aria-hidden="true" />;
}
