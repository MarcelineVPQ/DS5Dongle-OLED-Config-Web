import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../src/i18n/locales/", import.meta.url);
const load = (file: string) => JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Record<string, unknown>;

function flat(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object") return [prefix.slice(0, -1)];
  return Object.entries(node).flatMap(([k, v]) => flat(v, `${prefix}${k}.`));
}

// i18next plural forms (key_one, key_other, ...) count as one key.
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const keysOf = (file: string, root: string) => new Set(flat(load(file)[root], `${root}.`).map(base));

const locales = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json");

describe("translations", () => {
  it("every locale has exactly the strings English has, in every section", () => {
    const roots = Object.keys(load("en.json"));
    const all = (file: string) => new Set(roots.flatMap((r) => [...keysOf(file, r)]));
    const en = all("en.json");
    for (const file of locales) {
      const keys = all(file);
      expect(
        [...en].filter((k) => !keys.has(k)),
        `${file} missing`,
      ).toEqual([]);
      expect(
        [...keys].filter((k) => !en.has(k)),
        `${file} extra`,
      ).toEqual([]);
    }
  });

  it("every message key the Games engine can emit exists in every locale", () => {
    const source = readFileSync(new URL("../../electron/main/games/games.ts", import.meta.url), "utf8");
    // Every string literal shaped like a message key, wherever it's passed (msg, orMsg, ternaries).
    const emitted = new Set([...source.matchAll(/"((?:label|why|support|fallback|result)\.\w+)"/g)].map((m) => `desktop.games.msg.${m[1]}`));
    emitted.add("desktop.games.msg.legacy"); // written by backup.ts for old manifests
    expect(emitted.size).toBeGreaterThan(20);
    for (const file of ["en.json", ...locales]) {
      const keys = keysOf(file, "desktop");
      expect(
        [...emitted].filter((k) => !keys.has(k)),
        file,
      ).toEqual([]);
    }
  });
});
