// @vitest-environment jsdom
// The one Notice component's ×, the rail's dots following the task (not the
// dismissal) and App settings → Dismissed notices.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import Notice from "../../src/desktop/Notice";
import AppRail from "../../src/desktop/AppRail";
import DismissedNotices from "../../src/desktop/DismissedNotices";
import UpdateBanners from "../../src/desktop/UpdateBanners";
import { ActionFailed, useGameAction } from "../../src/desktop/library/playBar";
import type { GameEntry } from "../../src/desktop/games/types";
import { NoticeTasksContext, dismissNotice, railReminders, restoreNotices, type NoticeTask } from "../../src/desktop/notices";
import { openTasks, type TaskInput } from "../../src/desktop/openTasks";
import type { UpdateState } from "../../src/desktop/api";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import ja from "../../src/i18n/locales/ja.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  window.localStorage.clear();
  restoreNotices("all");
  await i18n.changeLanguage("en");
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
const render = (el: React.ReactElement) => act(() => root.render(el));
const x = () => container.querySelector<HTMLButtonElement>(".dk-notice-x");
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);

describe("the notice's ×", () => {
  it("is a small button in the corner, named and titled Dismiss, reachable with the keyboard", () => {
    render(createElement(Notice, { closable: true, children: "Info" }));
    const b = x()!;
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("aria-label")).toBe("Dismiss");
    expect(b.title).toBe("Dismiss");
    expect(b.tabIndex).toBe(0);
    b.focus();
    expect(document.activeElement).toBe(b);
    act(() => b.click());
    expect(container.textContent).toBe("");
  });

  it("says Dismiss in all 7 languages", () => {
    for (const locale of [de, en, es, fr, ja, ptBR, zhCN]) expect(locale.notice.dismiss).toBeTruthy();
  });

  it("an action's error is cleared by its owner (so a new failure shows again); no × on a write in progress", () => {
    const onDismiss = vi.fn();
    render(createElement(Notice, { error: true, onDismiss, children: "Failed" }));
    act(() => x()!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
    render(createElement(Notice, { children: "Updating firmware, don't unplug" }));
    expect(x()).toBeNull();
  });

  it("a task stays dismissed across restarts until its reason changes", () => {
    render(createElement(Notice, { dismissKey: "firmware-update:v1", children: "Firmware v1 is available" }));
    act(() => x()!.click());
    expect(container.textContent).toBe("");
    act(() => root.unmount());
    root = createRoot(container);
    render(createElement(Notice, { dismissKey: "firmware-update:v1", children: "Firmware v1 is available" }));
    expect(container.textContent).toBe("");
    render(createElement(Notice, { dismissKey: "firmware-update:v2", children: "Firmware v2 is available" }));
    expect(container.textContent).toBe("Firmware v2 is available");
  });

  it("a failed app install shows again when the next try fails too", () => {
    vi.stubGlobal("desktop", { platform: "linux", getFirmwareHold: () => Promise.resolve({ writing: false, restartQueued: false, quitQueued: false }), onFirmwareHold: () => () => undefined });
    const fw = { state: { phase: "idle" }, dismiss: () => undefined, available: false, latest: null, problem: null, backToStable: false } as unknown as FirmwareUpdate;
    const banner = (app: UpdateState) => render(createElement(UpdateBanners, { app, fw, onShowFirmware: () => undefined, onFirmwareChanges: () => undefined }));
    const failed: UpdateState = { phase: "failed", detail: "The download stopped.", during: "install" };
    banner(failed);
    act(() => x()!.click());
    expect(container.textContent).not.toContain("The download stopped");
    banner({ phase: "downloading", version: "1.0.0", got: 0, total: 1 });
    banner(failed);
    expect(container.textContent).toContain("The download stopped");
  });
});

