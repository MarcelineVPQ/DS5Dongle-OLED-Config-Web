// Steam's app info cache (appcache/appinfo.vdf, binary): only each installed
// app's `common/type` is read (Game, Demo, DLC, Music, Tool, Application,
// Video…), so the library can label and hide soundtracks, tools and videos
// the way Steam does. Read-only; unknown or damaged files give no types.
//
// Format (versions 28 and 29, magic 0x07564428 / 0x07564429):
//   header  magic u32, universe u32, (29) string table offset u64
//   entries appid u32 (0 = end), size u32 (bytes after this field),
//           info state u32, last updated u32, PICS token u64, SHA-1 20,
//           change number u32, (28+) binary SHA-1 20, then binary KeyValues
//   binary KeyValues: type byte (0 map, 1 string, 2 int32, 3 float,
//           4 pointer, 5 wstring, 6 color, 7 uint64, 8 or 11 end of map,
//           10 int64), then the key (29: u32 index into the string table;
//           28: NUL-terminated), then the value
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type AppKind = "game" | "demo" | "dlc" | "music" | "tool" | "application" | "video";

const KIND: Record<string, AppKind> = {
  game: "game",
  demo: "demo",
  beta: "game",
  dlc: "dlc",
  music: "music",
  tool: "tool",
  config: "tool",
  application: "application",
  video: "video",
  series: "video",
  episode: "video",
};

export const kindOf = (steamType: string | undefined): AppKind | undefined => (steamType ? KIND[steamType.toLowerCase()] : undefined);

export function parseAppTypes(buf: Buffer, wanted: Set<string>): Map<string, AppKind> {
  const out = new Map<string, AppKind>();
  if (buf.length < 16) return out;
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x07564428 && magic !== 0x07564429) return out;
  const v29 = magic === 0x07564429;
  let strings: string[] = [];
  let pos = 8;
  if (v29) {
    const tableAt = Number(buf.readBigUInt64LE(8));
    pos = 16;
    if (tableAt <= 0 || tableAt + 4 > buf.length) return out;
    const count = buf.readUInt32LE(tableAt);
    let p = tableAt + 4;
    strings = [];
    // loop: HOT-PATH-OK — one pass over appinfo.vdf's string table, linear, no allocation per step
    for (let i = 0; i < count && p < buf.length; i++) {
      const end = buf.indexOf(0, p);
      if (end < 0) break;
      strings.push(buf.toString("utf8", p, end));
      p = end + 1;
    }
  }
  const cstr = (p: number): [string, number] => {
    const end = buf.indexOf(0, p);
    if (end < 0) throw new RangeError("unterminated string");
    return [buf.toString("utf8", p, end), end + 1];
  };
  const key = (p: number): [string, number] => (v29 ? [strings[buf.readUInt32LE(p)] ?? "", p + 4] : cstr(p));

  // Walks one map; returns common/type if found at path ["appinfo","common","type"].
  const findType = (start: number, end: number): string | undefined => {
    const stack: string[] = [];
    let p = start;
    // loop: HOT-PATH-OK — walks one wanted app's key-values, returns at common/type
    while (p < end) {
      const t = buf[p++];
      if (t === 8 || t === 11) {
        if (stack.length === 0) return undefined;
        stack.pop();
        continue;
      }
      const [k, next] = key(p);
      p = next;
      switch (t) {
        case 0:
          stack.push(k);
          break;
        case 1: {
          const [v, n] = cstr(p);
          p = n;
          if (k.toLowerCase() === "type" && stack.length === 2 && stack[1].toLowerCase() === "common") return v;
          break;
        }
        case 2:
        case 3:
        case 4:
        case 6:
          p += 4;
          break;
        case 7:
        case 10:
          p += 8;
          break;
        case 5: {
          // UTF-16 string, two zero bytes at the end
          // loop: HOT-PATH-OK — skips one UTF-16 value, linear in its length
          while (p + 1 < end && (buf[p] !== 0 || buf[p + 1] !== 0)) p += 2;
          p += 2;
          break;
        }
        default:
          return undefined; // unknown type: stop reading this app
      }
    }
    return undefined;
  };

  try {
    // loop: HOT-PATH-OK — one linear walk of appinfo.vdf, stops when all wanted apps are found
    while (pos + 8 <= buf.length) {
      const appid = buf.readUInt32LE(pos);
      if (appid === 0) break;
      const size = buf.readUInt32LE(pos + 4);
      const body = pos + 8;
      const next = body + size;
      if (next > buf.length) break;
      const id = String(appid);
      if (wanted.has(id)) {
        const kvStart = body + 4 + 4 + 8 + 20 + 4 + 20;
        const kind = kindOf(findType(kvStart, next));
        if (kind) out.set(id, kind);
        if (out.size === wanted.size) break;
      }
      pos = next;
    }
  } catch {
    // damaged entry: keep what was read
  }
  return out;
}

export function steamAppTypes(steamRoot: string, appids: string[]): Map<string, AppKind> {
  if (appids.length === 0) return new Map();
  try {
    return parseAppTypes(readFileSync(join(steamRoot, "appcache", "appinfo.vdf")), new Set(appids));
  } catch {
    return new Map();
  }
}
