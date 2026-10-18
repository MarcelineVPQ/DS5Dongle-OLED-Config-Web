// Games → Recommended changes: every label and explanation the main process
// sends (Msg, games/types.ts) renders in every locale with no placeholder
// left over. dev.19's screenshot pass found the HDR fix ending in a literal
// "{{input}}" ("…with HDR.{{input}}", "%command%{{input}}").
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ default: "electron", ipcMain: { handle: () => undefined, on: () => undefined }, nativeImage: {} }));

import i18n, { SUPPORTED_LANGUAGES } from "../../src/i18n";
import { allFixes, type Fix, type GamesReport } from "../../src/desktop/games/types";
import { msgText } from "../../src/desktop/library/waiting";
import { fakeReport, newFakeState } from "../../electron/main/games/fake/library";

const t = i18n.t.bind(i18n);
const linux = { linux: true, now: new Date("2026-10-14T12:00:00Z") };

// Every fix a report offers: recommended ones and each game's other Proton choices.
function everyFix(r: GamesReport): Fix[] {
  // loop: NOT-WORTH — test only
  const choices = r.games.flatMap((g) => (g.protons ?? []).flatMap((c) => (c.fix ? [c.fix] : [])));
  return [...allFixes(r), ...choices];
}

describe("Recommended changes text", () => {
  let fixes: Fix[] = [];
  beforeAll(() => {
    const state = newFakeState();
    fixes = [...everyFix(fakeReport(state, linux)), ...everyFix(fakeReport(state, { ...linux, linux: false }))];
  });

  it("covers the HDR fixes, the one with Steam Input turned off included", () => {
    expect(fixes.some((f) => f.kind === "hdr-on")).toBe(true);
    expect(fixes.some((f) => JSON.stringify(f.why).includes("why.hdrInputOff"))).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES.map((l) => l.code))("leaves no {{placeholder}} in any label or explanation (%s)", async (code) => {
    await i18n.changeLanguage(code);
    for (const f of fixes) {
      for (const m of [f.label, f.why]) {
        const text = msgText(t, m);
        expect(text, `${f.id} ${m.key}`).not.toContain("{{");
        expect(text, `${f.id} ${m.key}`).not.toContain("desktop.games.msg.");
      }
    }
  });
});
