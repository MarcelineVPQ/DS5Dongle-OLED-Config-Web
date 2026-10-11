import { describe, expect, it } from "vitest";
import { execArg } from "../../electron/main/desktopEntry";

describe("desktop entry Exec= quoting", () => {
  it("quotes a plain path", () => {
    expect(execArg("/home/a/DS5.AppImage")).toBe('"/home/a/DS5.AppImage"');
  });

  it("escapes the characters the spec reserves, and field codes", () => {
    expect(execArg("/home/a b/100% $x`y\\z")).toBe('"/home/a b/100%% \\\\$x\\\\`y\\\\\\\\z"');
  });
});
