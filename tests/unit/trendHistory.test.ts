import { describe, expect, it } from "vitest";
import { HISTORY, TREND_MAX_SAMPLES, TREND_PX_PER_SAMPLE, trendCapacity } from "../../src/desktop/dongle/trendHistory";

describe("trendCapacity", () => {
  it("keeps at least the last minute", () => {
    expect(trendCapacity(0)).toBe(HISTORY);
    expect(trendCapacity(-5)).toBe(HISTORY);
    expect(trendCapacity(Number.NaN)).toBe(HISTORY);
    expect(trendCapacity(60)).toBe(HISTORY);
  });
  it("grows with the drawn width, one sample per few pixels", () => {
    expect(trendCapacity(600)).toBe(600 / TREND_PX_PER_SAMPLE);
    expect(trendCapacity(900)).toBe(300);
    expect(trendCapacity(1200)).toBeGreaterThan(trendCapacity(900));
  });
  it("is capped", () => {
    expect(trendCapacity(100000)).toBe(TREND_MAX_SAMPLES);
  });
});
