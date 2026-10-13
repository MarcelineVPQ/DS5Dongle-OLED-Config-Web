// @vitest-environment jsdom
// Color vision's warning colors (e.g. #e69f00) are ~2:1 on the Light theme's
// panels; the accent layer makes the warning text legible even without a
// colorway accent (controllerAccent.ts warnText, dev.7 gate).
import { describe, expect, it } from "vitest";
import { COLOR_VISIONS, PALETTES } from "../../src/desktop/colorVision";
import { warnText } from "../../src/desktop/live/controllerAccent";
import { contrast, hexToRgb, parseColor } from "../../src/desktop/theme/desktopPalette";

// The Light and Dark themes' own surfaces (styles.css).
const LIGHT = { "--bg-page": "#f5f7fa", "--bg-panel": "#ffffff", "--bg-elevated": "#ffffff", "--bg-inset": "#f3f5f8", "--bg-segment": "#eef2f6" };
const DARK = { "--bg-page": "#0f172a", "--bg-panel": "#1b2336" };

describe("warning text with Color vision on, no colorway accent", () => {
  it.each(COLOR_VISIONS)("%s: reads at 4.5:1 on every Light and Dark surface", (cv) => {
    for (const theme of [LIGHT, DARK]) {
      const base = Object.fromEntries([...Object.entries(theme), ["--text-warn", PALETTES[cv].warn]].map(([k, v]) => [k, hexToRgb(v)]));
      const out = parseColor(warnText(base)["--text-warn"]);
      expect(out).not.toBeNull();
      for (const g of Object.values(theme)) expect(contrast(out!, hexToRgb(g))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