describe("a launcher action that failed", () => {
  it("stays said until dismissed (it used to vanish after 6 s)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("desktop", { platform: "linux", gameAction: () => Promise.resolve(false) });
      let run: ((a: "play") => Promise<void>) | null = null;
      function Probe() {
        const action = useGameAction({ key: "steam:1" } as GameEntry);
        run = action.run;
        return createElement(ActionFailed, { action: action.failed, onDismiss: action.clearFailed });
      }
      render(createElement(Probe));
      await act(async () => {
        const done = run!("play");
        await vi.advanceTimersByTimeAsync(10_000);
        await done;
      });
      expect(container.textContent).toBe(i18n.t("desktop.library.action.failed"));
      act(() => x()!.click());
      expect(container.textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the rail's dots", () => {
  const rail = (tasks: NoticeTask[]) =>
    render(
      createElement(AppRail, {
        active: "controller",
        onSelect: () => undefined,
        gamesSupported: true,
        reminders: railReminders(tasks),
        connected: true,
        connecting: false,
        firmware: "v0.9.5-dev.11",
        deviceLabel: "Pico 2 W",
        device: "Pico 2 W",
      }),
    );
  const dot = (item: string) => container.querySelector(`[data-rail="${item}"] .rail-badge`);
  const withUpdate = (available: boolean): TaskInput => ({
    app: { phase: "up-to-date", version: "1.0.0" },
    fw: { available, latest: { version: "v0.9.5-dev.12" }, state: { phase: "idle" } },
    connected: true,
    board: [],
    gamesCount: 2,
  });

  it("follow the task, not the dismissal: dismissed, the dot stays; done, it goes by itself", () => {
    vi.stubGlobal("desktop", { platform: "linux" });
    rail(openTasks(i18n.t, withUpdate(true)).tasks);
    expect(dot("dongle")?.classList.contains("dot")).toBe(true);
    expect(dot("dongle")?.getAttribute("title")).toBe(i18n.t("desktop.update.fwAvailable", { version: "v0.9.5-dev.12" }));
    expect(container.querySelector('[data-rail="dongle"]')!.getAttribute("title")).toContain("Firmware v0.9.5-dev.12 is available");
    expect(dot("games")?.textContent).toBe("2");
    expect(dot("app")).toBeNull();
    act(() => dismissNotice("firmware-update:v0.9.5-dev.12"));
    rail(openTasks(i18n.t, withUpdate(true)).tasks);
    expect(dot("dongle")).not.toBeNull();
    rail(openTasks(i18n.t, withUpdate(false)).tasks);
    expect(dot("dongle")).toBeNull();
  });
});

describe("App settings → Dismissed notices", () => {
  const tasks: NoticeTask[] = [
    { id: "firmware-update", place: "dongle", text: "Firmware v2 is available for Pico 2 W.", key: "firmware-update:v2" },
    { id: "app-update", place: "app", section: "updates", text: "App update 1.0.0 is available (1.0 MB).", key: "app-update:1.0.0" },
    { id: "games-setup", place: "games", text: "2 changes waiting", count: 2 },
  ];
  const goTo = vi.fn();
  const list = () => render(createElement(NoticeTasksContext.Provider, { value: { tasks, goTo } }, createElement(DismissedNotices, { device: "Pico 2 W" })));

  it("says so when nothing is dismissed", () => {
    list();
    expect(container.textContent).toContain("No dismissed notices.");
  });

  it("lists the dismissed notices that still apply, with the place to act and Show again", () => {
    act(() => {
      dismissNotice("firmware-update:v2");
      dismissNotice("app-update:1.0.0");
      dismissNotice("firmware-update:v1"); // no longer applies: not listed
    });
    list();
    const rows = [...container.querySelectorAll(".dk-dismissed")].map((r) => r.querySelector("span")!.textContent);
    expect(rows).toEqual(["Firmware v2 is available for Pico 2 W.", "App update 1.0.0 is available (1.0 MB)."]);
    // The board's page by its name ("Go to Pico 2 W"); the app update opens App settings → Updates.
    const go = button("Pico 2 W")!;
    expect(go.title).toBe("Go to Pico 2 W");
    act(() => go.click());
    expect(goTo).toHaveBeenCalledWith("dongle", undefined);
    act(() => button("App settings")!.click());
    expect(goTo).toHaveBeenCalledWith("app", "updates");
    act(() => button("Show again")!.click());
    expect(container.querySelectorAll(".dk-dismissed")).toHaveLength(1);
    act(() => button("Show all again")!.click());
    expect(container.textContent).toContain("No dismissed notices.");
  });

  it("is translated in all 7 languages, without 'dongle'", () => {
    for (const locale of [de, en, es, fr, ja, ptBR, zhCN]) {
      const n = locale.desktop.notices as Record<string, string>;
      for (const k of ["dismissedTitle", "none", "showAgain", "showAllAgain", "goTo"]) {
        expect(n[k]).toBeTruthy();
        expect(n[k]).not.toMatch(/dongle/i);
      }
      expect(n.goTo).toContain("{{place}}");
    }
  });
});
