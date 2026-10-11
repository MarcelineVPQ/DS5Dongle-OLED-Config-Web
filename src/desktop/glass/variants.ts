// Apple's two Liquid Glass variants, as our filter settings.
// Clear: highly translucent, for floating controls over rich backgrounds
// (little frost, strong lensing in a thin rim). Regular: more frost, for
// text-heavy surfaces (a sidebar, an inspector). Square: they dock to the
// window edges.
import type { GlassOptions } from "./liquidGlass";

export const CLEAR_GLASS_RAIL: Partial<GlassOptions> = { radius: 0, bevel: 14, strength: 44, frost: 1.5, aberration: 0.18 };
export const CLEAR_GLASS_BAR: Partial<GlassOptions> = { radius: 0, bevel: 14, strength: 44, frost: 1.5, aberration: 0.18 };
export const REGULAR_GLASS: Partial<GlassOptions> = { radius: 0, bevel: 14, strength: 36, frost: 18, aberration: 0.12 };
