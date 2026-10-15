// How much history a trend line keeps and draws: one sample a second, one
// sample per few pixels of the line's drawn width, so a wider line holds a
// longer stretch and fills from left to right over time (Diagnostics →
// Timing). Bounded both ways: never less than the last minute, never more
// than TREND_MAX_SAMPLES.

// The last minute: the short graphs and the dials' trends.
export const HISTORY = 60;
// Pixels between two samples on a width-sized trend line.
export const TREND_PX_PER_SAMPLE = 3;
// The longest a trend line goes back (10 min at one sample a second).
export const TREND_MAX_SAMPLES = 600;

// The samples a trend line drawn `widthPx` wide keeps.
export function trendCapacity(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return HISTORY;
  return Math.min(TREND_MAX_SAMPLES, Math.max(HISTORY, Math.floor(widthPx / TREND_PX_PER_SAMPLE)));
}
