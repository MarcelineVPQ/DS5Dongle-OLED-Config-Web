import i18next from "i18next";
import { describe, expect, it } from "vitest";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import { boardProblems, boardProblemsKey, core1StoppedText } from "../../src/desktop/dongle/core1Status";
import { CORE1_MIC_FAILED } from "../../src/protocol/bridgeClient";
import { deviceVariables } from "../../src/i18n/deviceForms";
import type { AudioCounters } from "../../src/protocol/bridgeClient";

async function tFor(lng: string, resources: object) {
  const i = i18next.createInstance();
  await i.init({ lng, resources: { [lng]: { translation: resources } }, interpolation: { escapeValue: false, defaultVariables: deviceVariables(lng, null) } });
  return i.t;
}
const counters = (extra: Partial<AudioCounters>) => ({ core1Loops: 0, ...extra }) as AudioCounters;

describe("the Core1 stopped notice (issue #15)", () => {
  it("names the start-up step and the free heap", async () => {
    const t = await tFor("en", en);
    expect(core1StoppedText(t, counters({ core1Stage: 4, core1FreeHeap: 184 * 1024 }))).toBe(
      "Core1 stopped while creating the speaker encoder (start-up step 4): the audio path is dead until your board restarts. Free memory when core1 started: 184 KB.",
    );
  });
  it("leaves the heap out while it isn't known", async () => {
    const t = await tFor("en", en);
    expect(core1StoppedText(t, counters({ core1Stage: 1 }))).toBe("Core1 stopped while registering for flash lockout (start-up step 1): the audio path is dead until your board restarts.");
  });
  it("older firmware (no stage) and unknown stages keep the plain notice", async () => {
    const t = await tFor("en", en);
    expect(core1StoppedText(t, counters({}))).toBe(en.desktop.diag.core1Frozen.replace("{{device}}", "your board"));
    expect(core1StoppedText(t, counters({ core1Stage: 12 }))).toBe(en.desktop.diag.core1Frozen.replace("{{device}}", "your board"));
  });
  it("every stage has its step in English and in German", async () => {
    for (const [lng, res] of [
      ["en", en],
      ["de", de],
    ] as const) {
      const t = await tFor(lng, res);
      for (let stage = 0; stage <= 9; stage++) {
        const text = core1StoppedText(t, counters({ core1Stage: stage }));
        expect(text).not.toContain("desktop.diag");
        expect(text).toContain(res.desktop.diag.core1Step[String(stage) as keyof typeof res.desktop.diag.core1Step]);
      }
    }
  });
});

describe("the board health key (no re-render of the whole app per read)", () => {
  it("stays the same while the loop count moves and nothing is wrong", () => {
    expect(boardProblemsKey(counters({ core1Loops: 1, core1FreeHeap: 100 * 1024 }), true)).toBe(boardProblemsKey(counters({ core1Loops: 97_001, core1FreeHeap: 90 * 1024 }), true));
  });
  it("changes whenever the problems or their texts would", async () => {
    const t = await tFor("en", en);
    const reads: [AudioCounters, boolean][] = [
      [counters({ core1Stage: 4, core1FreeHeap: 184 * 1024 }), false],
      [counters({ core1Stage: 4, core1FreeHeap: 120 * 1024 }), false],
      [counters({ core1Stage: 9, core1FreeHeap: 120 * 1024 }), false],
      [counters({ core1Flags: CORE1_MIC_FAILED, core1FreeHeap: 120 * 1024 }), true],
      [counters({}), true],
    ];
    // loop: NOT-WORTH — five fixed reads in a test
    for (const [a, aliveA] of reads)
      for (const [b, aliveB] of reads) if (boardProblemsKey(a, aliveA) === boardProblemsKey(b, aliveB)) expect(boardProblems(t, a, aliveA)).toEqual(boardProblems(t, b, aliveB));
    expect(new Set(reads.map(([c, alive]) => boardProblemsKey(c, alive))).size).toBe(reads.length);
    expect(boardProblemsKey(counters({}), null)).not.toBe(boardProblemsKey(counters({}), true));
  });
});
