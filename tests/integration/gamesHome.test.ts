// @vitest-environment jsdom
// Games → Home is calm when healthy and loud when not: with nothing to do,
// game setup is one "Everything is set up" line over the library (launchers,
// Proton, This computer and the change history folded under it); anything
// that needs the player (a recommended change, a missing Proton, a system ✗,
// an HDR ✗ that matters) shows open at the top with its action and a Needs
// attention chip. Every function stays reachable either way. Then Continue
// playing (Play on the tiles) and the Library (filters with their counts,
// sort, the grid); the rail is the index and says when it's filtered.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamesPage from "../../src/desktop/pages/GamesPage";
import { homeStatus } from "../../src/desktop/library/setupStatus";
import { continueCount } from "../../src/desktop/library/ContinuePlaying";
import type { GameInfo, GamesReport } from "../../src/desktop/games/types";
import { fakeBridge, HDR_NO_LAYER, OUR_PROTON } from "../support/gamePage";
import { homeDesktop, homeDetails, homeLibrary, homeReport, STEAM_DEFAULT_FIX, type HomeCase } from "../support/gamesHome";
import { GLASS_KEY } from "../../src/desktop/glass/glassPref";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
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
const setup = () => $(".lib-home-pane > .dk-stack")!;
const details = () => $<HTMLDetailsElement>(".lib-system")!;
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
  it("is one status line with the facts; the details are folded and keep every function", async () => {
    await render("healthy");
    expect($(".lib-setup")).toBeNull();
    const line = $(".lib-status")!;
    const summary = line.querySelector(".lib-system > summary")!.textContent!;
    expect(summary).toContain(i18n.t("desktop.games.allGood"));
    for (const fact of ["Steam", "Heroic", "Lutris", OUR_PROTON, "DP-5"]) expect(summary).toContain(fact);
    expect(details().open).toBe(false);
    expect(button(i18n.t("desktop.games.rescan"), line)).toBeTruthy();
    // Inside the fold: what checking does, the launchers' chips, Proton, This computer (HDR checklist), history with Undo.
    const fold = details();
    expect(fold.textContent).toContain(i18n.t("desktop.games.intro"));
    expect(fold.textContent).toContain("Steam · closed · our Proton is the default");
    expect(fold.textContent).toContain(`${OUR_PROTON} ${i18n.t("desktop.games.protonFound")}`);
    expect(fold.textContent).toContain(i18n.t("desktop.games.systemTitle"));
    expect(fold.querySelector(".hdr-row .hdr-check")).toBeTruthy();
    expect(fold.querySelector<HTMLDetailsElement>(".hdr-row")!.open).toBe(false);
    const history = fold.querySelector<HTMLDetailsElement>(".lib-history")!;
    expect(history.querySelector("summary")!.textContent).toBe(i18n.t("desktop.games.history"));
    await click(button(i18n.t("desktop.games.undoShort"), history));
    expect(calls).toContain("gamesUndo b1");
    // Each fact once: no separate cards, no "Recommended changes" heading.
    expect(container!.textContent).not.toContain(i18n.t("desktop.games.changesTitle"));
    expect(container!.textContent!.split(i18n.t("desktop.games.protonFound")).length - 1).toBe(1);
  });

  it("Rescan scans again", async () => {
    await render("healthy");
    const before = calls.filter((c) => c === "gamesScan").length;
    await click(button(i18n.t("desktop.games.rescan")));
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
    expect($<HTMLElement>(".lib-home-pane")!.hidden).toBe(true);
    expect($(".gp")).toBeTruthy();
    await click(button(`⌂ ${i18n.t("desktop.library.home")}`));
    expect($<HTMLElement>(".lib-home-pane")!.hidden).toBe(false);
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
  it("shows what needs the player open at the top, with its action and the chip", async () => {
    await render("attention");
    expect($(".lib-status")).toBeNull();
    const card = $(".lib-setup")!;
    expect(setup().firstElementChild).toBe(card);
    expect(card.querySelector(".dk-chip.warn")!.textContent).toBe(i18n.t("desktop.games.needsAttention"));
    // The change, ticked, with the launchers (Steam is running) and Review.
    expect(card.textContent).toContain(i18n.t("desktop.games.msg.label.defaultSteam", { proton: OUR_PROTON, interpolation: { escapeValue: false } }));
    expect(card.querySelector<HTMLInputElement>(".dk-fix input")!.checked).toBe(true);
    expect(card.textContent).toContain("Steam · running");
    // HDR ✗: This computer open at the top, its checklist open with the ✗.
    const hdr = card.querySelector<HTMLDetailsElement>(".hdr-row")!;
    expect(hdr.closest(".lib-system")).toBeNull();
    expect(hdr.open).toBe(true);
    expect(hdr.textContent).toContain("✗");
    // The rest folded: what checking does, Proton, history.
    expect(details().open).toBe(false);
    expect(details().textContent).toContain(`${OUR_PROTON} ${i18n.t("desktop.games.protonFound")}`);
    expect(details().querySelector(".lib-history")).toBeTruthy();
    expect(details().textContent).not.toContain(i18n.t("desktop.games.systemTitle")); // shown once, above
  });

  it("Review → Apply says Steam will be closed and reopened", async () => {
    await render("attention");
    await click(button(i18n.t("desktop.games.review", { count: 1 })));
    await settle();
    expect(container!.textContent).toContain(i18n.t("desktop.games.reviewTitle"));
    expect(container!.textContent).toContain(i18n.t("desktop.games.willRestart", { launcher: "Steam" }));
    expect(button(i18n.t("desktop.games.apply", { count: 1 }))).toBeTruthy();
  });

  it("unticking the change keeps it where it is until the next scan", async () => {
    await render("attention");
    const box = $<HTMLInputElement>(".lib-setup .dk-fix input")!;
    act(() => box.click());
    await settle();
    expect($(".lib-setup .dk-fix input")).toBe(box);
    expect(box.checked).toBe(false);
  });

  it("a missing Proton shows open with Install, and the install path still confirms first", async () => {
    const r = homeReport("healthy");
    await render("healthy", { ...r, ourProton: { name: null, latest: OUR_PROTON, latestSize: 400e6, updateAvailable: true } });
    const card = $(".lib-setup")!;
    expect(card.textContent).toContain(i18n.t("desktop.games.protonTitle"));
    await click(button(i18n.t("desktop.games.protonInstall", { name: OUR_PROTON })));
    expect(calls).not.toContain("installProton");
    await click(button(i18n.t("desktop.games.protonGo")));
    expect(calls).toContain("installProton");
  });
});

describe("Games → Home, Windows", () => {
  it("one line with the launchers; no Proton, This computer or HDR anywhere", async () => {
    await render("windows");
    const summary = $(".lib-status .lib-system > summary")!.textContent!;
    for (const name of ["Steam", "GOG Galaxy", "Epic Games"]) expect(summary).toContain(name);
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
    expect(art.style.getPropertyValue("--gp-art")).toBe(`url("ds5-art://art/${encodeURIComponent(LEAD)}/cover")`);
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
