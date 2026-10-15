// One clock for everything that changes the window while it sits idle: the
// background's 10 Hz steps (the swirl field's frames, the art's pan and
// crossfade) and the once-a-second readouts (the Pico 2 W page's live
// numbers and graphs, the link rates, the signal).
//
// Each change on screen costs a frame. Two sources on their own timers land
// in different frames: 10 background steps a second plus a readout that
// changes once a second drew ~11 frames a second (over the idle budget,
// docs/BUDGETS.md), and every extra frame costs the renderer and the GPU a
// full composite. So the background draws on this clock (onFrameTick), and
// a readout hands its update to the next tick (atNextTick): both then go to
// the screen in the same frame. With nothing drawing (Reduce motion, the
// window not focused, background off, or no background on this page) a
// readout's update runs at once.
//
// Cost: one 100 ms timer while something draws, none otherwise; a readout
// waits at most 100 ms.
import { flushSync } from "react-dom";
import { logged } from "../errorText";
import { PAN_MS } from "./live/backdropPan";

// 10 ticks a second: the idle frame budget and the pan's step.
export const TICK_MS = PAN_MS;

// cache: OK — key=none (the drawers subscribed now); invalidated=each unsubscribe; bound=one per mounted background layer (≤ 2)
const drawers = new Set<() => void>();
// cache: OK — key=none (updates waiting for the next tick); invalidated=emptied every tick and by each cancel; bound=one per mounted readout poll
const waiting = new Set<() => void>();
// cache: OK — key=none (the shared interval while something draws); invalidated=cleared when the last drawer leaves; bound=1 timer
let timer: ReturnType<typeof setInterval> | undefined;

function run(fn: () => void, why: string): void {
  try {
    fn();
  } catch (cause) {
    // error: LOGGED-OK — a bug in one drawer or readout: logged, and the clock keeps the others running
    logged(why)(cause);
  }
}

// The updates that waited, all at once.
function release(): void {
  const due = [...waiting];
  waiting.clear();
  // loop: HOT-PATH-OK — N ≤ a few readout polls on the page, once a second each
  for (const fn of due) run(fn, "a readout's update on the frame tick");
}

function tick(): void {
  // React renders the readouts now, before the background's step below, so
  // both reach the screen in one frame.
  if (waiting.size > 0) flushSync(release);
  // loop: HOT-PATH-OK — N ≤ 2 background layers, 10 a second, only while shown and focused
  for (const draw of drawers) run(draw, "a background step on the frame tick");
}

// Draws `draw` every tick until the returned function is called. Callers
// subscribe only while the window is shown and focused (the lean rule).
export function onFrameTick(draw: () => void): () => void {
  drawers.add(draw);
  // lifetime: OK — the one shared interval; cleared below when the last drawer leaves
  timer ??= setInterval(tick, TICK_MS);
  return () => {
    drawers.delete(draw);
    if (drawers.size > 0) return;
    clearInterval(timer);
    timer = undefined;
    // Nothing draws any more: what waited goes to the screen now (no
    // flushSync: this may run in a React effect's cleanup).
    release();
  };
}

// Is something drawing on the clock now?
export const ticking = (): boolean => drawers.size > 0;

// Runs `update` (a readout's state change) on the next tick, or at once when
// nothing draws. The returned function cancels it if it hasn't run yet.
export function atNextTick(update: () => void): () => void {
  if (!ticking()) {
    update();
    return () => undefined;
  }
  waiting.add(update);
  return () => waiting.delete(update);
}
