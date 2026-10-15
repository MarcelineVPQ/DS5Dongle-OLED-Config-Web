// @vitest-environment jsdom
// Games → Home, like every page: the library (Continue playing, the Library
// with its filters, sort and grid) is the main view, and game setup is the
// accordion at the right: Launchers, DualSense Proton, This computer,
// Recommended changes (the rail's count: its yellow dot) and Change history.
// Each section says its state in its header; what needs the player carries a
// yellow dot; a folded section renders nothing. Every function stays one
// click away. The rail's Games count opens Recommended changes, from a game
// page too.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamesPage from "../../src/desktop/pages/GamesPage";
import { homeStatus } from "../../src/desktop/library/setupStatus";
import { continueCount } from "../../src/desktop/library/ContinuePlaying";
import type { GameInfo, GamesReport } from "../../src/desktop/games/types";
import { fakeBridge, HDR_NO_LAYER, OUR_PROTON } from "../support/gamePage";
import { HOME_BACKUP, homeDesktop, homeDetails, homeLibrary, homeReport, STEAM_DEFAULT_FIX, type HomeCase } from "../support/gamesHome";
import { GLASS_KEY } from "../../src/desktop/glass/glassPref";
import { revealSection } from "../../src/desktop/accordion/useAccordion";
import { revealBlock } from "../../src/desktop/accordion/MainBlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
// The Glass look's bars rebuild their filter on resize (useLiquidGlass).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let calls: string[] = [];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.localStorage.clear();
  calls = [];
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
async function render(kase: HomeCase, report: GamesReport = homeReport(kase), over: Record<string, unknown> = {}) {
  const desktop = homeDesktop(kase, calls, report);
  vi.stubGlobal("desktop", new Proxy(over, { get: (t, p: string) => (p in t ? t[p] : desktop[p]) }));
  act(() =>
    root!.render(
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
const $ = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...container!.querySelectorAll<T>(sel)];
const button = (label: string, within: ParentNode = container!) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
const click = async (el: HTMLElement | undefined) => {
  act(() => el!.click());
  await settle();
};
const sectionIds = () => $$(".dk-sec").map((x) => x.dataset.section);
const openIds = () => $$(".dk-sec.open").map((x) => x.dataset.section);
// A section, or a main-view block (This computer: a readout, MainBlock).
const place = (id: string) => `:is([data-section="${id}"], .dk-split-main [data-block="${id}"])`;
const status = (id: string) => $(`${place(id)} .dk-sec-status`)?.textContent;
const hasDot = (id: string) => !!$(`${place(id)} .dk-sec-task`);
// Opens a section or block (left open if it is) and gives its body.
const open = async (id: string) => {
  const head = $<HTMLButtonElement>(`${place(id)} .dk-sec-toggle`);
  if (head && head.getAttribute("aria-expanded") !== "true") await click(head); // a block is always open
  return $(`${place(id)} :is(.dk-sec-body, .dk-block-body)`)!;
};
const linux = () => vi.stubGlobal("desktop", { platform: "linux" });

describe("homeStatus", () => {
  it("healthy: nothing needs the player", () => {
    linux();
    expect(homeStatus(homeReport("healthy"), new Set())).toEqual({ attention: false, fixes: false, proton: false, system: false, hdr: false });
  });

  it("a recommended change needs the player, one the player declined doesn't", () => {
    linux();
    const r = homeReport("attention");
    expect(homeStatus(r, new Set()).fixes).toBe(true);
    expect(homeStatus(r, new Set([STEAM_DEFAULT_FIX.id])).fixes).toBe(false);
  });

  it("Proton missing or a newer build, and each system ✗, need the player", () => {
    linux();
    const r = homeReport("healthy");
    expect(homeStatus({ ...r, ourProton: { ...r.ourProton, name: null } }, new Set()).proton).toBe(true);
    expect(homeStatus({ ...r, ourProton: { ...r.ourProton, latest: "GE-Proton11-8-DualSense", updateAvailable: true } }, new Set()).proton).toBe(true);
    expect(homeStatus({ ...r, system: { ...r.system, proAudio: true } }, new Set()).system).toBe(true);
    expect(homeStatus({ ...r, system: { ...r.system, hidrawAccess: false } }, new Set()).system).toBe(true);
    expect(homeStatus({ ...r, system: { ...r.system, envWarnings: [{ variable: "SDL_JOYSTICK_HIDAPI", file: null }] } }, new Set()).system).toBe(true);
  });

  it("an HDR ✗ matters only with an HDR game in the library", () => {
    linux();
    const r = homeReport("attention");
    expect(homeStatus(r, new Set()).hdr).toBe(true);
    const noHdrGame = { ...r, games: r.games.map((g) => ({ ...g, hdr: undefined })) };
    expect(homeStatus(noHdrGame, new Set()).hdr).toBe(false);
    expect(homeStatus({ ...homeReport("healthy"), system: { ...homeReport("healthy").system, hdr: { ...HDR_NO_LAYER } } }, new Set()).hdr).toBe(true);
  });

  it("Windows: no Proton, system or HDR parts", () => {
    vi.stubGlobal("desktop", { platform: "win32" });
    const r = homeReport("windows");
    expect(homeStatus({ ...r, system: { ...r.system, proAudio: true, hidrawAccess: false } }, new Set())).toEqual({ attention: false, fixes: false, proton: false, system: false, hdr: false });
  });

  it("Continue playing: one big tile and up to two beside it, or a 2 × 2 block", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(continueCount)).toEqual([0, 1, 2, 3, 3, 5, 5]);
  });
});

