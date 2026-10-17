// @vitest-environment jsdom
// Dismissable notices (src/desktop/notices.ts) and the open tasks behind the
// rail's dots (src/desktop/openTasks.ts): keys by reason, pruning, persistence.
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import type { UpdateState } from "../../src/desktop/api";
import { DISMISSED_KEY, MAX_DISMISSED, dismissNotice, noticeIdOf, noticeKey, parseDismissed, pruneDismissed, pruneStored, railReminders, restoreNotices } from "../../src/desktop/notices";
import { appUpdateKey, firmwareUpdateKey, openTasks, type TaskInput } from "../../src/desktop/openTasks";
import { boardProblems } from "../../src/desktop/dongle/core1Status";
import { CORE1_MIC_FAILED, CORE1_SPEAKER_FAILED, type AudioCounters } from "../../src/protocol/bridgeClient";

const stored = () => parseDismissed(window.localStorage.getItem(DISMISSED_KEY));
const t = i18n.t.bind(i18n);
const idle = { phase: "idle" } as const;
const input = (over: Partial<TaskInput>): TaskInput => ({
  app: { phase: "up-to-date", version: "0.9.5-dev.11" },
  fw: { available: false, latest: { version: "v0.9.5-dev.11" }, state: idle },
  connected: true,
  board: [],
  ...over,
});

beforeEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("notice keys", () => {
  it("are the notice's id plus its reason", () => {
    expect(noticeKey("firmware-update", "v0.9.5-dev.12")).toBe("firmware-update:v0.9.5-dev.12");
    expect(noticeIdOf("firmware-update:v0.9.5-dev.12")).toBe("firmware-update");
    expect(noticeIdOf("app-update:ready:1.0.0")).toBe("app-update");
    expect(firmwareUpdateKey("v0.9.5-dev.12")).toBe("firmware-update:v0.9.5-dev.12");
  });

  it("change when the reason changes: a new app version, then installed and waiting for a restart", () => {
    const available: UpdateState = { phase: "available", version: "1.0.0", size: 1 };
    expect(appUpdateKey(available)).toBe("app-update:1.0.0");
    expect(appUpdateKey({ ...available, version: "1.0.1" })).toBe("app-update:1.0.1");
    expect(appUpdateKey({ phase: "manual", version: "1.0.0", detail: "" })).toBe("app-update:1.0.0");
    expect(appUpdateKey({ phase: "ready", version: "1.0.0" })).toBe("app-update:ready:1.0.0");
    expect(appUpdateKey({ phase: "downloading", version: "1.0.0", got: 0, total: 1 })).toBeNull();
  });

  it("name the board problem, so a different problem shows again", () => {
    const c = (extra: Partial<AudioCounters>) => ({ core1Loops: 5, ...extra }) as AudioCounters;
    expect(boardProblems(t, c({}), true)).toEqual([]);
    expect(boardProblems(t, c({ core1Flags: CORE1_SPEAKER_FAILED }), true).map((p) => p.reason)).toEqual(["speaker-encoder"]);
    expect(boardProblems(t, c({ core1Flags: CORE1_SPEAKER_FAILED | CORE1_MIC_FAILED }), true).map((p) => p.reason)).toEqual(["speaker-encoder", "mic-decoder"]);
    expect(boardProblems(t, c({ core1Stage: 4 }), false).map((p) => p.reason)).toEqual(["core1-stopped:4"]);
    expect(boardProblems(t, c({}), false)[0].text).not.toMatch(/dongle/i);
  });
});

describe("the dismissed list", () => {
  it("is kept across restarts (local storage) and only holds keys", () => {
    dismissNotice("firmware-update:v1");
    dismissNotice("firmware-update:v1");
    dismissNotice("app-update:2.0.0");
    expect(JSON.parse(window.localStorage.getItem(DISMISSED_KEY)!)).toEqual(["firmware-update:v1", "app-update:2.0.0"]);
  });

  it("reads anything broken as nothing dismissed, and stays bounded", () => {
    expect(parseDismissed("{not json")).toEqual([]);
    expect(parseDismissed('{"a":1}')).toEqual([]);
    expect(parseDismissed('["a:1", 2, null, "b:2"]')).toEqual(["a:1", "b:2"]);
    const many = Array.from({ length: MAX_DISMISSED + 10 }, (_, i) => `x:${i}`);
    expect(parseDismissed(JSON.stringify(many))).toHaveLength(MAX_DISMISSED);
  });

  it("Show again takes one key out; Show all again empties it", () => {
    dismissNotice("a:1");
    dismissNotice("b:1");
    restoreNotices(["a:1"]);
    expect(stored()).toEqual(["b:1"]);
    restoreNotices("all");
    expect(stored()).toEqual([]);
  });
});

