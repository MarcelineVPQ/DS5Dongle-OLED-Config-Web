// @vitest-environment jsdom
// The rail's Games badge leads to the change it counts (a real case,
// 2026-10-17: a badge "1" whose tooltip said only "1 recommended change",
// Library's "Games that need setup" said 0, and Games → Home's panel was
// hidden; the change was the controller's volume, not a game's). Now:
//   - the press opens Games → Home with the panel shown, Recommended changes
//     open, scrolled to and focused, from another page and from Games itself;
//   - the tooltip names the change;
//   - Library counts games and this computer's changes apart, adding up to
//     the badge; This computer's chip opens Recommended changes too;
//   - Recommended changes groups by game, then This computer.
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamesPage from "../../src/desktop/pages/GamesPage";
import AppRail, { railSelect, type RailItem } from "../../src/desktop/AppRail";
import { railReminders, type NoticeTask } from "../../src/desktop/notices";
import { openTasks } from "../../src/desktop/openTasks";
import { waitingChanges } from "../../src/desktop/library/waiting";
import { revealSection } from "../../src/desktop/accordion/useAccordion";
import { PANEL_HIDDEN_KEY } from "../../src/desktop/accordion/Section";
import type { Fix, GamesReport } from "../../src/desktop/games/types";
import { fakeBridge } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.localStorage.clear();
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
const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...container.querySelectorAll<T>(sel)];

// Her case: the controller's volume, a change for this computer only.
const VOLUME: Fix = {
  id: "system:audio-volume:fa4e5004",
  kind: "audio-volume",
  launcher: "system",
  label: { key: "label.audioVolumeSaved" },
  why: { key: "why.audioVolume" },
  files: [],
  recommended: true,
};
const VOLUME_LABEL = i18n.t("desktop.games.msg.label.audioVolumeSaved");
function volumeReport(): GamesReport {
  const r = homeReport("healthy");
  return { ...r, system: { ...r.system, fixes: [VOLUME] } };
}

// The app as DesktopApp wires it: the rail with the open tasks' dots, its
// press through railSelect, and goTo's link to the section (the Games page
// mounted only while it's the page shown).
function app(report: GamesReport, active: RailItem, gamesShown: boolean) {
  const tasks: NoticeTask[] = openTasks(i18n.t, {
    app: { phase: "up-to-date", version: "1.0.0" },
    fw: { available: false, latest: null, state: { phase: "idle" } as never },
    connected: true,
    board: [],
    games: waitingChanges(report, new Set()),
  }).tasks;
  const go = vi.fn((item: RailItem, section?: string) => {
    if (item === "games" && section) revealSection("games", section as never);
  });
  const rail = createElement(AppRail, {
    active,
    onSelect: (pressed: RailItem) => railSelect(pressed, active, tasks, go),
    gamesSupported: true,
    reminders: railReminders(tasks),
    connected: true,
    connecting: false,
    firmware: null,
    deviceLabel: "Pico 2 W",
    device: "Pico 2 W",
  });
  const page = createElement(GamesPage, {
    allowed: true,
    onAllowedChange: () => undefined,
    bridge: fakeBridge(),
    profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
  });
  return { tree: createElement(Fragment, null, gamesShown ? page : null, rail), go };
}
async function show(report: GamesReport, active: RailItem, gamesShown = true) {
  vi.stubGlobal("desktop", homeDesktop("healthy", [], report));
  const a = app(report, active, gamesShown);
  act(() => root.render(a.tree));
  await settle();
  await settle();
  return a;
}
const games = () => $<HTMLButtonElement>('[data-rail="games"]')!;
const panelHidden = () => $(".dk-split")!.classList.contains("panel-hidden");
const recommended = () => $('[data-section="recommended"]')!;