describe("Games → Home, healthy", () => {
  it("the library is the main view; game setup is the accordion at the right, each section saying its state", async () => {
    await render("healthy");
    expect($(".dk-split-main .lib-grid")).not.toBeNull();
    expect($(".dk-split-main .lib-continue")).not.toBeNull();
    expect($(".dk-split-head h2")!.textContent).toBe(i18n.t("desktop.games.title"));
    expect($(".dk-split-sub")!.textContent).toBe(i18n.t("desktop.games.allGood"));
    expect(sectionIds()).toEqual(["launchers", "proton", "recommended", "history"]);
    // This computer is a readout: a block at the top of the main view, always shown (no fold).
    expect($(".dk-split-main .lib-home-pane > [data-block='computer']")).not.toBeNull();
    expect($(".dk-split-panel [data-block]")).toBeNull();
    expect($(`${place("computer")} .dk-block-toggle`)).toBeNull();
    expect($$(".dk-block-body")).toHaveLength(1);
    expect($$(".dk-card")).toHaveLength(0);
    // Nothing needs the player: no dots, nothing open, nothing rendered in the sections.
    expect($$(".dk-sec-task")).toHaveLength(0);
    expect(openIds()).toEqual([]);
    expect($$(".dk-sec-body")).toHaveLength(0);
    expect(status("launchers")).toBe("Steam · Heroic · Lutris");
    expect(status("proton")).toBe(OUR_PROTON);
    expect(status("computer")).toContain("on for DP-5");
    expect(status("recommended")).toBe(i18n.t("desktop.games.nothingToChange"));
    expect(status("history")).toBe(i18n.t("desktop.games.historyStatus", { count: 1, date: new Date("2026-10-12T19:30:00Z").toLocaleDateString() }));
  });

  it("every function is in its section: launchers with Rescan, Proton, This computer with HDR, history with Undo", async () => {
    await render("healthy");
    const launchers = await open("launchers");
    expect(launchers.textContent).toContain(i18n.t("desktop.games.intro"));
    expect(launchers.textContent).toContain("Steam · closed · our Proton is the default");
    expect(button(i18n.t("desktop.games.rescan"), launchers)).toBeTruthy();
    expect((await open("proton")).textContent).toContain(`${OUR_PROTON} ${i18n.t("desktop.games.protonFound")}`);
    const computer = await open("computer");
    // The HDR checklist is always shown (no fold): every item passing, one compact line.
    expect(computer.querySelector("details")).toBeNull();
    expect(computer.querySelector(".hdr-row .hdr-check.compact")).toBeTruthy();
    expect(computer.querySelector(".hdr-fail")).toBeNull();
    expect((await open("recommended")).textContent).toContain(i18n.t("desktop.games.allGood"));
    const history = await open("history");
    await click(button(i18n.t("desktop.games.undoShort"), history));
    expect(calls).toContain("gamesUndo b1");
    // One section open at a time; each fact once.
    expect(openIds()).toEqual(["history"]);
    await click($<HTMLButtonElement>('[data-section="history"] .dk-sec-toggle')!);
    expect($$(".dk-sec-body")).toHaveLength(0);
  });

  it("a backup that can't be read is listed as damaged, with its folder and no Undo (error pass E2)", async () => {
    const damaged = { id: "20261015T123456Z-abcdef", created: "2026-10-15T12:34:56Z", changes: [], files: [], damaged: "~/.config/app/game-setup-backups/20261015T123456Z-abcdef" };
    await render("healthy", homeReport("healthy"), { gamesBackups: () => Promise.resolve([HOME_BACKUP, damaged]) });
    const history = await open("history");
    expect(history.textContent).toContain(i18n.t("desktop.games.historyDamaged"));
    expect(history.querySelector(".dk-file")!.textContent).toBe(damaged.damaged);
    expect([...history.querySelectorAll("button")].filter((b) => b.textContent === i18n.t("desktop.games.undoShort"))).toHaveLength(1);
  });

  it("Rescan scans again", async () => {
    await render("healthy");
    const before = calls.filter((c) => c === "gamesScan").length;
    await click(button(i18n.t("desktop.games.rescan"), await open("launchers")));
    expect(calls.filter((c) => c === "gamesScan").length).toBe(before + 1);
  });

  it("Continue playing: the newest big with its stats, Play on every tile, a tile opens the game", async () => {
    await render("healthy");
    const tiles = $$(".lib-continue-tile");
    expect(tiles.length).toBe(5);
    expect(tiles[0].classList.contains("lead")).toBe(true);
    expect(tiles[0].querySelector(".lib-continue-art")!.getAttribute("title")).toBe("Cyberpunk 2077");
    expect(tiles[0].textContent).toContain(i18n.t("desktop.library.lastPlayed"));
    expect(tiles.every((t) => button(`▶ ${i18n.t("desktop.library.action.play")}`, t))).toBe(true);
    await click(button(`▶ ${i18n.t("desktop.library.action.play")}`, tiles[1]));
    expect(calls.some((c) => c.startsWith("gameAction play ") && c.includes(":1000"))).toBe(true); // Astro Bot
    await click(tiles[0].querySelector<HTMLButtonElement>(".lib-continue-art")!);
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(true);
    expect($(".gp")).toBeTruthy();
    await click(button(`⌂ ${i18n.t("desktop.library.home")}`));
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(false);
  });

  it("Library: the filters carry the counts; filtering shows in the grid and the rail, Show all clears it", async () => {
    await render("healthy");
    expect($(".lib-summary")).toBeNull();
    const chips = $$<HTMLButtonElement>(".lib-toolbar .lib-filters .dk-chip").map((c) => c.textContent);
    expect(chips).toEqual(["All30", "With profile5", "DualSense14", "Needs attention0"]);
    expect($$(".lib-grid > li").length).toBe(30);
    expect($(".lib-side .lib-filters")).toBeNull(); // the rail is the index: search and the list
    await click($$<HTMLButtonElement>(".lib-toolbar .lib-filters .dk-chip")[1]);
    expect($$(".lib-grid > li").length).toBe(5);
    expect($(".lib-filtered")!.textContent).toContain(i18n.t("desktop.library.filteredBy", { filter: i18n.t("desktop.library.filters.profile") }));
    await click(button(i18n.t("desktop.library.showAll")));
    expect($(".lib-filtered")).toBeNull();
    expect($$(".lib-grid > li").length).toBe(30);
    expect($(".lib-toolbar select.dk-select")).toBeTruthy();
  });

  it("search narrows the counts, the grid and the list together", async () => {
    await render("healthy");
    const search = $<HTMLInputElement>(".lib-search")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "ghost");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect($$(".lib-grid > li").length).toBe(2);
    expect($$(".lib-list .lib-row").length).toBe(2);
    expect($$(".lib-toolbar .dk-chip")[0].textContent).toBe("All2");
  });
});

