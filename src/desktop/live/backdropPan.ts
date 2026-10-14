// The background's slow pan and zoom (Ken Burns): 46 s one way, eased
// (CSS ease-in-out), then back, the same path the stylesheet animation took.
// Driven from script a few times a second instead of by a CSS animation: an
// infinite CSS animation makes the compositor draw the whole window at the
// screen's refresh rate (60 to 240 frames a second), and every Glass or
// translucent surface over the background re-blurs it each time. The steps
// stay under ~1.5 px at 4K, which the blurred art can't show. Only while the
// window is focused: behind another window (or a game) it holds still.
// The layers read the transform from --bd-pan (desktop.css .art-bd-layer).
// The crossfade between games steps in the same frames (--bd-fade, 0..1), so
// it adds none of its own.

const PERIOD_S = 46;
// 10 steps a second.
export const PAN_MS = 100;
// The crossfade: 4 s (40 of those steps), CSS "ease".
export const FADE_MS = 4000;

// A CSS cubic-bezier(x1, y1, x2, y2) at x: u solved by bisection (x is
// monotonic), then y(u).
function cubicBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const bez = (u: number, p1: number, p2: number) => 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
  let lo = 0;
  let hi = 1;
  // loop: HOT-PATH-OK — 20 bisection steps, once per pan step (≤ 10 a second)
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, y1, y2);
}
const easeInOut = (x: number) => cubicBezier(x, 0.42, 0, 0.58, 1);

// How far a crossfade is `ms` after it started: 0..1, eased, 3 decimals.
export function fadeProgress(ms: number): string {
  const x = Math.min(1, Math.max(0, ms / FADE_MS));
  return x >= 1 ? "1" : cubicBezier(x, 0.25, 0.1, 0.25, 1).toFixed(3);
}

// A number for the transform, never "-0.000".
const fixed = (v: number, digits: number) => (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);

// The transform `seconds` into the motion (alternating legs).
export function panTransform(seconds: number): string {
  const leg = (Math.max(0, seconds) / PERIOD_S) % 2;
  const e = easeInOut(leg < 1 ? leg : 2 - leg);
  return `scale(${fixed(1 + 0.12 * e, 4)}) translate(${fixed(-2 + 4 * e, 3)}%, ${fixed(-1 + 2.5 * e, 3)}%)`;
}

// One clock for the art and the swirls, kept across remounts and pauses, so
// the picture carries on where it was instead of jumping back to the start.
// cache: OK — key=none (seconds of motion so far); invalidated=advanced by the running pan only; bound=1 number
let elapsed = 0;
export function panClock(): () => number {
  const start = performance.now() - elapsed * 1000;
  return () => (elapsed = (performance.now() - start) / 1000);
}
