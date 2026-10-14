// Liquid glass for one element: what's behind it is frosted (a light blur)
// and bent at the edges like light through the rim of a glass slab.
//
// Technique (credit: Shu Ding's liquid-glass, MIT; ideas from Max Rovensky's
// liquid-glass-react, MIT): an SVG filter used as the element's
// backdrop-filter. A displacement map, drawn once per size, encodes for every
// pixel how far to shift the backdrop sample (R = x, G = y, 128 = none). Away
// from the edges nothing moves; in a bevel band along the rounded-rectangle
// edge, samples shift along the edge normal following a convex lens profile,
// so the backdrop bulges at the rim. Red, green and blue shift by slightly
// different amounts (chromatic aberration). Chromium only (Electron).

export interface GlassOptions {
  radius: number; // corner radius, px
  bevel: number; // width of the bending band along the edge, px
  strength: number; // max shift at the very edge, px
  frost: number; // blur, px
  aberration: number; // extra shift for red vs blue, 0..1 of strength
}

export const DEFAULT_GLASS: GlassOptions = { radius: 10, bevel: 22, strength: 26, frost: 6, aberration: 0.12 };

// Signed distance from (px, py) to a rounded rectangle centered at the
// origin with half-size (hx, hy) and corner radius r: negative inside.
function sdRoundRect(px: number, py: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// The displacement map as a data: URL (PNG), at `scale` of the element size.
export function displacementMap(w: number, h: number, o: GlassOptions, scale = 0.5): string {
  const cw = Math.max(2, Math.round(w * scale));
  const ch = Math.max(2, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cw, ch);
  const hx = w / 2;
  const hy = h / 2;
  const e = 0.5; // finite-difference step for the edge normal
  for (let j = 0; j < ch; j++) {
    // loop: NOT-WORTH — half-size pixels of a glass element; on mount and debounced resize only
    for (let i = 0; i < cw; i++) {
      const x = (i + 0.5) / scale - hx;
      const y = (j + 0.5) / scale - hy;
      const d = -sdRoundRect(x, y, hx, hy, o.radius); // distance inside the edge, px
      let dx = 0;
      let dy = 0;
      if (d > 0 && d < o.bevel) {
        // Convex lens: strongest at the rim, easing to none at the inner edge
        // of the bevel (a circular profile: 1 - sqrt(1 - (1 - t)^2)).
        const t = d / o.bevel;
        const k = 1 - Math.sqrt(1 - (1 - t) * (1 - t));
        // Outward normal from the distance field's gradient.
        const gx = sdRoundRect(x + e, y, hx, hy, o.radius) - sdRoundRect(x - e, y, hx, hy, o.radius);
        const gy = sdRoundRect(x, y + e, hx, hy, o.radius) - sdRoundRect(x, y - e, hx, hy, o.radius);
        const len = Math.hypot(gx, gy) || 1;
        // Sample inward (toward the center): the rim magnifies what's inside.
        dx = -(gx / len) * k;
        dy = -(gy / len) * k;
      }
      const p = (j * cw + i) * 4;
      img.data[p] = Math.round(128 + dx * 127);
      img.data[p + 1] = Math.round(128 + dy * 127);
      img.data[p + 2] = 128;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

const SVG_NS = "http://www.w3.org/2000/svg";
let defs: SVGDefsElement | null = null;
let counter = 0;

function filterHost(): SVGDefsElement {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

// Builds (or rebuilds) the filter for an element of size w x h; returns its
// CSS reference for backdrop-filter.
export function glassFilter(id: string, w: number, h: number, o: GlassOptions): string {
  const host = filterHost();
  host.querySelector(`#${id}`)?.remove();
  const map = displacementMap(w, h, o);
  const s = o.strength;
  const a = o.aberration;
  // Blur (frost) -> displace each color channel by its own amount -> recombine.
  const f = document.createElementNS(SVG_NS, "filter");
  f.setAttribute("id", id);
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  f.setAttribute("width", String(w));
  f.setAttribute("height", String(h));
  f.setAttribute("filterUnits", "userSpaceOnUse");
  f.setAttribute("color-interpolation-filters", "sRGB");
  const step = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    f.appendChild(el);
  };
  // loop: NOT-WORTH — N = 3 x 4 matrix cells; per glass filter build
  const only = (c: number) => [0, 1, 2].map((r) => [0, 1, 2, 3].map((k) => (r === c && k === c ? 1 : 0)).join(" ") + " 0").join("  ") + "  0 0 0 1 0";
  step("feImage", { href: map, x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" });
  step("feGaussianBlur", { in: "SourceGraphic", stdDeviation: o.frost, result: "frost" });
  ["r", "g", "b"].forEach((c, i) => {
    step("feDisplacementMap", { in: "frost", in2: "map", scale: s * (1 + a * (1 - i)), xChannelSelector: "R", yChannelSelector: "G", result: `d${c}` });
    step("feColorMatrix", { in: `d${c}`, type: "matrix", values: only(i), result: c });
  });
  step("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" });
  step("feBlend", { in: "rg", in2: "b", mode: "screen" });
  host.appendChild(f);
  return `url(#${id})`;
}

export function nextGlassId(): string {
  counter += 1;
  return `ds5-glass-${counter}`;
}

export function removeGlassFilter(id: string): void {
  defs?.querySelector(`#${id}`)?.remove();
}
