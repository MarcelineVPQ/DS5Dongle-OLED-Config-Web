import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureNode, getNode, getString, parseVdf, removeKey, serializeVdf, setKey, VdfSyntaxError } from "../../electron/main/games/vdf";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/games/${name}`, import.meta.url), "utf8");

describe("VDF parser", () => {
  it("round-trips Steam's own formatting byte for byte", () => {
    for (const f of ["config.vdf", "localconfig.vdf"]) {
      const text = fixture(f);
      expect(serializeVdf(parseVdf(text)), f).toBe(text);
    }
  });

  it("keeps numeric app-id keys in file order (no JS object reordering)", () => {
    const root = parseVdf(fixture("config.vdf"));
    const mapping = getNode(root, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping")!;
    expect(mapping.map(([k]) => k).slice(0, 3)).toEqual(["0", "1091500", "3280350"]);
  });

  it("looks keys up case-insensitively (Valve vs valve)", () => {
    const root = parseVdf(fixture("config.vdf"));
    expect(getString(root, "installconfigstore", "software", "valve", "steam", "CompatToolMapping", "0", "name")).toBe("GE-Proton11-7-DualSense");
  });

  it("handles escapes, comments and unquoted tokens", () => {
    const root = parseVdf('// header\n"a"\n{\n\t"b"\t"x \\"q\\" \\\\ y"\n\tc\td\n}\n');
    expect(getString(root, "a", "b")).toBe('x "q" \\ y');
    expect(getString(root, "a", "c")).toBe("d");
    expect(parseVdf(serializeVdf(root))).toEqual(root);
  });

  it("rejects malformed input instead of guessing", () => {
    for (const bad of ['"a"\n{\n"b" "c"\n', '"a" }', '"unterminated', '"a"']) {
      expect(() => parseVdf(bad), bad).toThrow(VdfSyntaxError);
    }
  });

  it("edits in place: set, create and remove keep everything else", () => {
    const root = parseVdf(fixture("config.vdf"));
    const steam = getNode(root, "InstallConfigStore", "Software", "Valve", "Steam")!;
    const entry = ensureNode(steam, "CompatToolMapping", "9999999");
    setKey(entry, "name", "Our-Proton");
    expect(getString(steam, "CompatToolMapping", "9999999", "name")).toBe("Our-Proton");
    expect(getString(steam, "SDL_GamepadBind")).toBe("keep me");
    expect(removeKey(getNode(steam, "CompatToolMapping")!, "9999999")).toBe(true);
    expect(serializeVdf(root)).toBe(fixture("config.vdf"));
  });
});
