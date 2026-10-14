// The Glass look's captions on game art (Games → Home tiles): a tint from
// the art's own color (its color vote, the game page's accent source), as
// clear as its text allows. The tint's opacity rises until the ink reads at
// 4.5:1 even over pure white art; the ink is then made legible on the tint
// over white art, over black art and on the solid tint (Reduce
// transparency). Set as tokens on the tile; desktop.css draws with them.
import { contrast, hexToRgb, legibleOnAll, mix, type Rgb } from "../theme/desktopPalette";

const LIGHT: Rgb = [255, 255, 255];
const DARK: Rgb = [0, 0, 0];
// The glass dim (Apple's ~35% dark layer under labels), the tint's base.
const DIM: Rgb = [8, 10, 16];
const css = (c: Rgb) => `rgb(${c.join(", ")})`;

export function glassCaption(artColor: string | null): Record<string, string> {
  const tint = mix(artColor ? hexToRgb(artColor) : DIM, DIM, 0.68);
  let alpha = 0.5;
  while (alpha < 1 && contrast(LIGHT, mix(LIGHT, tint, alpha)) < 4.6) alpha = Math.min(1, alpha + 0.02);
  const pct = Math.ceil(alpha * 100);
  const grounds = [mix(LIGHT, tint, pct / 100), mix(DARK, tint, pct / 100), tint];
  return {
    "--cap-tint": css(tint),
    "--cap-alpha": `${pct}%`,
    "--cap-ink": css(legibleOnAll(LIGHT, grounds, 4.5, LIGHT)),
    "--cap-ink-soft": css(legibleOnAll(mix(LIGHT, tint, 0.3), grounds, 4.5, LIGHT)),
  };
}
