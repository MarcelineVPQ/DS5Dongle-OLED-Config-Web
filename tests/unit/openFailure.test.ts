import { describe, expect, it } from "vitest";
import { isOpenFailure } from "../../src/hooks/useDs5Bridge";

describe("isOpenFailure", () => {
  it("recognizes WebUSB's open/claim errors", () => {
    expect(isOpenFailure(new DOMException("Failed to execute 'claimInterface' on 'USBDevice': Unable to claim interface.", "NetworkError"))).toBe(true);
    expect(isOpenFailure(new DOMException("Failed to execute 'claimInterface' on 'USBDevice': The device was disconnected.", "NotFoundError"))).toBe(true);
  });
  it("leaves every other error visible", () => {
    expect(isOpenFailure(new Error("Unsupported protocol 2.0"))).toBe(false);
    expect(isOpenFailure(new DOMException("The transfer timed out.", "TimeoutError"))).toBe(false);
  });
});
