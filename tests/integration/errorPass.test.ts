// @vitest-environment jsdom
// The error pass (CLAUDE.md "Error pass", docs/ERROR_PASS_2026-10.md): no
// silent failure. Each fix here was an action that failed with nothing on
// screen; each test fails the old way and passes now.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { BAD_REQUEST, type UpdateState } from "../../src/desktop/api";
import { causeText, clearShownError, shown, useShownError } from "../../src/desktop/shownError";
import { logged } from "../../src/errorText";
import { CommandError } from "../../src/protocol/bridgeClient";
import { BusyButton, Toggle } from "../../src/desktop/controls";
import { GAMES_ALLOWED_EVENT, setGamesAllowed } from "../../src/desktop/games/consent";
import { useDebouncedSave } from "../../src/desktop/library/useDebouncedSave";
import UpdateBanners from "../../src/desktop/UpdateBanners";
import GamesPage from "../../src/desktop/pages/GamesPage";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";
import { fakeBridge } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
// Opens an accordion section (left open if it is).
const openSection = (id: string) => {
  const head = document.querySelector<HTMLButtonElement>(`[data-section="${id}"] .dk-sec-toggle`)!;
  if (head.getAttribute("aria-expanded") !== "true") act(() => head.click());
};

let container: HTMLDivElement;
let root: Root;
let notice: string | null = null;
// The app's one shown-error notice, as DesktopApp renders it.
function NoticeProbe() {
  const message = useShownError();
  useEffect(() => void (notice = message));
  return null;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  clearShownError();
  notice = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));

describe("plain words for a failure", () => {
  it("takes Electron's IPC wrapper off the main process's message", () => {
    expect(causeText(new Error("Error invoking remote method 'desktop:games-scan': Error: Steam's settings couldn't be read."))).toBe("Steam's settings couldn't be read.");
  });

  it("says a refused request plainly (Apply's ids failing the schema showed nothing, then a raw ZodError)", () => {
    const plain = i18n.t("desktop.errors.badRequest");
    expect(causeText(new Error(`Error invoking remote method 'desktop:games-apply': Error: ${BAD_REQUEST}`))).toBe(plain);
    expect(causeText(new Error('Error invoking remote method \'desktop:games-apply\': ZodError: [ { "code": "invalid_format" } ]'))).toBe(plain);
  });

  it("says what a board command's result means, not 'Command 0x04 failed'", () => {
    expect(causeText(new CommandError(0x04, "failed"))).toBe(i18n.t("desktop.errors.boardFailed"));
    expect(causeText(new CommandError(0x04, "busy"))).toBe(i18n.t("desktop.errors.boardBusy"));
    expect(causeText(new CommandError(0x13, "invalid"))).toBe(i18n.t("desktop.errors.boardRejected"));
    expect(causeText(new CommandError(0x04, "failed"))).not.toMatch(/0x04|dongle/i);
  });

  it("shown() puts the message on the app's notice and logs the cause; logged() only logs, with its reason", () => {
    act(() => root.render(createElement(NoticeProbe)));
    act(() => shown("desktop.errors.layoutSave")(new Error("disk full")));
    expect(notice).toBe(i18n.t("desktop.errors.layoutSave"));
    expect(console.warn).toHaveBeenCalledWith("desktop.errors.layoutSave:", "disk full");
    act(() => clearShownError());
    logged("the tray icon")(new Error("no canvas"));
    expect(notice).toBeNull();
    expect(console.warn).toHaveBeenCalledWith("the tray icon:", "no canvas");
  });
});