describe("Games → Home, needs attention", () => {
  it("Recommended changes carries the rail's count as its dot, This computer its HDR ✗", async () => {
    await render("attention");
    expect($(".dk-split-sub")!.textContent).toBe(i18n.t("desktop.games.needsAttention"));
    expect(hasDot("recommended")).toBe(true);
    expect(status("recommended")).toBe(i18n.t("desktop.games.attention", { count: 1 }));
    expect(hasDot("computer")).toBe(true);
    expect(hasDot("launchers")).toBe(false);
    expect(hasDot("proton")).toBe(false);
    // The change, ticked, with Review; the launchers say Steam is running.
    const changes = await open("recommended");
    expect(changes.textContent).toContain(i18n.t("desktop.games.msg.label.defaultSteam", { proton: OUR_PROTON, interpolation: { escapeValue: false } }));
    expect(changes.querySelector<HTMLInputElement>(".dk-fix input")!.checked).toBe(true);
    expect((await open("launchers")).textContent).toContain("Steam · running");
    // HDR ✗: the checklist one item per line (not compact), the ✗ highlighted.
    const hdr = (await open("computer")).querySelector(".hdr-row")!;
    expect(hdr.querySelector(".dk-bad")).not.toBeNull();
    expect(hdr.querySelector(".hdr-check.compact")).toBeNull();
    expect(hdr.querySelector(".hdr-fail")!.textContent).toContain("✗");
  });

  it("a link to This computer shows Home and opens it, from a game page too", async () => {
    await render("attention");
    await click($$<HTMLButtonElement>(".lib-row")[0]);
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(true);
    act(() => revealBlock("games", "computer"));
    await settle();
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(false);
    expect($(`${place("computer")} .dk-block-body .hdr-row`)).not.toBeNull();
  });

  it("the rail's count opens Recommended changes, from a game page too", async () => {
    await render("attention");
    await click($$<HTMLButtonElement>(".lib-row")[0]);
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(true);
    act(() => revealSection("games", "recommended"));
    await settle();
    expect($<HTMLElement>(".lib-pane")!.hidden).toBe(false);
    expect(openIds()).toEqual(["recommended"]);
    expect($(".gp")).toBeNull();
  });

  it("Review → Apply says Steam will be closed and reopened", async () => {
    await render("attention");
    await click(button(i18n.t("desktop.games.review", { count: 1 }), await open("recommended")));
    await settle();
    const body = await open("recommended");
    expect(body.textContent).toContain(i18n.t("desktop.games.reviewTitle"));
    expect(body.textContent).toContain(i18n.t("desktop.games.willRestart", { launcher: "Steam" }));
    expect(button(i18n.t("desktop.games.apply", { count: 1 }), body)).toBeTruthy();
    // Folded and opened again, the review is where it was.
    await click($<HTMLButtonElement>('[data-section="recommended"] .dk-sec-toggle')!);
    expect((await open("recommended")).textContent).toContain(i18n.t("desktop.games.reviewTitle"));
  });

  it("unticking the change keeps it (and the dot) until the next scan", async () => {
    await render("attention");
    const box = (await open("recommended")).querySelector<HTMLInputElement>(".dk-fix input")!;
    act(() => box.click());
    await settle();
    expect($('[data-section="recommended"] .dk-fix input')).toBe(box);
    expect(box.checked).toBe(false);
    expect(hasDot("recommended")).toBe(true);
  });

  it("a missing Proton carries a dot and offers Install; the install still confirms first", async () => {
    const r = homeReport("healthy");
    await render("healthy", { ...r, ourProton: { name: null, latest: OUR_PROTON, latestSize: 400e6, updateAvailable: true } });
    expect(hasDot("proton")).toBe(true);
    expect(status("proton")).toBe(i18n.t("desktop.games.protonNotInstalled"));
    const proton = await open("proton");
    await click(button(i18n.t("desktop.games.protonInstall", { name: OUR_PROTON }), proton));
    expect(calls).not.toContain("installProton");
    await click(button(i18n.t("desktop.games.protonGo")));
    expect(calls).toContain("installProton");
  });
});