describe("the rail's Games badge", () => {
  it("names the change in its tooltip, on the badge and on the rail item", async () => {
    await show(volumeReport(), "controller", false);
    const badge = games().querySelector(".rail-badge")!;
    expect(badge.textContent).toBe("1");
    expect(badge.getAttribute("title")).toBe(`Recommended: ${VOLUME_LABEL}`);
    expect(games().title).toContain(`Recommended: ${VOLUME_LABEL}`);
  });

  it("on Games → Home with the panel hidden: the press shows it, Recommended changes open with the change, focused", async () => {
    localStorage.setItem(PANEL_HIDDEN_KEY("games"), "1");
    const { go } = await show(volumeReport(), "games");
    expect(panelHidden()).toBe(true);
    act(() => games().click());
    await settle();
    expect(go).toHaveBeenCalledWith("games", "recommended");
    expect(panelHidden()).toBe(false);
    expect(recommended().classList.contains("open")).toBe(true);
    expect(recommended().querySelector(".dk-sec-body")!.textContent).toContain(VOLUME_LABEL);
    expect(document.activeElement).toBe(recommended().querySelector(".dk-sec-toggle"));
    // The change is this computer's, not a game's.
    expect(recommended().querySelector('[data-fix-group="pc"] h3')!.textContent).toBe(i18n.t("desktop.games.systemTitle"));
  });

  it("from another page: Games opens with its panel shown at Recommended changes (a hidden panel too)", async () => {
    localStorage.setItem(PANEL_HIDDEN_KEY("games"), "1");
    const { go } = await show(volumeReport(), "controller", false);
    act(() => games().click());
    expect(go).toHaveBeenCalledWith("games", "recommended");
    // DesktopApp shows the Games page; the link waits for it.
    const shown = app(volumeReport(), "games", true);
    act(() => root.render(shown.tree));
    await settle();
    await settle();
    expect(panelHidden()).toBe(false);
    expect(recommended().classList.contains("open")).toBe(true);
    expect(recommended().textContent).toContain(VOLUME_LABEL);
  });

  it("the place already on screen, or no task: the press on the page you're on still shows / hides the panel", async () => {
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{}] as unknown as DOMRectList);
    const { go } = await show(volumeReport(), "games");
    act(() => games().click()); // the section isn't open yet: the press opens it
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(recommended().classList.contains("open")).toBe(true);
    act(() => games().click()); // now on screen: the press hides the panel, as always
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(panelHidden()).toBe(true);
    // Nothing waiting: a plain toggle.
    act(() => root.render(null));
    const healthy = await show(homeReport("healthy"), "games");
    const before = panelHidden();
    act(() => games().click());
    await settle();
    expect(healthy.go).not.toHaveBeenCalled();
    expect(panelHidden()).toBe(!before);
  });
});

describe("Library's counts", () => {
  it("her case: Games that need setup 0, This computer 1 change: together the badge's 1; the chip opens Recommended changes", async () => {
    localStorage.setItem(PANEL_HIDDEN_KEY("games"), "1");
    await show(volumeReport(), "games");
    const filters = $$<HTMLButtonElement>(".lib-toolbar .lib-filters .dk-chip").map((c) => c.textContent);
    expect(filters).toContain(`${i18n.t("desktop.library.filters.attention")}0`);
    const pc = $<HTMLButtonElement>(".lib-toolbar .lib-pc")!;
    expect(pc.textContent).toBe("This computer: 1 change");
    expect(pc.title).toBe(i18n.t("desktop.library.pcChangesHint"));
    expect(games().querySelector(".rail-badge")!.textContent).toBe("1");
    act(() => pc.click());
    await settle();
    expect(panelHidden()).toBe(false);
    expect(recommended().classList.contains("open")).toBe(true);
  });

  it("games and this computer apart, adding up to the badge; Recommended changes groups by game, then This computer", async () => {
    const r = volumeReport();
    const steamInput = (i: number): Fix => ({
      id: `steam:input:${i}`,
      kind: "steam-input-off",
      launcher: "steam",
      label: { key: "label.steamInput", params: { game: r.games[i].title } },
      why: { key: "why.steamInput", params: { support: "x" } },
      files: [],
      recommended: true,
    });
    r.games[0] = { ...r.games[0], fixes: [steamInput(0)] };
    r.games[3] = { ...r.games[3], fixes: [steamInput(3), { ...steamInput(3), id: "steam:hdr:3", label: { key: "label.hdr", params: { game: r.games[3].title } } }] };
    await show(r, "games");
    const filters = $$<HTMLButtonElement>(".lib-toolbar .lib-filters .dk-chip").map((c) => c.textContent);
    expect(filters).toContain(`${i18n.t("desktop.library.filters.attention")}2`);
    expect($(".lib-toolbar .lib-pc")!.textContent).toBe("This computer: 1 change");
    expect(games().querySelector(".rail-badge")!.textContent).toBe("3");
    expect(games().querySelector(".rail-badge")!.getAttribute("title")).toBe(`Recommended: Turn Steam Input off for ${r.games[0].title}; ${r.games[3].title}: 2 changes; ${VOLUME_LABEL}`);
    expect(recommended().querySelector(".dk-sec-status")!.textContent).toBe("2 games · This computer: 1 change");
    act(() => games().click());
    await settle();
    expect($$("[data-fix-group] h3").map((h) => h.textContent)).toEqual([r.games[0].title, r.games[3].title, i18n.t("desktop.games.systemTitle")]);
  });
});