describe("controls never swallow a failure", () => {
  it("BusyButton: an action that rejects is shown (it was dropped: 'the caller reports its own errors')", async () => {
    act(() =>
      root.render(
        createElement("div", null, [
          createElement(NoticeProbe, { key: "n" }),
          createElement(BusyButton, { key: "b", onClick: () => Promise.reject(new Error("Error invoking remote method 'desktop:setup-usb-access': Error: pkexec is missing")), children: "Set up" }),
        ]),
      ),
    );
    act(() => button("Set up")!.click());
    await settle();
    expect(notice).toBe(i18n.t("desktop.errors.actionFailed", { reason: "pkexec is missing" }));
    expect(button("Set up")!.disabled).toBe(false); // never stuck busy
  });

  it("Toggle: a change that rejects is shown", async () => {
    act(() =>
      root.render(
        createElement("div", null, [
          createElement(NoticeProbe, { key: "n" }),
          createElement(Toggle, { key: "t", label: "Launch at login", value: false, onChange: () => Promise.reject(new Error("read-only")) }),
        ]),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("button, [role=switch], input")!.click());
    await settle();
    expect(notice).toBe(i18n.t("desktop.errors.actionFailed", { reason: "read-only" }));
  });
});

describe("settings and saves that fail say so", () => {
  it("Games consent: the window hears the change only once it's saved; a failed save changes nothing", async () => {
    const heard: boolean[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent<boolean>).detail);
    window.addEventListener(GAMES_ALLOWED_EVENT, listen);
    try {
      vi.stubGlobal("desktop", { setSetting: () => Promise.reject(new Error("The setting gamesScanAllowed couldn't be saved")) });
      await expect(setGamesAllowed(false)).rejects.toThrow("couldn't be saved");
      expect(heard).toEqual([]); // the library didn't vanish while the setting stayed on
      vi.stubGlobal("desktop", { setSetting: () => Promise.resolve({}) });
      await setGamesAllowed(false);
      expect(heard).toEqual([false]);
    } finally {
      window.removeEventListener(GAMES_ALLOWED_EVENT, listen);
    }
  });

  it("a game's debounced save that fails is shown (it was voided)", async () => {
    const handle: { set: ((v: number) => void) | null } = { set: null };
    function Saver() {
      const s = useDebouncedSave<number>(0, () => Promise.reject(new Error("disk full")), 5);
      useEffect(() => void (handle.set = s.set));
      return null;
    }
    act(() => root.render(createElement("div", null, [createElement(NoticeProbe, { key: "n" }), createElement(Saver, { key: "s" })])));
    act(() => handle.set!(1));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(notice).toBe(i18n.t("desktop.errors.librarySave"));
  });
});

describe("the update banner", () => {
  const fw = { state: { phase: "idle" }, dismiss: () => undefined, available: false, latest: null, problem: null, backToStable: false } as unknown as FirmwareUpdate;
  const renderBanner = (app: UpdateState) => act(() => root.render(createElement(UpdateBanners, { app, fw, onShowFirmware: () => undefined, onFirmwareChanges: () => undefined })));

  it("says a failed Download and install until dismissed (the banner used to just disappear)", () => {
    vi.stubGlobal("desktop", { platform: "linux", getFirmwareHold: () => Promise.resolve({ writing: false, restartQueued: false, quitQueued: false }), onFirmwareHold: () => () => undefined });
    renderBanner({ phase: "failed", detail: "The download stopped. Your current version is untouched.", during: "install" });
    expect(container.textContent).toContain(i18n.t("desktop.update.appFailed", { detail: "The download stopped. Your current version is untouched." }));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("notice.dismiss")}"]`)!.click());
    expect(container.textContent).not.toContain("The download stopped");
  });

  it("stays quiet for a scheduled check that failed (offline): that's not something the user did", () => {
    vi.stubGlobal("desktop", { platform: "linux", getFirmwareHold: () => Promise.resolve({ writing: false, restartQueued: false, quitQueued: false }), onFirmwareHold: () => () => undefined });
    renderBanner({ phase: "failed", detail: "Couldn't check for updates: offline" });
    expect(container.textContent).toBe("");
  });
});

describe("Games → Home", () => {
  async function renderHome(overrides: Record<string, unknown>) {
    const report = homeReport("attention");
    const base = homeDesktop("attention", [], report);
    vi.stubGlobal("desktop", new Proxy(overrides, { get: (t, p: string) => (p in t ? t[p] : (base as Record<string, unknown>)[p]) }));
    act(() =>
      root.render(
        createElement(GamesPage, {
          allowed: true,
          onAllowedChange: () => undefined,
          bridge: fakeBridge(),
          profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
        }),
      ),
    );
    await settle();
    await settle();
  }

  it("Apply refused by the main process's request check says so in plain words (it showed nothing)", async () => {
    await renderHome({ gamesApply: () => Promise.reject(new Error(`Error invoking remote method 'desktop:games-apply': Error: ${BAD_REQUEST}`)) });
    openSection("recommended");
    act(() => button(i18n.t("desktop.games.review", { count: 1 }))!.click());
    await settle();
    act(() => button(i18n.t("desktop.games.apply", { count: 1 }))!.click());
    await settle();
    await settle();
    expect(container.textContent).toContain(i18n.t("desktop.errors.badRequest"));
  });

  it("Undo: a failed audio service restart is said (it was dropped)", async () => {
    await renderHome({ gamesUndo: () => Promise.resolve({ ok: true, restored: [], audioRestartFailed: "wpctl: not found" }) });
    openSection("history");
    const history = container.querySelector('[data-section="history"] .dk-sec-body')!;
    act(() => [...history.querySelectorAll("button")].find((b) => b.textContent === i18n.t("desktop.games.undoShort"))!.click());
    await settle();
    await settle();
    expect(container.textContent).toContain(i18n.t("desktop.games.undoAudioRestart", { error: "wpctl: not found" }));
  });
});

