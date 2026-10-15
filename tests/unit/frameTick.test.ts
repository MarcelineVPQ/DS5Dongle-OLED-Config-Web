// The shared frame clock (src/desktop/frameTick.ts): the background's steps
// and the once-a-second readouts reach the screen on the same tick, so an
// idle page draws 10 frames a second, not 10 plus one per readout change.
// And the swirl's pan drawn in the shader matches the CSS transform it
// replaced (backdropPan.ts panSource).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atNextTick, onFrameTick, TICK_MS, ticking } from "../../src/desktop/frameTick";
import { NO_PAN, panAt, panSource, panTransform } from "../../src/desktop/live/backdropPan";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the frame clock", () => {
  it("runs a readout's update in the same tick as the background's step, before it", () => {
    const order: string[] = [];
    const off = onFrameTick(() => order.push("step"));
    expect(ticking()).toBe(true);
    vi.advanceTimersByTime(TICK_MS * 3);
    expect(order).toEqual(["step", "step", "step"]);
    order.length = 0;
    // A poll's answer arriving between two ticks waits for the next one.
    vi.advanceTimersByTime(TICK_MS / 3);
    atNextTick(() => order.push("readout"));
    expect(order).toEqual([]);
    vi.advanceTimersByTime(TICK_MS);
    expect(order).toEqual(["readout", "step"]);
    off();
  });

  it("runs an update at once when nothing draws (Reduce motion, unfocused, no background)", () => {
    expect(ticking()).toBe(false);
    const fn = vi.fn();
    atNextTick(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops a cancelled update, and releases what waited when the last drawer leaves", () => {
    const off = onFrameTick(() => undefined);
    const dropped = vi.fn();
    const kept = vi.fn();
    const cancel = atNextTick(dropped);
    atNextTick(kept);
    cancel();
    off();
    expect(ticking()).toBe(false);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    // No timer left behind.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one timer for every drawer, and a failing drawer doesn't stop the others", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const a = vi.fn(() => {
      throw new Error("boom");
    });
    const b = vi.fn();
    const offA = onFrameTick(a);
    const offB = onFrameTick(b);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TICK_MS * 2);
    expect(b).toHaveBeenCalledTimes(2);
    offA();
    offB();
    expect(vi.getTimerCount()).toBe(0);
    err.mockRestore();
  });
});

describe("the swirl's pan in the shader", () => {
  // Where CSS "scale(s) translate(x%, y%)" (transform-origin: center) puts a
  // point (0..1 of the layer, y down) of the unmoved picture.
  const cssMaps = (transform: string, u: number, v: number): [number, number] => {
    const m = /scale\(([-\d.]+)\) translate\(([-\d.]+)%, ([-\d.]+)%\)/.exec(transform)!;
    const [s, x, y] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
    return [s * (u - 0.5 + x) + 0.5, s * (v - 0.5 + y) + 0.5];
  };
  it("shows at each point the picture the CSS transform put there", () => {
    // loop: NOT-WORTH — test: a few moments along the motion
    for (const t of [0, 7.3, 23, 46, 61.5]) {
      // loop: NOT-WORTH — test: a few points of the layer
      for (const [u, v] of [
        [0.1, 0.2],
        [0.5, 0.5],
        [0.93, 0.71],
      ]) {
        const [px, py] = cssMaps(panTransform(t), u, v);
        const [su, sv] = panSource(px, py, panAt(t));
        expect(su).toBeCloseTo(u, 3);
        expect(sv).toBeCloseTo(v, 3);
      }
    }
  });
  it("leaves the picture where it is when still", () => {
    expect(panSource(0.3, 0.8, NO_PAN)).toEqual([0.3, 0.8]);
  });
});