describe("pruning", () => {
  it("drops a key whose reason no longer applies and keeps one whose state isn't known yet", () => {
    const keys = ["firmware-update:v1", "app-update:1.0.0", "board-audio:speaker-encoder"];
    const settled = new Map([
      ["firmware-update", ["firmware-update:v2"]], // a newer version: v1's dismissal is stale
      ["board-audio", ["board-audio:speaker-encoder"]], // still there
    ]);
    expect(pruneDismissed(keys, settled)).toEqual(["app-update:1.0.0", "board-audio:speaker-encoder"]);
    expect(pruneDismissed(keys, new Map([["app-update", []]]))).toEqual(["firmware-update:v1", "board-audio:speaker-encoder"]);
  });

  it("writes the stored list only when something goes", () => {
    dismissNotice("firmware-update:v1");
    pruneStored(new Map([["app-update", []]]));
    expect(stored()).toEqual(["firmware-update:v1"]);
    pruneStored(new Map([["firmware-update", []]]));
    expect(stored()).toEqual([]);
  });
});

describe("open tasks", () => {
  it("none when everything is done; what's known says so for pruning", () => {
    const { tasks, settled } = openTasks(t, input({}));
    expect(tasks).toEqual([]);
    expect(settled.get("app-update")).toEqual([]);
    expect(settled.get("firmware-update")).toEqual([]);
    expect(settled.get("board-audio")).toEqual([]);
  });

  it("an app update waits on App settings, a firmware update and a board problem on the board's page", () => {
    const { tasks } = openTasks(
      t,
      input({
        app: { phase: "available", version: "1.0.0", size: 2 * 1048576 },
        fw: { available: true, latest: { version: "v0.9.5-dev.12" }, state: idle },
        board: [{ reason: "speaker-encoder", text: "speaker" }],
        games: {
          games: [
            { key: "a", title: "Astro Bot", labels: [{ key: "label.steamInput", params: { game: "Astro Bot" } }] },
            { key: "b", title: "Returnal", labels: [{ key: "label.hdr", params: { game: "Returnal" } }] },
          ],
          pc: [{ key: "label.audioVolumeSaved" }],
        },
      }),
    );
    expect(tasks.map((x) => [x.place, x.key ?? null])).toEqual([
      ["app", "app-update:1.0.0"],
      ["dongle", "firmware-update:v0.9.5-dev.12"],
      ["dongle", "board-audio:speaker-encoder"],
      ["games", null],
    ]);
    expect(tasks[1].text).toBe(t("desktop.update.fwAvailable", { version: "v0.9.5-dev.12" }));
    // The count: each game with a change waiting plus each of this computer's; the text names them.
    expect(tasks[3]).toMatchObject({ count: 3, section: "recommended" });
    expect(tasks[3].text).toBe("Recommended: Turn Steam Input off for Astro Bot; Turn on HDR for Returnal; Keep the controller's volume and microphone level at full when it reconnects");
  });

  it("keeps dismissals while a state isn't known (checking, no board, a firmware write)", () => {
    const { settled } = openTasks(t, input({ app: { phase: "checking" }, connected: false, fw: { available: false, latest: null, state: idle }, board: null }));
    expect(settled.size).toBe(0);
    const writing = openTasks(t, input({ fw: { available: true, latest: { version: "v2" }, state: { phase: "verifying", version: "v2" } } }));
    expect(writing.tasks.find((x) => x.id === "firmware-update")).toBeUndefined();
    expect(writing.settled.has("firmware-update")).toBe(false);
  });
});

describe("the rail's dots", () => {
  it("a plain dot per rail item, Games' count as a number, tooltips listing what's waiting", () => {
    const r = railReminders([
      { id: "firmware-update", place: "dongle", text: "Firmware v2 is available" },
      { id: "board-audio", place: "dongle", text: "Core1 stopped" },
      { id: "games-setup", place: "games", text: "2 changes", count: 2 },
    ]);
    expect(r.dongle).toEqual({ count: null, tip: "Firmware v2 is available\nCore1 stopped" });
    expect(r.games).toEqual({ count: 2, tip: "2 changes" });
    expect(r.app).toBeUndefined();
  });
});