describe("Games → Home, Windows", () => {
  it("launchers, changes and history; no Proton, This computer or HDR anywhere", async () => {
    await render("windows");
    expect(sectionIds()).toEqual(["launchers", "recommended", "history"]);
    for (const name of ["Steam", "GOG Galaxy", "Epic Games"]) expect(status("launchers")).toContain(name);
    const text = container!.textContent!;
    expect(text).not.toContain(i18n.t("desktop.games.protonTitle"));
    expect(text).not.toContain(i18n.t("desktop.games.systemTitle"));
    expect($(".hdr-check")).toBeNull();
    expect($$(".lib-continue-tile").length).toBe(5);
  });
});

describe("Games → Home, art and the Glass look", () => {
  // Cyberpunk 2077 (Heroic, GOG) was played last: the big tile.
  const LEAD = "heroic-0000abcd:gog:1001";
  const withArt = (art: GameInfo["art"]) => {
    const r = homeReport("healthy");
    const details = homeDetails(r.games);
    details[LEAD] = { ...details[LEAD], art };
    return { gamesDetails: () => Promise.resolve(details), gameArtColor: () => Promise.resolve("#c31646") };
  };
  const leadArt = () => $(".lib-continue-tile.lead .lib-continue-art")!;
  // The game page follows the theme for its art-color accent.
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })));

  it("a Heroic GOG game without hero art: the big tile shows its cover, whole on the art-color gradient (the game page's lookup)", async () => {
    await render("healthy", homeReport("healthy"), withArt(["cover", "icon"]));
    const art = leadArt();
    expect(art.classList.contains("tall")).toBe(true);
    expect(art.style.getPropertyValue("--gp-art")).toBe(`url("ds5-art://art/${encodeURIComponent(LEAD)}/cover?w=320")`);
    expect(art.style.getPropertyValue("--art-color")).toBe("#c31646");
    expect(art.textContent).toContain("Cyberpunk 2077"); // no logo without the hero: the title
    // Its page's header falls back the same way.
    await click(art);
    const header = $(".gp-hero")!;
    expect(header.classList.contains("tall")).toBe(true);
    expect(header.style.getPropertyValue("--gp-art")).toContain("/cover");
  });

  it("with hero art the big tile shows it wide; with none, the gradient alone", async () => {
    await render("healthy", homeReport("healthy"), withArt(["hero", "cover"]));
    expect(leadArt().classList.contains("wide")).toBe(true);
    expect(leadArt().style.getPropertyValue("--gp-art")).toContain("/hero");
    act(() => root!.unmount());
    root = createRoot(container!);
    await render("healthy", homeReport("healthy"), withArt(["header"]));
    expect(leadArt().style.getPropertyValue("--gp-art")).toContain("/header");
  });

  it("the glass captions only in the Glass look", async () => {
    await render("healthy");
    expect($$(".lib-glass").length).toBe(0);
    expect($(".lib-continue-tile")!.getAttribute("style")).toBeNull();
    act(() => root!.unmount());
    root = createRoot(container!);
    window.localStorage.setItem(GLASS_KEY, "1");
    await render("healthy");
    expect($$(".lib-continue-tile.lib-glass").length).toBe(5);
    expect($$(".lib-grid .lib-tile.lib-glass").length).toBe(30);
    // The caption tokens: tint, its opacity and the ink.
    expect($(".lib-continue-tile")!.style.getPropertyValue("--cap-ink")).toMatch(/^rgb\(/);
    expect($(".lib-grid .lib-tile")!.style.getPropertyValue("--cap-alpha")).toMatch(/^\d+%$/);
  });
});

describe("Games' Show menu (the app kinds) is a popup on top", () => {
  it("opens in the top layer, placed under its button", async () => {
    const shown = vi.fn();
    // jsdom has no Popover API: record the request for the top layer.
    HTMLElement.prototype.showPopover = shown;
    const report = homeReport("healthy");
    await render("healthy", { ...report, games: report.games.map((g, i) => (i === 0 ? { ...g, kind: "tool" as const } : g)) });
    const details = $<HTMLDetailsElement>(".lib-show")!;
    expect(details).not.toBeNull();
    details.open = true;
    act(() => void details.dispatchEvent(new Event("toggle")));
    await settle();
    const menu = $(".lib-show-menu")!;
    expect(menu.classList.contains("top-layer")).toBe(true);
    expect(menu.getAttribute("popover")).toBe("manual");
    expect(shown).toHaveBeenCalled();
    expect(menu.style.top).not.toBe("");
  });
});
