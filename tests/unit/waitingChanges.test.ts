// The recommended changes waiting, split by game and this computer
// (library/waiting.ts): the rail's Games badge is the games plus this
// computer's changes, so it always equals Library's two chips; its tooltip
// names what's waiting (a real case: a badge "1" said only "1 recommended
// change", Games that need setup said 0, and the change was the controller's
// volume, not a game's).
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { NO_WAITING, waitingChanges, waitingSplit, waitingText, waitingTotal, WAITING_NAMED, type Waiting } from "../../src/desktop/library/waiting";
import type { Fix, GameEntry, GamesReport, Msg } from "../../src/desktop/games/types";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import ja from "../../src/i18n/locales/ja.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

const t = i18n.t.bind(i18n);
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

const fix = (id: string, launcher: Fix["launcher"], label: Msg, recommended = true): Fix => ({ id, kind: "steam-input-off", launcher, label, why: { key: "why.audioVolume" }, files: [], recommended });
const VOLUME = fix("system:audio-volume:1", "system", { key: "label.audioVolumeSaved" });
const STEAM_DEFAULT = fix("steam:default", "steam", { key: "label.defaultSteam", params: { proton: "GE-Proton10-DualSense" } });
const game = (key: string, title: string, fixes: Fix[]): GameEntry => ({
  key,
  title,
  launcher: "steam",
  store: "steam",
  id: key,
  runner: null,
  runnerMissing: false,
  usesOurProton: false,
  envFlags: [],
  support: "triggers",
  fixes,
});
const report = (games: GameEntry[], pc: { launcher?: Fix[]; system?: Fix[] } = {}): GamesReport =>
  ({ launchers: [{ id: "steam", fixes: pc.launcher ?? [] }], system: { fixes: pc.system ?? [] }, games, ourProton: {}, scannedAt: "" }) as unknown as GamesReport;
const RALLY = game("steam:1", "Assetto Corsa Rally", [fix("steam:input:1", "steam", { key: "label.steamInput", params: { game: "Assetto Corsa Rally" } })]);
const NONE = new Set<string>();

describe("the split", () => {
  it("her case: only the controller's volume waits: no game, one change for this computer, a badge of 1", () => {
    const w = waitingChanges(report([game("steam:2", "Returnal", [])], { system: [VOLUME] }), NONE);
    expect(w.games).toEqual([]);
    expect(w.pc).toEqual([VOLUME.label]);
    expect(waitingTotal(w)).toBe(1);
  });

  it("the badge is games + this computer's changes: a game with three changes counts once", () => {
    const many = game("steam:3", "Cyberpunk 2077", [
      fix("a", "steam", { key: "label.hdr", params: { game: "Cyberpunk 2077" } }),
      fix("b", "steam", { key: "label.steamInput", params: { game: "Cyberpunk 2077" } }),
      fix("c", "steam", { key: "label.gamepad", params: { game: "Cyberpunk 2077" } }),
    ]);
    const w = waitingChanges(report([RALLY, many], { launcher: [STEAM_DEFAULT], system: [VOLUME] }), NONE);
    expect(w.games.map((g) => [g.title, g.labels.length])).toEqual([
      ["Assetto Corsa Rally", 1],
      ["Cyberpunk 2077", 3],
    ]);
    expect(w.pc).toEqual([STEAM_DEFAULT.label, VOLUME.label]); // launchers first, then the system's
    expect(waitingTotal(w)).toBe(4);
  });

  it("declined and not-recommended changes don't wait (and a game left with none isn't counted)", () => {
    const declined = new Set(["steam:input:1", VOLUME.id]);
    const w = waitingChanges(report([RALLY], { launcher: [{ ...STEAM_DEFAULT, recommended: false }], system: [VOLUME] }), declined);
    expect(w).toEqual(NO_WAITING);
  });
});

describe("Recommended changes' header", () => {
  it("says the counts like Library's chips", () => {
    expect(waitingSplit(t, { games: [], pc: [VOLUME.label] })).toBe("This computer: 1 change");
    const two = { key: "k", title: "T", labels: [VOLUME.label] };
    expect(waitingSplit(t, { games: [two, two], pc: [VOLUME.label, VOLUME.label] })).toBe("2 games · This computer: 2 changes");
    expect(waitingSplit(t, { games: [two], pc: [] })).toBe("1 game");
  });
});

describe("the tooltip's text", () => {
  it("names the change by its label", () => {
    expect(waitingText(t, { games: [], pc: [VOLUME.label] })).toBe("Recommended: Keep the controller's volume and microphone level at full when it reconnects");
  });

  it("a game's one change by its label (it names the game); a game with more by its name and count", () => {
    const w: Waiting = {
      games: [
        { key: "k", title: "Assetto Corsa Rally", labels: [RALLY.fixes[0].label] },
        { key: "c", title: "Cyberpunk 2077", labels: [VOLUME.label, VOLUME.label] },
      ],
      pc: [],
    };
    expect(waitingText(t, w)).toBe("Recommended: Turn Steam Input off for Assetto Corsa Rally; Cyberpunk 2077: 2 changes");
  });

  it(`at most ${WAITING_NAMED} names, then +N more`, () => {
    const games = ["A", "B", "C", "D"].map((title) => ({ key: title, title, labels: [{ key: "label.hdr", params: { game: title } }] }));
    expect(waitingText(t, { games, pc: [VOLUME.label] })).toBe("Recommended: Turn on HDR for A; Turn on HDR for B; Turn on HDR for C +2 more");
  });

  it("is keyed in all 7 languages, without 'dongle'", async () => {
    for (const locale of [de, en, es, fr, ja, ptBR, zhCN]) {
      const w = locale.desktop.games.waiting;
      expect(w.task).toContain("{{list}}");
      expect(w.separator).toBeTruthy();
      expect(w.more_other).toContain("{{count}}");
      expect(w.game_other).toContain("{{game}}");
      expect(w.games_other).toContain("{{count}}");
      expect(locale.desktop.library.pcChanges_other).toContain("{{count}}");
      expect(locale.desktop.library.pcChangesHint).toBeTruthy();
      expect(JSON.stringify([w, locale.desktop.library.pcChanges_other, locale.desktop.library.pcChangesHint]).toLowerCase()).not.toContain("dongle");
    }
    await i18n.changeLanguage("de");
    expect(waitingText(t, { games: [], pc: [VOLUME.label] })).toMatch(/^Empfohlen: /);
  });
});
