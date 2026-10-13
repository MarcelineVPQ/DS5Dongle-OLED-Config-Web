// Draws the tray icon: the DualSense silhouette (Zacksly "PS5 Button Icons and
// Controls", CC BY 3.0) with its touchpad lit in the controller's actual
// lightbar color, a charging bolt, and a status dot in the top-right corner.
// Like other tray icons, the silhouette is dark on a light taskbar and light on
// a dark one (the taskbar's colors, not the app's theme).
// Drawn in the renderer (it has a canvas) and handed to the main process as a
// PNG data URL.
import controllerUrl from "./controller-solid.png";
import { PALETTES } from "../colorVision";

export type TrayDot = "ok" | "away" | "none";

export interface TrayIconSpec {
  dot: TrayDot;
  darkTaskbar: boolean;
  lightbar: [number, number, number] | null;
  charging: boolean;
}

// The standard status colors (the taskbar isn't themed, so no color-vision swap).
const STATUS = PALETTES.standard;
const DOT_COLORS: Record<TrayDot, string> = { ok: STATUS.good, away: STATUS.warn, none: STATUS.muted };
const INK = { onDark: "#eef0f2", onLight: "#1f2328" }; // theme-exempt: the taskbar's ink, not the app's theme
// Touchpad box in fractions of the art (measured on the 4k source).
const TOUCHPAD = { x0: 0.3, y0: 0.035, x1: 0.7, y1: 0.3 };
// Lightning bolt outline in a unit box.
const BOLT: ReadonlyArray<[number, number]> = [
  [0.58, 0],
  [0.08, 0.56],
  [0.42, 0.56],
  [0.3, 1],
  [0.92, 0.38],
  [0.56, 0.38],
  [0.74, 0],
];

let artPromise: Promise<ImageBitmap> | null = null;
function art(): Promise<ImageBitmap> {
  // An <img> rather than fetch(): the packaged app loads from file://, which
  // fetch() doesn't support.
  artPromise ??= (async () => {
    const img = new Image();
    img.src = controllerUrl;
    await img.decode();
    return createImageBitmap(img);
  })();
  return artPromise;
}

// Size in device pixels; the main process registers it as the @2x image.
export async function renderTrayIcon(spec: TrayIconSpec, size = 44): Promise<string> {
  const img = await art();
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  // Controller sits low and slightly left, leaving the top-right for the dot.
  const cw = size * 0.94;
  const ch = (img.height * cw) / img.width;
  const oy = size - ch - size / 24;
  // The silhouette in the taskbar's contrasting ink.
  const ink = new OffscreenCanvas(size, size);
  const ictx = ink.getContext("2d")!;
  ictx.imageSmoothingQuality = "high";
  ictx.drawImage(img, 0, oy, cw, ch);
  ictx.globalCompositeOperation = "source-in";
  ictx.fillStyle = spec.darkTaskbar ? INK.onDark : INK.onLight;
  ictx.fillRect(0, 0, size, size);
  ctx.drawImage(ink, 0, 0);

  if (spec.lightbar) {
    const [r, g, b] = spec.lightbar;
    const x0 = TOUCHPAD.x0 * cw + cw * 0.012;
    const x1 = TOUCHPAD.x1 * cw - cw * 0.012;
    const y0 = oy + TOUCHPAD.y0 * ch;
    const y1 = oy + TOUCHPAD.y1 * ch;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`; // theme-exempt: the controller's real lightbar color
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, size * 0.03);
    ctx.fill();
  }

  if (spec.charging) {
    const bh = size * 0.6;
    const bw = bh * 0.7;
    const bx = cw * 0.5 - bw / 2;
    const by = oy + ch * 0.12;
    ctx.beginPath();
    BOLT.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(bx + px * bw, by + py * bh) : ctx.lineTo(bx + px * bw, by + py * bh)));
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, size / 26);
    ctx.strokeStyle = "#0f172a"; // theme-exempt: tray icon bolt outline (taskbar, not themed)
    ctx.stroke();
    ctx.fillStyle = "#facc15"; // theme-exempt: tray icon charging bolt (taskbar, not themed)
    ctx.fill();
  }

  const r = size * 0.145;
  const ring = size / 18;
  const cx = size - r - ring;
  const cy = r + ring;
  ctx.fillStyle = "#0f172a"; // theme-exempt: tray icon status-dot ring (taskbar, not themed)
  ctx.beginPath();
  ctx.arc(cx, cy, r + ring, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DOT_COLORS[spec.dot];
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
