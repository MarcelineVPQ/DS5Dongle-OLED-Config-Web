// Stylized illustration of the Waveshare Pico-OLED-1.3 add-on board.
// SVG outer frame + absolutely-positioned children slot for the OLED canvas.
//
// Reference photo: assets/main_screen_01.jpeg in the firmware repo. Real board
// dimensions are roughly 4:1 PCB with the OLED window in the center-right,
// two tactile buttons (KEY0 upper, KEY1 lower) on the left edge, and a small
// "Pico-OLED-1.3" silkscreen label on the right side.

import { ReactNode } from "react";

export interface PicoBoardFrameProps {
  /** The canvas / screen content, rendered inside the OLED window. */
  children: ReactNode;
  /** Pulse the lightbar-like accent glow around the OLED window when connected. */
  connected?: boolean;
}

// Geometry: total board 600x300, OLED window 384x192 at (120, 50) — matches
// the 384x192 emulator canvas (the firmware's 128x64 framebuffer × 3 scale).
const W = 600;
const H = 300;
const OLED_X = 120;
const OLED_Y = 50;
const OLED_W = 384;
const OLED_H = 192;

export default function PicoBoardFrame({ children, connected = false }: PicoBoardFrameProps) {
  return (
    <div className={`pico-board ${connected ? "connected" : ""}`} aria-label="Pico-OLED-1.3 add-on board">
      <svg
        className="pico-board-svg"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-hidden="true"
      >
        {/* PCB body — Waveshare's navy-blue solder mask, slight gradient for depth */}
        <defs>
          <linearGradient id="pcb-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a4d8c" />
            <stop offset="100%" stopColor="#0e3565" />
          </linearGradient>
          <linearGradient id="oled-bezel-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0b0f1a" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <filter id="oled-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Board outline */}
        <rect x="2" y="2" width={W - 4} height={H - 4} rx="14" fill="url(#pcb-grad)" stroke="#0a2547" strokeWidth="2" />

        {/* Subtle inner bevel */}
        <rect x="6" y="6" width={W - 12} height={H - 12} rx="11" fill="none" stroke="#2563a8" strokeWidth="0.5" opacity="0.5" />

        {/* GPIO header dots along the bottom edge */}
        {Array.from({ length: 20 }).map((_, i) => (
          <circle key={`gpio-${i}`} cx={20 + i * 28} cy={H - 14} r="3" fill="#d4af37" opacity="0.85" />
        ))}

        {/* Mounting holes — four corners */}
        <circle cx="14" cy="14" r="5" fill="#0a2547" />
        <circle cx={W - 14} cy="14" r="5" fill="#0a2547" />
        <circle cx="14" cy={H - 30} r="5" fill="#0a2547" />
        <circle cx={W - 14} cy={H - 30} r="5" fill="#0a2547" />

        {/* KEY0 + KEY1 tactile buttons on the left edge */}
        <g>
          {/* KEY0 — upper */}
          <rect x="32" y="85" width="34" height="34" rx="4" fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="1.5" />
          <circle cx="49" cy="102" r="10" fill="#262626" stroke="#0a0a0a" strokeWidth="1" />
          <text x="80" y="106" fontSize="11" fontFamily="JetBrains Mono, monospace" fill="#cbd5e1">KEY0</text>
        </g>
        <g>
          {/* KEY1 — lower */}
          <rect x="32" y="185" width="34" height="34" rx="4" fill="#1a1a1a" stroke="#3a3a3a" strokeWidth="1.5" />
          <circle cx="49" cy="202" r="10" fill="#262626" stroke="#0a0a0a" strokeWidth="1" />
          <text x="80" y="206" fontSize="11" fontFamily="JetBrains Mono, monospace" fill="#cbd5e1">KEY1</text>
        </g>

        {/* OLED screen bezel — black recessed panel */}
        <rect
          x={OLED_X - 6}
          y={OLED_Y - 6}
          width={OLED_W + 12}
          height={OLED_H + 12}
          rx="4"
          fill="url(#oled-bezel-grad)"
          stroke={connected ? "#22C55E" : "#222"}
          strokeWidth={connected ? "1.5" : "1"}
          filter={connected ? "url(#oled-glow)" : undefined}
        />

        {/* OLED active area — placeholder rect that the canvas covers via abs positioning */}
        <rect x={OLED_X} y={OLED_Y} width={OLED_W} height={OLED_H} fill="#000" />

        {/* "Pico-OLED-1.3" silkscreen on the right side, rotated 90° */}
        <text
          x={W - 38}
          y={H / 2 + 50}
          fontSize="11"
          fontFamily="JetBrains Mono, monospace"
          fill="#e2e8f0"
          opacity="0.6"
          transform={`rotate(-90 ${W - 38} ${H / 2 + 50})`}
        >
          Pico-OLED-1.3 · SH1107
        </text>

        {/* Waveshare logo placeholder text top-right */}
        <text
          x={W - 80}
          y="22"
          fontSize="9"
          fontFamily="JetBrains Mono, monospace"
          fill="#e2e8f0"
          opacity="0.5"
        >
          WAVESHARE
        </text>
      </svg>

      {/* Canvas slot — positioned to overlay the OLED active area. The child
          canvas component sizes itself to OLED_W × OLED_H via the CSS classes
          we already have (.oled-canvas: 384x192). */}
      <div
        className="pico-board-screen-slot"
        style={{
          // Percentages so the slot follows the SVG when it scales responsively.
          left: `${(OLED_X / W) * 100}%`,
          top: `${(OLED_Y / H) * 100}%`,
          width: `${(OLED_W / W) * 100}%`,
          height: `${(OLED_H / H) * 100}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
