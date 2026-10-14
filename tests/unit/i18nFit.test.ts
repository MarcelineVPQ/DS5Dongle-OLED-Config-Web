// Words that sit in the live view's fixed-size tiles must fit them in every
// language. Tiles wrap at spaces, but a single long word can't wrap cleanly
// (German "Ausgezeichnet" spilled out of the Signal tile), so each word gets
// a budget in display width. Chinese and Japanese text breaks between any
// two characters on its own, so CJK characters never count toward a word.
// The full check, every screen in every language, is tools/check_layout.mjs.
import { describe, expect, it } from "vitest";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import ja from "../../src/i18n/locales/ja.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

const LOCALES: Record<string, unknown> = { en, de, fr, es, "pt-BR": ptBR, "zh-CN": zhCN, ja };

// A line can break at spaces, slashes and dots, and around every CJK character.
const BREAKS = /[\s/·-]+|[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
const longestWord = (s: string) => Math.max(0, ...s.split(BREAKS).map((w) => [...w].length));

function lookup(obj: unknown, path: string): string[] {
  const node = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  if (typeof node === "string") return [node];
  if (node && typeof node === "object") return Object.values(node).filter((v): v is string => typeof v === "string");
  return [];
}

// Tile values: bold, 13-14px. Tile labels: 11.5px.
const BUDGETS: Array<[string, number]> = [
  ["desktop.overview.signalQ", 12],
  ["desktop.lightbar.modes", 12],
  ["desktop.live.player", 12],
  ["desktop.controller.battery", 16],
  ["desktop.controller.charging", 16],
  ["desktop.controller.pluggedIn", 16],
  ["desktop.overview.signal", 16],
  ["desktop.overview.slot", 16],
  ["desktop.live.part.lightbar", 16],
];

describe("tile words fit in every language", () => {
  for (const [path, budget] of BUDGETS) {
    it(`${path}: no word wider than ${budget}`, () => {
      for (const [lang, locale] of Object.entries(LOCALES)) {
        const strings = lookup(locale, path);
        expect(strings.length, `${lang} has ${path}`).toBeGreaterThan(0);
        for (const s of strings) expect(longestWord(s), `${lang}: "${s}"`).toBeLessThanOrEqual(budget);
      }
    });
  }
});
