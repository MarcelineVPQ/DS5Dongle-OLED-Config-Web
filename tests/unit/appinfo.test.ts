import { describe, expect, it } from "vitest";
import { kindOf, parseAppTypes } from "../../electron/main/games/appinfo";

// A tiny v29 appinfo.vdf: two apps, keys as string-table indices.
function build(apps: Array<[number, string]>): Buffer {
  const strings = ["appinfo", "common", "type", "name"];
  const idx = (s: string) => strings.indexOf(s);
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
  const entries = apps.map(([id, type]) => {
    const kv = Buffer.concat([
      Buffer.from([0]),
      u32(idx("appinfo")),
      Buffer.from([0]),
      u32(idx("common")),
      Buffer.from([1]),
      u32(idx("name")),
      cstr("X"),
      Buffer.from([2]),
      u32(idx("name")),
      u32(7),
      Buffer.from([1]),
      u32(idx("type")),
      cstr(type),
      Buffer.from([8]),
      Buffer.from([8]),
      Buffer.from([8]),
    ]);
    const body = Buffer.concat([Buffer.alloc(4 + 4 + 8 + 20 + 4 + 20), kv]);
    return Buffer.concat([u32(id), u32(body.length), body]);
  });
  const head = Buffer.alloc(16);
  head.writeUInt32LE(0x07564429, 0);
  head.writeUInt32LE(1, 4);
  const payload = Buffer.concat([...entries, u32(0)]);
  head.writeBigUInt64LE(BigInt(16 + payload.length), 8);
  const table = Buffer.concat([u32(strings.length), ...strings.map(cstr)]);
  return Buffer.concat([head, payload, table]);
}

describe("Steam app categories (appinfo.vdf)", () => {
  it("reads common/type for the wanted apps only", () => {
    const buf = build([
      [10, "Game"],
      [20, "Music"],
      [30, "Application"],
    ]);
    expect([...parseAppTypes(buf, new Set(["10", "20"]))]).toEqual([
      ["10", "game"],
      ["20", "music"],
    ]);
  });

  it("maps Steam's types and gives nothing for unknown or damaged files", () => {
    expect(kindOf("Series")).toBe("video");
    expect(kindOf("DLC")).toBe("dlc");
    expect(kindOf("Whatever")).toBeUndefined();
    expect(parseAppTypes(Buffer.from("not a vdf at all"), new Set(["1"])).size).toBe(0);
    const cut = build([[10, "Game"]]).subarray(0, 40);
    expect(parseAppTypes(cut, new Set(["10"])).size).toBe(0);
  });
});
