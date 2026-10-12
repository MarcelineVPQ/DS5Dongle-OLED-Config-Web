import { describe, expect, it } from "vitest";
import { appVersionLabel } from "../../src/desktop/appVersion";

describe("appVersionLabel", () => {
  it("is the plain version in a release build (no build id)", () => {
    expect(appVersionLabel("0.9.3")).toBe("0.9.3");
    expect(appVersionLabel(undefined)).toBe("");
  });
});
