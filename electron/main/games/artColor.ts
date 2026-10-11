// A game's signature color from its artwork, for its page's accent (main
// process: the page never reads image pixels). The image is shrunk to 24 px
// wide; vivid, bright pixels vote into 12 hue buckets, and the winning
// bucket's average color is the answer. Grey or dark art gives none.
import { nativeImage } from "electron";

export function dominantColor(file: string): string | null {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const small = img.resize({ width: 24, quality: "good" });
  const { width, height } = small.getSize();
  const px = small.toBitmap(); // BGRA
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < width * height; i++) {
    const b = px[i * 4];
    const g = px[i * 4 + 1];
    const r = px[i * 4 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    if (v < 0.25 || s < 0.25) continue;
    let h = 0;
    if (max !== min) {
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
    }
    const k = buckets[Math.floor((h / 6) * 12) % 12];
    const w = s * v;
    k.w += w;
    k.r += r * w;
    k.g += g * w;
    k.b += b * w;
  }
  const best = buckets.reduce((a, c) => (c.w > a.w ? c : a));
  if (best.w < width * height * 0.04) return null; // too little color to call it
  const hex = (n: number) =>
    Math.round(n / best.w)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
