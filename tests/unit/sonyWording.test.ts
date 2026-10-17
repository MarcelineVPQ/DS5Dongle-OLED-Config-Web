// Gate: the controller's parts and settings use Sony's own words in each
// language (docs/GLOSSARY.md). These are the slips the 0.9.5 bug hunt found
// (D4); each must not come back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../src/i18n/locales/", import.meta.url);

function strings(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix.slice(0, -1), node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([k, v]) => strings(v, `${prefix}${k}.`));
}
const load = (loc: string) => strings(JSON.parse(readFileSync(new URL(`${loc}.json`, dir), "utf8")));

// Per locale: the wrong word, Sony's word (for the failure message).
const SLIPS: [string, RegExp, string][] = [
  ["fr", /zone morte/i, "Zone inerte (Deadzone)"],
  ["fr", /boutons? arrière/i, "Touches arrière (Back buttons)"],
  ["fr", /contrôleur/i, "manette (Controller)"],
  ["pt-BR", /zona morta/i, "Zona inativa (Deadzone)"],
  // 手柄 is fine for a generic gamepad (标准手柄, XInput) and other tools; the DualSense is 控制器.
  ["zh-CN", /(?<!标准|其他)手柄/, "控制器 (Controller)"],
];

// English left in a translation (bug hunt D8: the board's chip line).
describe("no English left in the board's spec line", () => {
  it.each(["de", "es", "fr", "ja", "pt-BR", "zh-CN"])("%s", (loc) => {
    // loop: test — every string of one locale
    expect(load(loc).filter(([key, value]) => key.startsWith("desktop.dash.specs.chip") && /dual-core/.test(value))).toEqual([]);
  });
});

describe("Sony's names (docs/GLOSSARY.md)", () => {
  it.each(SLIPS)("%s: no %s (Sony: %s)", (loc, slip) => {
    // loop: test — every string of one locale
    expect(
      load(loc)
        .filter(([, value]) => slip.test(value))
        .map(([key]) => key),
    ).toEqual([]);
  });
});