describe("Games → Home, Undo that fails", () => {
  it("keeps Undo's error on screen after the rescan (it vanished at once)", async () => {
    const report = homeReport("healthy");
    const base = homeDesktop("healthy", [], report) as Record<string, unknown>;
    const overrides: Record<string, unknown> = { gamesUndo: () => Promise.resolve({ ok: false, error: "Couldn't restore config.vdf: permission denied" }) };
    vi.stubGlobal("desktop", new Proxy(overrides, { get: (t, p: string) => (p in t ? t[p] : base[p]) }));
    act(() =>
      root.render(
        createElement(GamesPage, {
          allowed: true,
          onAllowedChange: () => undefined,
          bridge: fakeBridge(),
          profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
        }),
      ),
    );
    await settle();
    await settle();
    openSection("history");
    const history = container.querySelector('[data-section="history"] .dk-sec-body')!;
    act(() => [...history.querySelectorAll("button")].find((b) => b.textContent === i18n.t("desktop.games.undoShort"))!.click());
    await settle();
    await settle();
    expect(container.textContent).toContain("Couldn't restore config.vdf: permission denied");
  });
});

describe("Controller info", () => {
  it("Refresh with Sony unreachable says so (the line was left blank)", async () => {
    const { Ds5BridgeClient } = await import("../../src/protocol/bridgeClient");
    const { FakeDongle } = await import("../support/fakeDongle");
    const { default: ControllerInfo, useControllerInfo } = await import("../../src/desktop/live/ControllerInfo");
    const client = new Ds5BridgeClient(new FakeDongle({ protoMinor: 17 }));
    await client.checkCompatible();
    const identity = await client.identity();
    vi.stubGlobal("desktop", { platform: "linux", officialControllerFirmware: () => Promise.reject(new Error("offline")) });
    const bridge = { client, identity } as never;
    // The Controller page keeps the read (useControllerInfo); the section shows it.
    const Info = () => createElement(ControllerInfo, { data: useControllerInfo(bridge), power: null });
    act(() => root.render(createElement(Info)));
    for (let i = 0; i < 100 && !container.textContent?.includes(i18n.t("desktop.ctrlInfo.built")); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(container.textContent).not.toContain(i18n.t("desktop.ctrlInfo.officialUnavailable")); // an automatic check stays quiet
    act(() => button(i18n.t("desktop.ctrlInfo.refresh"))!.click());
    for (let i = 0; i < 100 && !container.textContent?.includes(i18n.t("desktop.ctrlInfo.officialUnavailable")); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(container.textContent).toContain(i18n.t("desktop.ctrlInfo.officialUnavailable"));
  });
});

describe("a game's page", () => {
  it("Delete profile that fails is shown (it was voided)", async () => {
    const { default: GamePage } = await import("../../src/desktop/library/GamePage");
    const { fakeDesktop, gamesReport, ghostrunner, GHOSTRUNNER_INFO, GHOSTRUNNER_RECORD, HDR_READY } = await import("../support/gamePage");
    const game = ghostrunner();
    const base = fakeDesktop("linux");
    vi.stubGlobal("desktop", new Proxy({ libraryDeleteProfile: () => Promise.reject(new Error("disk full")) } as Record<string, unknown>, { get: (t, p: string) => (p in t ? t[p] : base[p]) }));
    act(() =>
      root.render(
        createElement("div", null, [
          createElement(NoticeProbe, { key: "n" }),
          createElement(GamePage, {
            key: "g",
            game,
            info: GHOSTRUNNER_INFO,
            record: GHOSTRUNNER_RECORD,
            running: false,
            report: gamesReport(game, HDR_READY),
            bridge: fakeBridge(),
            onLibrary: () => undefined,
            onRescan: () => undefined,
          }),
        ]),
      ),
    );
    await settle();
    openSection("profile");
    act(() => button(i18n.t("desktop.library.profileDelete"))!.click());
    await settle();
    expect(notice).toBe(i18n.t("desktop.errors.profileDelete"));
  });
});
