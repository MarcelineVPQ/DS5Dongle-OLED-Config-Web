// Draws the tray icon: the DualSense silhouette (Zacksly "PS5 Button Icons and
// Controls", CC BY 3.0) with its touchpad lit in the controller's actual
// lightbar color, a charging bolt, and a status dot in the top-right corner.
// Like other tray icons, the silhouette is dark on a light taskbar and light on
// a dark one (the taskbar's colors, not the app's theme).
// Drawn in the renderer (it has a canvas) and handed to the main process as a
// PNG data URL.
// macOS (`template`): a template image instead, black with alpha only, which
// macOS tints for a light or dark menu bar (no colors allowed). The state is
// in shapes: connected = a filled dot, no controller = a hollow ring, no board
// = no dot and a faded silhouette; charging = the bolt cut out of the body;
// the touchpad is cut out (no lightbar color).
import controllerUrl from "./controller-solid.png";
import { PALETTES } from "../colorVision";

export type TrayDot = "ok" | "away" | "none";

export interface TrayIconSpec {
  dot: TrayDot;
  darkTaskbar: boolean;
  lightbar: [number, number, number] | null;
  charging: boolean;
  template?: boolean; // macOS menu bar
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

// cache: OK — key=none (the decoded tray art); invalidated=never once decoded, a failed decode is dropped (the next redraw tries again); bound=1 bitmap
let artPromise: Promise<ImageBitmap> | null = null;
export function trayArt(): Promise<ImageBitmap> {
  // An <img> rather than fetch(): the packaged app loads from file://, which
  // fetch() doesn't support.
  if (artPromise) return artPromise;
  const decoding = (async () => {
    const img = new Image();
    img.src = controllerUrl;
    await img.decode();
    return createImageBitmap(img);
  })();
  artPromise = decoding;
  // error: PASSES-ON — the rejection is returned below to renderTrayIcon's caller (DesktopApp logs it); this only forgets the failed decode
  decoding.catch(() => {
    if (artPromise === decoding) artPromise = null;
  });
  return decoding;
}

// Size in device pixels; the main process registers it as the @2x image.
// Both canvases are software ones (willReadFrequently): a 44 px icon encoded
// to PNG costs next to nothing on the CPU, while a GPU canvas made the GPU
// process do a context and a read-back for every redraw.
export async function renderTrayIcon(spec: TrayIconSpec, size = 44): Promise<string> {
  const img = await trayArt();
  if (spec.template) return renderTemplate(img, spec, size);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";

  const { cw, ch, oy } = placeArt(img, size);
  // The silhouette in the taskbar's contrasting ink.
  const ink = new OffscreenCanvas(size, size);
  const ictx = ink.getContext("2d", { willReadFrequently: true })!;
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
    boltPath(ctx, size, cw, ch, oy);
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, size / 26);
    ctx.strokeStyle = "#0f172a"; // theme-exempt: tray icon bolt outline (taskbar, not themed)
    ctx.stroke();
    ctx.fillStyle = "#facc15"; // theme-exempt: tray icon charging bolt (taskbar, not themed)
    ctx.fill();
  }

  const { r, ring, cx, cy } = dotPlace(size);
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

// The silhouette's place: low and slightly left, leaving the top right for the dot.
function placeArt(img: ImageBitmap, size: number) {
  const cw = size * 0.94;
  const ch = (img.height * cw) / img.width;
  return { cw, ch, oy: size - ch - size / 24 };
}

// The status dot in the top-right corner, with its ring.
function dotPlace(size: number) {
  const r = size * 0.145;
  const ring = size / 18;
  return { r, ring, cx: size - r - ring, cy: r + ring };
}

function boltPath(ctx: OffscreenCanvasRenderingContext2D, size: number, cw: number, ch: number, oy: number) {
  const bh = size * 0.6;
  const bw = bh * 0.7;
  const bx = cw * 0.5 - bw / 2;
  const by = oy + ch * 0.12;
  ctx.beginPath();
  // loop: NOT-WORTH — 7 points, only when the tray icon's inputs change
  BOLT.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(bx + px * bw, by + py * bh) : ctx.lineTo(bx + px * bw, by + py * bh)));
  ctx.closePath();
}

// macOS: black with alpha only (see the top of this file).
async function renderTemplate(img: ImageBitmap, spec: TrayIconSpec, size: number): Promise<string> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  const { cw, ch, oy } = placeArt(img, size);
  ctx.globalAlpha = spec.dot === "none" ? 0.45 : 1;
  ctx.drawImage(img, 0, oy, cw, ch);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#000"; // theme-exempt: a macOS template image is black + alpha by definition
  ctx.fillRect(0, 0, size, size);
  // Cut-outs: the touchpad, the charging bolt, a gap around the dot.
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.roundRect(TOUCHPAD.x0 * cw + cw * 0.012, oy + TOUCHPAD.y0 * ch, (TOUCHPAD.x1 - TOUCHPAD.x0) * cw - cw * 0.024, (TOUCHPAD.y1 - TOUCHPAD.y0) * ch, size * 0.03);
  ctx.fill();
  if (spec.charging) {
    boltPath(ctx, size, cw, ch, oy);
    ctx.fill();
  }
  const { r, ring, cx, cy } = dotPlace(size);
  if (spec.dot !== "none") {
    ctx.beginPath();
    ctx.arc(cx, cy, r + ring, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    if (spec.dot === "ok") {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(1.5, size / 20);
      ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // lifetime: OK — on the FileReader, which is dropped after its one read
    reader.onload = () => resolve(reader.result as string);
    // lifetime: OK — on the FileReader, which is dropped after its one read
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
