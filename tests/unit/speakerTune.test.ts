import { describe, expect, it } from "vitest";
import { PEAK, TUNE, noteCount, noteHz, renderTune, tuneSeconds } from "../../src/desktop/live/speakerTune";

describe("speaker test tune (Korobeiniki)", () => {
  const rate = 48000;
  const pcm = renderTune(rate);

  it("plays the whole melody, A B A, about 38 s", () => {
    expect(TUNE.reduce((s, [, b]) => s + b, 0)).toBe(96);
    expect(pcm.length / rate).toBeCloseTo(tuneSeconds(), 3);
    expect(pcm.length / rate).toBeGreaterThan(37);
    expect(pcm.length / rate).toBeLessThan(40);
  });

  it("has 90 notes (37 + 16 + 37)", () => {
    expect(noteCount()).toBe(90);
  });

  it("never clips and peaks at the test sound's level", () => {
    let peak = 0;
    for (const s of pcm) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(PEAK + 1e-6);
    expect(peak).toBeGreaterThan(PEAK * 0.9);
  });

  it("starts and ends silent (fades, no clicks)", () => {
    expect(Math.abs(pcm[0])).toBe(0);
    expect(Math.abs(pcm[pcm.length - 1])).toBe(0);
  });

  it("tunes A4 to 440 Hz", () => {
    expect(noteHz("A4")).toBe(440);
    expect(noteHz("A5")).toBeCloseTo(880, 6);
    expect(noteHz("E5")).toBeCloseTo(659.255, 2);
  });
});
