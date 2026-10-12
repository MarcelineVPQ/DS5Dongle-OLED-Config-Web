// The Controller page's background when there's no game art (Games off, or
// Windows / macOS for now): slow swirls of warped sine waves in four colors:
// the controller's body color, the theme's accent and the accent's two
// neighbors on the color wheel (analogous colors, never a clashing opposite). Drawn tiny
// (256 x 144) and stretched up by CSS, which blurs it for free; redrawn ~12
// times a second, paused while the window is hidden, still with Reduce motion.
// The colors come from the theme tokens and the colorway, never literals.
import { useEffect, useRef, useState } from "react";

const W = 256;
const H = 144;
const FRAME_MS = 80;

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

export default function SwirlField({ colorA, colorB }: { colorA: string; colorB: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // With hardware acceleration a light CSS blur smooths the stretched field
  // for free (the GPU does it); in software rendering it would cost every
  // frame, so it's left out there.
  const [gpu, setGpu] = useState(false);
  useEffect(() => {
    void window.desktop?.getSettings().then((s) => setGpu(s.hardwareAcceleration));
  }, []);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    c.width = W;
    c.height = H;
    const image = ctx.createImageData(W, H);
    const weights = [0, 0, 0, 0];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-reduce-motion");
    const draw = (t: number) => {
      const px = image.data;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          swirlPixel(x / W, y / H, t, weights);
          const o = (y * W + x) * 4;
          for (let ch = 0; ch < 3; ch++) px[o + ch] = weights[0] * palette[0][ch] + weights[1] * palette[1][ch] + weights[2] * palette[2][ch] + weights[3] * palette[3][ch];
          px[o + 3] = 255;
        }
      ctx.putImageData(image, 0, 0);
    };
    // Re-read whenever the theme changes (it sets its tokens on <html>).
    let palette: Rgb[] = [];
    const readPalette = () => {
      const accent = getComputedStyle(c).getPropertyValue("--dk-accent") || getComputedStyle(c).color;
      const a = toRgb(colorA, ctx) ?? [0, 0, 0];
      const acc = toRgb(accent, ctx) ?? toRgb(colorB, ctx) ?? a;
      // The accent's two neighbors on the color wheel, so every band blends.
      palette = [a, rotateHue(acc, -35), acc, rotateHue(acc, 35)];
    };
    readPalette();
    const themeWatch = new MutationObserver(() => {
      readPalette();
      if (still) draw(0);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-glass"] });
    const start = performance.now();
    draw(0);
    const timer = still
      ? undefined
      : setInterval(() => {
          if (!document.hidden) draw((performance.now() - start) / 1000);
        }, FRAME_MS);
    return () => {
      clearInterval(timer);
      themeWatch.disconnect();
    };
  }, [colorA, colorB]);
  return <canvas ref={ref} className={`art-bd-layer art-bd-swirl on${gpu ? " gpu" : ""}`} aria-hidden="true" />;
}
