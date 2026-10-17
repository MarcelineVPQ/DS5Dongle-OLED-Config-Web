// @vitest-environment jsdom
// Reading the game launchers is turned off in Games → Home → Launchers, the
// place it acts on (IA audit Q5; App settings → Privacy links there). It is a
// switch that asks first and says nothing is deleted, never a one-click
// button (one made the whole library vanish at one click); turning it back on
// is the first-visit consent; Games then says the library comes back.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamesPage from "../../src/desktop/pages/GamesPage";
import { GameLaunchersSetting, useGamesAllowed } from "../../src/desktop/library/GameLaunchersSetting";

// The switch, as Games → Launchers shows it (with the consent read).
function Privacy() {
  const allowed = useGamesAllowed();
  return allowed === null ? null : createElement(GameLaunchersSetting, { allowed });
}
import { EMPTY_LIBRARY } from "../../src/desktop/games/library";
import type { GamesReport } from "../../src/desktop/games/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let allowed = true;
let writes: boolean[] = [];

const report: GamesReport = {
  ourProton: { name: null, latest: null, latestSize: null, updateAvailable: false },
  launchers: [],
  games: [],
  system: { audioProfile: null, proAudio: false, proAudioRules: [], envWarnings: [], hidrawAccess: null, hdr: {} as GamesReport["system"]["hdr"], fixes: [] },
  scannedAt: "2026-10-13T00:00:00Z",
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  allowed = true;
  writes = [];
  vi.stubGlobal("desktop", {
    platform: "win32",
    getSettings: () => Promise.resolve({ gamesScanAllowed: allowed }),
    setSetting: (key: string, value: boolean) => {
      if (key === "gamesScanAllowed") {
        allowed = value;
        writes.push(value);
      }
      return Promise.resolve({ gamesScanAllowed: allowed });
    },
    gamesScan: () => Promise.resolve(report),
    gamesBackups: () => Promise.resolve([]),
    gamesDetails: () => Promise.resolve({}),
    onProtonProgress: () => () => undefined,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const text = () => container!.textContent ?? "";
const buttons = () => [...container!.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string) => buttons().find((b) => b.textContent === label);
const toggle = () => container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
const click = (b: HTMLElement | undefined) => act(() => b!.click());

describe("game launchers opt-out", () => {
  it("Games → Launchers has Rescan and the switch (no one-click button that turns reading off)", async () => {
    const page = (on: boolean) =>
      createElement(GamesPage, {
        allowed: on,
        onAllowedChange: () => undefined,
        bridge: {} as never,
        profiles: { library: EMPTY_LIBRARY, setLibrary: () => undefined, running: null } as never,
      });
    act(() => root!.render(page(true)));
    await settle();
    // Rescan is in Launchers.
    click(container!.querySelector<HTMLButtonElement>('[data-section="launchers"] .dk-sec-toggle')!);
    expect(button(i18n.t("desktop.games.rescan"))).toBeTruthy();
    expect(buttons().some((b) => /stop/i.test(b.textContent ?? ""))).toBe(false);
    expect(container!.querySelector('[data-section="launchers"] [role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    // Off asks first, in the section.
    click(container!.querySelector<HTMLButtonElement>('[data-section="launchers"] [role="switch"]')!);
    expect(writes).toEqual([]);
    expect(container!.querySelector('[data-section="launchers"] [role="alert"]')!.textContent).toContain(i18n.t("desktop.games.readLaunchersOff"));
    // Off: the consent card, saying the library comes back once allowed.
    act(() => root!.render(page(false)));
    expect(text()).toContain(i18n.t("desktop.games.consentLibrary"));
    expect(button(i18n.t("desktop.games.consentAllow"))).toBeTruthy();
  });

  it("asks before turning it off, and Cancel keeps it on", async () => {
    act(() => root!.render(createElement(Privacy)));
    await settle();
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(text()).toContain("Steam, GOG Galaxy and Epic");
    click(toggle());
    expect(writes).toEqual([]);
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain(i18n.t("desktop.games.readLaunchersOff"));
    click(button(i18n.t("desktop.common.cancel")));
    expect(writes).toEqual([]);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  it("turns off after confirming, and back on with one click", async () => {
    const heard: boolean[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent<boolean>).detail);
    window.addEventListener("ds5:games-allowed", listen);
    act(() => root!.render(createElement(Privacy)));
    await settle();
    click(toggle());
    click(button(i18n.t("desktop.games.readLaunchersTurnOff")));
    await settle();
    expect(writes).toEqual([false]);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    click(toggle());
    await settle();
    expect(writes).toEqual([false, true]);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(heard).toEqual([false, true]); // Games hears both at once
    window.removeEventListener("ds5:games-allowed", listen);
  });
});
