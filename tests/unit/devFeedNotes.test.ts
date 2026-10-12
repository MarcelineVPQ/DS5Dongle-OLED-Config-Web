import { describe, expect, it } from "vitest";
import { Manifest } from "../../src/update/manifest";

const base = { channel: "dev", app: { version: "0.9.5-dev.2", notes_url: "https://github.com/x/y/releases/tag/v", platforms: {} } };

describe("update feed: app notes (shown before joining the Development channel)", () => {
  it("carries the notes when present and stays valid without them", () => {
    expect(Manifest.parse({ ...base, app: { ...base.app, notes: "### Added\n\n- Things" } }).app.notes).toContain("Added");
    expect(Manifest.parse(base).app.notes).toBeUndefined();
  });
  it("refuses an oversized notes field", () => {
    expect(Manifest.safeParse({ ...base, app: { ...base.app, notes: "x".repeat(20001) } }).success).toBe(false);
  });
});
