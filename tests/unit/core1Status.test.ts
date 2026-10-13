import i18next from "i18next";
import { describe, expect, it } from "vitest";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import { core1StoppedText } from "../../src/desktop/dongle/core1Status";
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
