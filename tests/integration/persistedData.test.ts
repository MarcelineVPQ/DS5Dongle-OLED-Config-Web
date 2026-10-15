// @vitest-environment jsdom
// Error pass, batch E1: a damaged file of the app's own never silently
// starts empty. For every JSON the app keeps between starts (settings.json,
// the game library and the older apps' library in the main process; the
// page's dismissed notices, pinned sections, pairing slots' controllers,
// controller colors and unticked Games changes): what still reads is kept,
// the damaged copy is kept aside, what loaded is written back, and the
// notice says what happened and where the copy is, in plain words.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recovered } from "../../src/persisted";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "ds5-persisted-"));
  localStorage.clear();
  vi.resetModules(); // a fresh "said once" list per test
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  rmSync(userData, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The notice as the page shows it: `files` is what the main process reports
// over desktop:recovered-files; the page's own preferences come from its own
// module (a fresh one, as the page is its own process).
async function noticeText(files: Recovered[] = [], beforeRender?: () => Promise<void>): Promise<string> {
  vi.resetModules();
  const known: Record<string, unknown> = { recoveredFiles: async () => files };
  // Anything else the page's modules ask at load: subscriptions do nothing, calls answer {}.
  vi.stubGlobal("desktop", new Proxy(known, { get: (t, p: string) => (p in t ? t[p] : /^on[A-Z]/.test(p) ? () => () => undefined : () => Promise.resolve({})) }));
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  await beforeRender?.();
  const RecoveredNotice = (await import("../../src/desktop/RecoveredNotice")).default;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(RecoveredNotice)));
  await act(async () => undefined);
  return container.textContent ?? "";
}

const corruptFiles = (prefix: string) => readdirSync(userData).filter((f) => f.startsWith(`${prefix}.corrupt-`));
const corruptKeys = (key: string) => Object.keys(localStorage).filter((k) => k.startsWith(`${key}.corrupt-`));
const STAMP = /\.corrupt-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/;

