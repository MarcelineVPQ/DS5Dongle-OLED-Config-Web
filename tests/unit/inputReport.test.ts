// The DualSense Edge's extra buttons in the input report (USB report 0x01
// without its id, as the dongle's 0xF0 sends it): byte 9 bits 4..7.
import { describe, expect, it } from "vitest";
import { decodeInputReport } from "../../src/oled/inputReport";

const withByte9 = (value: number) => {
  const b = new Uint8Array(63);
  b[7] = 0x08; // d-pad released
  b[9] = value;
  return decodeInputReport(b);
};

describe("DualSense Edge buttons (input byte 9)", () => {
  it.each([
    [0x10, "fnLeft"],
    [0x20, "fnRight"],
    [0x40, "backLeft"],
    [0x80, "backRight"],
  ] as const)("byte 9 = %i alone is %s", (bit, key) => {
    const i = withByte9(bit);
    for (const k of ["fnLeft", "fnRight", "backLeft", "backRight"] as const) expect(i[k], k).toBe(k === key);
    expect([i.home, i.pad, i.mute]).toEqual([false, false, false]);
  });

  it("keeps PS, touchpad click and mute (bits 0..2) apart from them", () => {
    const i = withByte9(0x07);
    expect([i.home, i.pad, i.mute]).toEqual([true, true, true]);
    expect([i.fnLeft, i.fnRight, i.backLeft, i.backRight]).toEqual([false, false, false, false]);
  });

  it("reads all four together, and none on a standard DualSense report", () => {
    const all = withByte9(0xf0);
    expect([all.fnLeft, all.fnRight, all.backLeft, all.backRight]).toEqual([true, true, true, true]);
    const none = withByte9(0x00);
    expect([none.fnLeft, none.fnRight, none.backLeft, none.backRight]).toEqual([false, false, false, false]);
  });
});
