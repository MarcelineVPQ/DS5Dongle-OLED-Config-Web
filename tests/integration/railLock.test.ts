// @vitest-environment jsdom
// The rail's lock (AppRail.tsx, BACKLOG "Rail lock"): a small button in the
// rail's bottom corner locks the rail collapsed (the `locked` class turns the
// hover / focus expansion off in desktop.css) and shows a lock; a second click
// unlocks it. Remembered; Keep open and the lock exclude each other.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import AppRail, { RAIL_LOCK_KEY } from "../../src/desktop/AppRail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  window.localStorage.clear();
  vi.stubGlobal("desktop", { platform: "linux" });
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const rail = () =>
  act(() =>
    root.render(
      createElement(AppRail, {
        active: "controller",
        onSelect: () => undefined,
        gamesSupported: true,
        reminders: {},
        connected: true,
        connecting: false,
        firmware: null,
        deviceLabel: "Pico 2 W",
        device: "Pico 2 W",
      }),
    ),
  );
const lock = () => container.querySelector<HTMLButtonElement>(".rail-lock")!;
const nav = () => container.querySelector<HTMLElement>(".app-rail")!;
const keepOpen = () => container.querySelector<HTMLButtonElement>(".rail-pin")!;

describe("the rail's lock", () => {
  it("locks the rail collapsed and unlocks it again; tooltips say what a click does; remembered", () => {
    rail();
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    expect(lock().title).toBe(i18n.t("desktop.rail.lock"));
    expect(lock().getAttribute("aria-label")).toBe(lock().title);
    expect(nav().classList.contains("locked")).toBe(false);
    act(() => lock().click());
    expect(nav().classList.contains("locked")).toBe(true);
    expect(lock().getAttribute("aria-pressed")).toBe("true");
    expect(lock().title).toBe(i18n.t("desktop.rail.unlock"));
    expect(localStorage.getItem(RAIL_LOCK_KEY)).toBe("1");
    // Across restarts.
    act(() => root.unmount());
    root = createRoot(container);
    rail();
    expect(nav().classList.contains("locked")).toBe(true);
    act(() => lock().click());
    expect(nav().classList.contains("locked")).toBe(false);
    expect(localStorage.getItem(RAIL_LOCK_KEY)).toBe("0");
  });

  it("Keep open and the lock exclude each other (also Ctrl+B)", () => {
    rail();
    act(() => keepOpen().click());
    expect(container.querySelector(".rail-slot")!.classList.contains("pinned")).toBe(true);
    act(() => lock().click());
    expect(container.querySelector(".rail-slot")!.classList.contains("pinned")).toBe(false);
    expect(nav().classList.contains("locked")).toBe(true);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true })));
    expect(container.querySelector(".rail-slot")!.classList.contains("pinned")).toBe(true);
    expect(nav().classList.contains("locked")).toBe(false);
  });

  it("is a keyboard-reachable button, named in every language", () => {
    rail();
    lock().focus();
    expect(document.activeElement).toBe(lock());
    // loop: test fixture
    for (const lang of ["de", "en", "es", "fr", "ja", "pt-BR", "zh-CN"]) {
      const locale = JSON.parse(readFileSync(resolve(`src/i18n/locales/${lang}.json`), "utf8")) as { desktop: { rail: Record<string, string>; accordion: Record<string, string> } };
      expect(locale.desktop.rail.lock, lang).toBeTruthy();
      expect(locale.desktop.rail.unlock, lang).toBeTruthy();
      // loop: test fixture
      for (const k of ["menu", "collapseAll", "collapseAllTip", "nothingOpen", "clearPins", "clearPinsTip", "noPins"]) expect(locale.desktop.accordion[k], `${lang} ${k}`).toBeTruthy();
    }
  });

  it("turns the hover and focus expansion off while locked (every rule that expands it)", () => {
    const css = readFileSync(resolve("src/desktop/desktop.css"), "utf8");
    // loop: test fixture
    const expanding = css.split("\n").filter((l) => /\.app-rail[^{]*(:hover|:has\(:focus-visible\))/.test(l));
    expect(expanding.length).toBeGreaterThan(0);
    // loop: test fixture
    for (const l of expanding) expect(l, l).toMatch(/\.locked/);
  });
});

// The pin's tooltip names the shortcut as the platform writes it (bug hunt D6,
// 0.9.5: macOS said Ctrl+B, though ⌘B is the one that works there).
describe("the pin's shortcut", () => {
  it.each([
    ["linux", "Ctrl+B", "Control+B"],
    ["win32", "Ctrl+B", "Control+B"],
    ["darwin", "⌘B", "Meta+B"],
  ])("%s: %s", (platform, shown, aria) => {
    vi.stubGlobal("desktop", { platform });
    rail();
    expect(keepOpen().title).toBe(`${i18n.t("desktop.rail.pin")} (${shown})`);
    expect(keepOpen().getAttribute("aria-keyshortcuts")).toBe(aria);
  });
});
