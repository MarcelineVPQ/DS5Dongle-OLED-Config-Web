// Visual DualSense remap diagram. The controller art is Zacksly's CC BY 3.0
// outline (recolored to currentColor so it follows the theme — see
// src/assets/controller-outline.svg, modified from the original). On top of it
// sits a transparent SVG overlay of clickable hotspots, one per remappable
// button. Hotspot centers are read from the asset's own geometry (circle cx/cy
// for faces + sticks, path bounding-box centers for the rest) — not eyeballed.
//
// The shoulders/triggers (L1/L2/R1/R2) have no clear target in a front view, so
// instead of invisible hotspots over empty space they're drawn as the actual
// Zacksly button glyphs floating in the corners with a leader line to the
// shoulder — obvious click targets.

import type { KeyboardEvent } from "react";
import controllerSvg from "../assets/controller-outline.svg?raw";
import l1Glyph from "../assets/glyphs/l1.svg?raw";
import l2Glyph from "../assets/glyphs/l2.svg?raw";
import r1Glyph from "../assets/glyphs/r1.svg?raw";
import r2Glyph from "../assets/glyphs/r2.svg?raw";
import { REMAP_COUNT } from "../protocol/remap";

// Must share the viewBox of src/assets/controller-outline.svg.
const VIEW_BOX = "800 320 2500 1480";

// Inner markup of an imported SVG (drops the leading comment + <svg> wrapper).
const innerSvg = (s: string) => {
  const open = s.indexOf("<svg");
  const gt = s.indexOf(">", open);
  return s.slice(gt + 1, s.lastIndexOf("</svg>"));
};

interface Hotspot {
  index: number; // firmware remap index (see REMAP_BUTTON_OPTIONS)
  cx: number;
  cy: number;
  r: number; // hit radius (viewBox units), sized to avoid neighbour overlap
}

// On-controller buttons (visible in the art). Coordinates in the 4096x2160 space.
const HOTSPOTS: Hotspot[] = [
  { index: 2,  cx: 1582, cy: 599,  r: 55 },  // Create
  { index: 3,  cx: 1425, cy: 722,  r: 66 },  // D-pad Up
  { index: 4,  cx: 1330, cy: 818,  r: 66 },  // D-pad Left
  { index: 5,  cx: 1425, cy: 913,  r: 66 },  // D-pad Down
  { index: 6,  cx: 1521, cy: 818,  r: 66 },  // D-pad Right
  { index: 7,  cx: 1724, cy: 1094, r: 115 }, // L3 (left stick)
  { index: 10, cx: 2512, cy: 599,  r: 55 },  // Options
  { index: 11, cx: 2668, cy: 672,  r: 70 },  // Triangle
  { index: 12, cx: 2815, cy: 819,  r: 70 },  // Circle
  { index: 13, cx: 2668, cy: 966,  r: 70 },  // Cross
  { index: 14, cx: 2521, cy: 819,  r: 70 },  // Square
  { index: 15, cx: 2370, cy: 1094, r: 115 }, // R3 (right stick)
];

// Floating shoulder/trigger glyphs. cx/cy = glyph box centre; the leader runs
// from (lx,ly) on the glyph side to (sx,sy) on the controller shoulder.
const GLYPH_BOX = 170;
const FLOATS: Array<{ index: number; glyph: string; cx: number; cy: number; lx: number; ly: number; sx: number; sy: number }> = [
  { index: 0, glyph: l2Glyph, cx: 940,  cy: 420, lx: 1020, ly: 430, sx: 1330, sy: 470 }, // L2
  { index: 1, glyph: l1Glyph, cx: 940,  cy: 590, lx: 1020, ly: 580, sx: 1330, sy: 510 }, // L1
  { index: 8, glyph: r2Glyph, cx: 3156, cy: 420, lx: 3076, ly: 430, sx: 2766, sy: 470 }, // R2
  { index: 9, glyph: r1Glyph, cx: 3156, cy: 590, lx: 3076, ly: 580, sx: 2766, sy: 510 }, // R1
];

export interface ControllerDiagramProps {
  table: number[];                  // current remap draft (length REMAP_COUNT)
  selected: number | null;          // focused source index, or null
  onSelect: (index: number) => void;
  disabled?: boolean;
  labelFor: (index: number) => string; // button display name (for aria)
}

export default function ControllerDiagram({ table, selected, onSelect, disabled, labelFor }: ControllerDiagramProps) {
  const interact = (index: number) => ({
    role: "button" as const,
    tabIndex: disabled ? -1 : 0,
    "aria-pressed": selected === index,
    "aria-label": labelFor(index),
    onClick: () => !disabled && onSelect(index),
    onKeyDown: (e: KeyboardEvent) => {
      if (!disabled && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onSelect(index);
      }
    },
  });
  const stateClass = (index: number) =>
    [index < REMAP_COUNT && table[index] !== index ? "remapped" : "", selected === index ? "selected" : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div className={`controller-diagram ${disabled ? "disabled" : ""}`}>
      {/* Themed controller art (decorative; the hotspots carry the semantics). */}
      <div className="controller-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: controllerSvg }} />
      <svg className="controller-hotspots" viewBox={VIEW_BOX} role="group" aria-label="Controller buttons">
        {/* Floating shoulder/trigger glyphs. */}
        {FLOATS.map((f) => (
          <g key={f.index} className={`ctrl-float ${stateClass(f.index)}`} {...interact(f.index)}>
            <line className="ctrl-leader" x1={f.lx} y1={f.ly} x2={f.sx} y2={f.sy} />
            <rect
              className="ctrl-float-hit"
              x={f.cx - GLYPH_BOX / 2 - 10}
              y={f.cy - GLYPH_BOX / 2 - 10}
              width={GLYPH_BOX + 20}
              height={GLYPH_BOX + 20}
              rx={24}
            />
            <svg
              className="ctrl-float-glyph"
              x={f.cx - GLYPH_BOX / 2}
              y={f.cy - GLYPH_BOX / 2}
              width={GLYPH_BOX}
              height={GLYPH_BOX}
              viewBox="0 0 512 512"
              dangerouslySetInnerHTML={{ __html: innerSvg(f.glyph) }}
            />
          </g>
        ))}
        {/* On-controller buttons. */}
        {HOTSPOTS.map((h) => (
          <circle key={h.index} className={`ctrl-hotspot ${stateClass(h.index)}`} cx={h.cx} cy={h.cy} r={h.r} {...interact(h.index)} />
        ))}
      </svg>
    </div>
  );
}
