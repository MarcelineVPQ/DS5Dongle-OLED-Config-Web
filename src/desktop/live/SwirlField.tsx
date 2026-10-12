// The Controller page's background when there's no game art (Games off, or
// Windows / macOS for now): slow swirls of warped sine waves in four colors,
// the controller's two, the theme's accent and its complement. Drawn tiny
// (256 x 144) and stretched up by CSS, which blurs it for free; redrawn ~12
// times a second, paused while the window is hidden, still with Reduce motion.
// The colors come from the theme tokens and the colorway, never literals.
import { useEffect, useRef } from "react";

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

// The opposite hue at the same lightness and saturation.
export function complement([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return [max + min - r, max + min - g, max + min - b];
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
      const b = toRgb(colorB, ctx) ?? a;
      const acc = toRgb(accent, ctx) ?? b;
      palette = [a, b, acc, complement(acc)];
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
  return <canvas ref={ref} className="art-bd-layer art-bd-swirl on" aria-hidden="true" />;
}
