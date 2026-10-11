// The narrator's voice lines (assets-src/voice): every line in every language,
// with its audio, and nothing displayed that's only meant for generation.
// Loudness and transcripts are checked by tools/check_voice.py (needs ffmpeg
// and the ElevenLabs key, so it runs locally, not in CI).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Line {
  key: string;
  text: string;
  tagged: string;
  [field: string]: unknown;
}
const DIR = "assets-src/voice";
const spec = JSON.parse(readFileSync(`${DIR}/lines.json`, "utf8")) as { languages: string[]; lines: Line[] };
const APP_LOCALES = ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"];
const textOf = (line: Line, lang: string) => (lang === "en" ? line.text : (line[`text_${lang}`] as string | undefined));

describe("narrator voice lines", () => {
  it("covers exactly the app's languages", () => {
    expect([...spec.languages].sort()).toEqual([...APP_LOCALES].sort());
  });

  it("has unique keys", () => {
    const keys = spec.lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(APP_LOCALES)("%s: every line has text, a tagged version and its audio", (lang) => {
    for (const line of spec.lines) {
      expect(textOf(line, lang), `${lang} ${line.key}`).toBeTruthy();
      expect(lang === "en" ? line.tagged : line[`tagged_${lang}`], `${lang} ${line.key} tagged`).toBeTruthy();
      expect(existsSync(`${DIR}/${lang}/${line.key}.mp3`), `${lang}/${line.key}.mp3`).toBe(true);
      // Speaker masters are rebuilt locally (tools/master_voice.py, gitignored):
      // checked where they've been built.
      if (existsSync(`${DIR}/${lang}-speaker`)) expect(existsSync(`${DIR}/${lang}-speaker/${line.key}.wav`), `${lang}-speaker/${line.key}.wav`).toBe(true);
    }
  });

  it.each(APP_LOCALES)("%s: no orphaned audio files", (lang) => {
    const keys = new Set(spec.lines.map((l) => l.key));
    for (const dir of [`${DIR}/${lang}`, `${DIR}/${lang}-speaker`].filter((d) => existsSync(d))) {
      for (const file of readdirSync(dir)) expect(keys.has(file.replace(/\.(mp3|wav)$/, "")), `${dir}/${file}`).toBe(true);
    }
  });

  it.each(APP_LOCALES)("%s: displayed text never contains delivery tags", (lang) => {
    for (const line of spec.lines) expect(textOf(line, lang), `${lang} ${line.key}`).not.toMatch(/\[[^\]]*\]/);
  });

  it.each(APP_LOCALES)('%s: the dongle is a "Pico 2 W" wherever it\'s named', (lang) => {
    for (const line of spec.lines) {
      const text = textOf(line, lang) ?? "";
      if (/pico/i.test(text)) expect(text, `${lang} ${line.key}`).toContain("Pico 2 W");
    }
  });

  it('names the cross button "X" (what players say), not "cross", in English', () => {
    for (const line of spec.lines) expect(line.text, line.key).not.toMatch(/\bcross\b/i);
  });
});
