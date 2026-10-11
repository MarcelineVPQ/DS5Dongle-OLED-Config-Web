import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, correctStick, correctTrigger, decodeCalibration, encodeCalibration, fitCenter, fitOuter, fitTrigger, normalizeCalibration } from "../../src/protocol/calibration";
import { Ds5BridgeClient, FEATURES2 } from "../../src/protocol/bridgeClient";
import { FakeDongle } from "../support/fakeDongle";

describe("calibration codec (protocol 1.5)", () => {
  it("round-trips through the 18-byte body", () => {
    const c = {
      sticks: [
        { cx: -3, cy: 5, deadzone: 8, outer: 120 },
        { cx: 2, cy: -1, deadzone: 6, outer: 124 },
      ],
      triggers: [
        { lo: 4, hi: 250 },
        { lo: 0, hi: 240 },
      ],
      gyro: [-12, 7, 300],
    } as const;
    expect(decodeCalibration(encodeCalibration(structuredClone(c) as never))).toEqual(c);
    expect(encodeCalibration(DEFAULT_CALIBRATION)).toHaveLength(18);
  });
  it("keeps values inside the firmware's limits", () => {
    const n = normalizeCalibration({
      sticks: [{ cx: 99, cy: -99, deadzone: 90, outer: 20 }, DEFAULT_CALIBRATION.sticks[1]],
      triggers: [{ lo: 250, hi: 10 }, DEFAULT_CALIBRATION.triggers[1]],
      gyro: [99999, 0, 0],
    });
    expect(n.sticks[0]).toEqual({ cx: 40, cy: -40, deadzone: 63, outer: 64 });
    expect(n.triggers[0].hi - n.triggers[0].lo).toBeGreaterThanOrEqual(64);
    expect(n.gyro[0]).toBe(32767);
  });
  it("corrects like the firmware: deadzone, recentering, full tilt, trigger range", () => {
    const s = { cx: 4, cy: -2, deadzone: 8, outer: 120 };
    expect(correctStick(132, 126, s)).toEqual([128, 128]); // resting drift is centered
    expect(correctStick(132 + 120, 126, s)[0]).toBe(255); // reaching the outer radius is full tilt
    expect(correctTrigger(4, { lo: 4, hi: 250 })).toBe(0);
    expect(correctTrigger(250, { lo: 4, hi: 250 })).toBe(255);
  });
  it("fits center, range and trigger travel from samples", () => {
    const rest: Array<[number, number]> = [
      [131, 127],
      [132, 126],
      [133, 128],
    ];
    expect(fitCenter(rest)).toMatchObject({ cx: 4, cy: -1 });
    expect(
      fitOuter(
        [
          [252, 127],
          [4, 127],
          [132, 6],
        ],
        4,
        -1,
      ),
    ).toBeLessThanOrEqual(128);
    expect(fitTrigger([3, 3, 120, 248])).toEqual({ lo: 5, hi: 246 });
  });
  it("reads and writes through the client", async () => {
    const dongle = new FakeDongle();
    const client = new Ds5BridgeClient(dongle);
    expect((await client.identity()).features2 & FEATURES2.calibration).toBe(FEATURES2.calibration);
    expect(await client.readCalibration()).toEqual(DEFAULT_CALIBRATION);
    const next = structuredClone(DEFAULT_CALIBRATION);
    next.sticks[0] = { cx: 3, cy: -2, deadzone: 6, outer: 122 };
    await client.setCalibration(next);
    expect(await client.readCalibration()).toEqual(next);
  });
});
