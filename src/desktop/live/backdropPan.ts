// The background's slow pan and zoom (Ken Burns): 46 s one way, eased
// (CSS ease-in-out), then back, the same path the stylesheet animation took.
// Driven from script a few times a second instead of by a CSS animation: an
// infinite CSS animation makes the compositor draw the whole window at the
// screen's refresh rate (60 to 240 frames a second), and every Glass or
// translucent surface over the background re-blurs it each time. The steps
// stay under ~1.5 px at 4K, which the blurred art can't show.
// The layers read the transform from --bd-pan (desktop.css .art-bd-layer).

const PERIOD_S = 46;
// Focused: 10 steps a second; behind another window: 4 (SwirlField's rate).
export const PAN_MS = 100;
export const PAN_UNFOCUSED_MS = 250;

// CSS ease-in-out, cubic-bezier(0.42, 0, 0.58, 1): x(u) solved by bisection
// (x is monotonic), then y(u).
function easeInOut(x: number): number {
  const bez = (u: number, p1: number, p2: number) => 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
  let lo = 0;
  let hi = 1;
  // loop: HOT-PATH-OK — 20 bisection steps, once per pan step (≤ 10 a second)
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, 0.42, 0.58) < x) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, 0, 1);
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
