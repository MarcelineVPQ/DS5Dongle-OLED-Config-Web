import { describe, expect, it } from "vitest";
import { sharedTitleKeys } from "../../src/desktop/library/sharedTitles";

describe("sharedTitleKeys", () => {
  it("marks every row whose name another row has (one game in two launchers), and only those", () => {
    const games = [
      { key: "heroic:gog:1", title: "Ghostrunner" },
      { key: "lutris:lutris:2", title: "Ghostrunner" },
      { key: "steam:3", title: "Portal 2" },
    ];
    expect([...sharedTitleKeys(games)].sort()).toEqual(["heroic:gog:1", "lutris:lutris:2"]);
  });

  it("compares the name as shown: case and surrounding spaces don't make two games", () => {
    expect(
      sharedTitleKeys([
        { key: "a", title: "Hades " },
        { key: "b", title: "HADES" },
        { key: "c", title: "Hades II" },
      ]),
    ).toEqual(new Set(["a", "b"]));
  });

  it("three copies: all three say their launcher; no games, nothing", () => {
    expect(sharedTitleKeys(["a", "b", "c"].map((key) => ({ key, title: "Control" }))).size).toBe(3);
    expect(sharedTitleKeys([]).size).toBe(0);
  });
});