describe("settings.json", () => {
  it("a damaged setting goes back to its default, the others are kept, the copy is kept and the notice says so", async () => {
    const raw = JSON.stringify({ closeToTray: false, narratorVoice: "loud", updateChannel: "dev" });
    writeFileSync(join(userData, "settings.json"), raw);
    const { loadSettings, DEFAULT_SETTINGS } = await import("../../electron/main/settings");
    const { recoveredHere } = await import("../../src/persisted");
    const s = loadSettings();
    expect(s.closeToTray).toBe(false);
    expect(s.updateChannel).toBe("dev");
    expect(s.narratorVoice).toBe(DEFAULT_SETTINGS.narratorVoice);
    const [copy] = corruptFiles("settings.json");
    expect(copy).toMatch(STAMP);
    expect(readFileSync(join(userData, copy), "utf8")).toBe(raw);
    // Written back: the next start (and the two more reads at start) read clean, said once.
    expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"))).toEqual(s);
    expect(loadSettings()).toEqual(s);
    const files = recoveredHere();
    expect(files).toEqual([{ kind: "settings", kept: join(userData, copy), partial: true }]);
    const text = await noticeText(files);
    expect(text).toContain(`Your app settings had damaged parts. Those went back to their defaults, and everything else was kept. The damaged copy is saved as ${join(userData, copy)}.`);
    expect(text).not.toMatch(/dongle/i);
  });

  it("a file that isn't JSON at all: the defaults, the copy kept, and the notice says it starts from the defaults", async () => {
    writeFileSync(join(userData, "settings.json"), '{"closeToTray": fal');
    const { loadSettings, DEFAULT_SETTINGS } = await import("../../electron/main/settings");
    const { recoveredHere } = await import("../../src/persisted");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const [copy] = corruptFiles("settings.json");
    expect(readFileSync(join(userData, copy), "utf8")).toBe('{"closeToTray": fal');
    const text = await noticeText(recoveredHere());
    expect(text).toContain(`Your app settings couldn't be read (it was damaged), so it starts from the defaults. The damaged copy is saved as ${join(userData, copy)}.`);
  });

  it("a good file, or a setting from a newer app, is not damage: no copy, no notice", async () => {
    writeFileSync(join(userData, "settings.json"), JSON.stringify({ closeToTray: false, someNewerSetting: 3 }));
    const { loadSettings } = await import("../../electron/main/settings");
    const { recoveredHere } = await import("../../src/persisted");
    expect(loadSettings().closeToTray).toBe(false);
    expect(corruptFiles("settings.json")).toEqual([]);
    expect(recoveredHere()).toEqual([]);
    expect(await noticeText(recoveredHere())).toBe("");
  });

  it("no file yet (the first start) is not damage either", async () => {
    const { loadSettings, DEFAULT_SETTINGS } = await import("../../electron/main/settings");
    const { recoveredHere } = await import("../../src/persisted");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(readdirSync(userData)).toEqual([]);
    expect(recoveredHere()).toEqual([]);
  });

  it("a copy that can't be made: the original is left as it is and the notice says so", async () => {
    writeFileSync(join(userData, "settings.json"), "{ broken");
    // A copy from the same second already there (COPYFILE_EXCL never overwrites it): stands in for a full disk.
    const { corruptStamp } = await import("../../src/persisted");
    vi.useFakeTimers({ now: new Date("2026-10-14T09:30:00Z"), toFake: ["Date"] });
    writeFileSync(join(userData, `settings.json.corrupt-${corruptStamp()}`), "an earlier copy");
    const { loadSettings, DEFAULT_SETTINGS } = await import("../../electron/main/settings");
    const { recoveredHere } = await import("../../src/persisted");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    vi.useRealTimers();
    expect(readFileSync(join(userData, "settings.json"), "utf8")).toBe("{ broken");
    const text = await noticeText(recoveredHere());
    expect(text).toContain("Your app settings couldn't be read, so the defaults are used for now. The damaged data was left where it is.");
  });
});

describe("the game library", () => {
  it("game-library-2.json: the copy kept and the notice names what's in it and where the copy is", async () => {
    writeFileSync(join(userData, "game-library-2.json"), "{ not json");
    const { LibraryStore } = await import("../../electron/main/games/libraryStore");
    const { recoveredHere } = await import("../../src/persisted");
    expect(new LibraryStore(userData).get().games).toEqual({});
    const [copy] = corruptFiles("game-library-2.json");
    const text = await noticeText(recoveredHere());
    expect(text).toContain(
      `Your game library (game profiles, button layouts, ratings and notes) couldn't be read (it was damaged), so it starts from the defaults. The damaged copy is saved as ${join(userData, copy)}.`,
    );
  });

  it("the older apps' game-library.json: left untouched, and the notice says it's where it was", async () => {
    writeFileSync(join(userData, "game-library.json"), "{ not json");
    const { LibraryStore } = await import("../../electron/main/games/libraryStore");
    const { recoveredHere } = await import("../../src/persisted");
    new LibraryStore(userData);
    expect(readFileSync(join(userData, "game-library.json"), "utf8")).toBe("{ not json");
    const text = await noticeText(recoveredHere());
    expect(text).toContain(
      `The game library from the earlier app version couldn't be read (it was damaged), so it starts from the defaults. The damaged copy is saved as ${join(userData, "game-library.json")}.`,
    );
  });
});

