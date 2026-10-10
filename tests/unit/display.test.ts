import { describe, expect, it } from "vitest";
import { adcToCelsius, formatUptime, signalQuality } from "../../src/desktop/format";

describe("Overview display helpers", () => {
  it("converts the RP2350 temperature ADC reading to Celsius", () => {
    // 0.706 V is 27 °C by the datasheet formula.
    expect(adcToCelsius(Math.round((0.706 * 4096) / 3.3))).toBeCloseTo(27, 0);
  });

  it("formats uptime compactly", () => {
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(125)).toBe("2m 5s");
    expect(formatUptime(3 * 3600 + 7 * 60)).toBe("3h 7m");
  });

  it("grades Classic BT RSSI (distance from the golden range, not dBm)", () => {
    expect(signalQuality(0)).toBe("excellent");
    expect(signalQuality(-10)).toBe("good");
    expect(signalQuality(-20)).toBe("fair");
    expect(signalQuality(-40)).toBe("weak");
  });
});
