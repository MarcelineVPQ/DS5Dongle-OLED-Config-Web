import { describe, expect, it } from "vitest";
import { ButtonLayoutSchema } from "../../src/desktop/games/library";
import { layoutSummary } from "../../src/desktop/live/layoutSummary";

const identity = Array.from({ length: 16 }, (_, i) => i);
const names = ["Fn L", "Fn R", "Paddle L", "Paddle R"];

describe("Edge extras in saved layouts", () => {
  it("accepts layouts with or without the four entries, and only valid values", () => {
    expect(ButtonLayoutSchema.safeParse({ name: "R", table: identity, updated: 1 }).success).toBe(true);
    expect(ButtonLayoutSchema.safeParse({ name: "R", table: identity, extra: [13, 0xfe, 0xff, 12], updated: 1 }).success).toBe(true);
    expect(ButtonLayoutSchema.safeParse({ name: "R", table: identity, extra: [16, 0xff, 0xff, 0xff], updated: 1 }).success).toBe(false);
    expect(ButtonLayoutSchema.safeParse({ name: "R", table: identity, extra: [0xff, 0xff], updated: 1 }).success).toBe(false);
  });
  it("names the Edge buttons in the summary; itself is no change", () => {
    expect(layoutSummary(identity, "Off", "none", { values: [13, 0xfe, 0xff, 0xff], names })).toBe("Fn L → Cross ✕ · Fn R → Off");
    expect(layoutSummary(identity, "Off", "none", { values: [0xff, 0xff, 0xff, 0xff], names })).toBe("none");
  });
});