// The page's own JSON preferences: each read through the same helper.
const PREFS: Array<{ name: string; key: string; raw: string; read: () => Promise<unknown>; expected: unknown; clean: unknown; what: string }> = [
  {
    name: "dismissed notices",
    key: "ds5.dismissedNotices",
    raw: '["firmware-update:v1", 7, "app-update:2"]',
    read: async () => (await import("../../src/desktop/notices")).parseDismissed(localStorage.getItem("ds5.dismissedNotices")),
    expected: ["firmware-update:v1", "app-update:2"],
    clean: ["firmware-update:v1", "app-update:2"],
    what: "The list of notices you dismissed",
  },
  {
    name: "pinned sections",
    key: "ds5.accordion.pins.app",
    raw: '["appearance", {"x": 1}]',
    read: async () => (await import("../../src/desktop/accordion/useAccordion")).readPins("app"),
    expected: ["appearance"],
    clean: ["appearance"],
    what: "Your pinned sections",
  },
  {
    name: "pairing slots' controllers",
    key: "ds5.slotControllers",
    raw: '{"AA:BB:CC:DD:EE:FF": {"model": "edge", "colorway": "00"}, "11:22:33:44:55:66": {"model": "toaster"}}',
    read: async () => (await import("../../src/desktop/pages/SlotsPage")).readMemory(),
    expected: { "AA:BB:CC:DD:EE:FF": { model: "edge", colorway: "00" } },
    clean: { "AA:BB:CC:DD:EE:FF": { model: "edge", colorway: "00" } },
    what: "The app's memory of which controller is in each pairing slot",
  },
  {
    name: "controller colors",
    key: "ds5.customColors",
    raw: '{"body": "#112233", "cap": "teal"}',
    read: async () => (await import("../../src/desktop/live/customColors")).parseCustomColors(localStorage.getItem("ds5.customColors")),
    expected: { body: "#112233" },
    clean: { body: "#112233" },
    what: "Your controller's colors",
  },
  {
    name: "unticked Games changes",
    key: "ds5-games-declined",
    raw: '["proton-ge", null]',
    read: async () => [...(await import("../../src/desktop/pages/GamesPage")).loadDeclined()],
    expected: ["proton-ge"],
    clean: ["proton-ge"],
    what: "The Games changes you unticked",
  },
];

describe("the page's stored preferences", () => {
  for (const p of PREFS) {
    it(`${p.name}: keeps what reads, keeps the damaged copy, writes back, and says so`, async () => {
      localStorage.setItem(p.key, p.raw);
      const text = await noticeText([], async () => {
        expect(await p.read()).toEqual(p.expected);
      });
      const [copy] = corruptKeys(p.key);
      expect(copy).toMatch(STAMP);
      expect(localStorage.getItem(copy)).toBe(p.raw);
      expect(JSON.parse(localStorage.getItem(p.key)!)).toEqual(p.clean);
      expect(text).toContain(`${p.what} had damaged parts. Those went back to their defaults, and everything else was kept. The damaged copy is saved as ${copy}.`);
    });

    it(`${p.name}: not JSON at all starts from the defaults and says so`, async () => {
      localStorage.setItem(p.key, "{ cut off");
      const text = await noticeText([], async () => {
        await p.read();
      });
      const [copy] = corruptKeys(p.key);
      expect(localStorage.getItem(copy)).toBe("{ cut off");
      expect(text).toContain(`${p.what} couldn't be read (it was damaged), so it starts from the defaults. The damaged copy is saved as ${copy}.`);
    });
  }

  it("a good preference is read as it is, with no copy and no notice", async () => {
    localStorage.setItem("ds5.dismissedNotices", '["a:1"]');
    const text = await noticeText([], async () => {
      expect((await import("../../src/desktop/notices")).parseDismissed(localStorage.getItem("ds5.dismissedNotices"))).toEqual(["a:1"]);
    });
    expect(corruptKeys("ds5.dismissedNotices")).toEqual([]);
    expect(text).toBe("");
  });

  it("the notice closes with its ×", async () => {
    localStorage.setItem("ds5.customColors", "[1]");
    const text = await noticeText([], async () => {
      (await import("../../src/desktop/live/customColors")).parseCustomColors(localStorage.getItem("ds5.customColors"));
    });
    expect(text).toContain("Your controller's colors couldn't be read");
    act(() => container!.querySelector<HTMLButtonElement>(".dk-notice-x")!.click());
    expect(container!.textContent).toBe("");
  });
});
