// @vitest-environment jsdom
// A game's page, like every page: the main view is the art, the Play bar, the
// game at a glance (tiles named and ordered as the panel's sections, each
// opening its section, never repeating its status) and two main-view blocks,
// DualSense support and Details; the accordion at the right holds Controller
// profile, Setup, Compatibility, HDR, Your report (rating + test sheet) and Notes. Nothing inside a
// section folds on its own (passed checks, marks, the tier legend: shown, compact). What needs the player carries a yellow dot (and
// opens on a first visit); what's fine is one line. Each fact has one place.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamePage from "../../src/desktop/library/GamePage";
import { setupStatus } from "../../src/desktop/library/setupStatus";
import { hdrGameReqs } from "../../src/desktop/games/hdrSetup";
import type { Fix, GameEntry, HdrSystem } from "../../src/desktop/games/types";
import type { GameRecord } from "../../src/desktop/games/library";
import { fakeBridge, fakeDesktop, gamesReport, ghostrunner, ghostrunnerNeedsSetup, GHOSTRUNNER_INFO, GHOSTRUNNER_RECORD, HDR_NO_LAYER, HDR_READY, OUR_PROTON } from "../support/gamePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: the page scrolls to the top when a game opens.
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.localStorage.clear();
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

function render(game: GameEntry, hdr: HdrSystem = HDR_READY, platform: "linux" | "win32" = "linux", record: GameRecord | undefined = GHOSTRUNNER_RECORD, calls?: string[]) {
  vi.stubGlobal("desktop", fakeDesktop(platform, calls));
  act(() =>
    root!.render(
      createElement(GamePage, {
        game,
        info: GHOSTRUNNER_INFO,
        record,
        running: false,
        report: gamesReport(game, hdr),
        bridge: fakeBridge(),
        onLibrary: () => undefined,
        onRescan: () => undefined,
      }),
    ),
  );
}
const $ = <T extends Element = HTMLElement>(sel: string) => container!.querySelector<T>(sel);
const sec = (id: string) => $(`[data-section="${id}"]`);
const body = (id: string) => $(`[data-section="${id}"] .dk-sec-body`);
const status = (id: string) => $(`[data-section="${id}"] .dk-sec-status`)?.textContent;
const hasDot = (id: string) => !!$(`[data-section="${id}"] .dk-sec-task`);
const sectionIds = () => [...container!.querySelectorAll<HTMLElement>(".dk-sec")].map((x) => x.dataset.section);
const openIds = () => [...container!.querySelectorAll<HTMLElement>(".dk-sec.open")].map((x) => x.dataset.section);
// Opens a section (left open if it is).
const open = (id: string) => {
  const head = $<HTMLButtonElement>(`[data-section="${id}"] .dk-sec-toggle`)!;
  if (head.getAttribute("aria-expanded") !== "true") act(() => head.click());
  return body(id)!;
};
// Details: a block in the main view (readouts aren't sections), always shown.
const openDetails = () => $('.dk-split-main [data-block="details"] .dk-block-body')!;
const checks = () => $('[data-section="setup"] .gp-checks');
const checksHead = () => checks()!.querySelector(".gp-checks-head")!.textContent;

describe("setupStatus", () => {
  const reqs = (game: GameEntry, hdr: HdrSystem) => hdrGameReqs(hdr, game, { ourProton: OUR_PROTON });

  it("all ✓: nothing needs the player; Setup's ✓ lines are counted (HDR is its own section)", () => {
    const game = ghostrunner();
    expect(setupStatus(game, reqs(game, HDR_READY))).toEqual({ attention: false, hdrOk: true, passed: 2 });
  });

  it("an HDR ✗ is HDR's, not Setup's", () => {
    const game = ghostrunner({ hdr: "missing" });
    const s = setupStatus(game, reqs(game, HDR_NO_LAYER));
    expect(s).toEqual({ attention: false, hdrOk: false, passed: 2 });
  });

  it("a fix waiting, an unbuildable standard gamepad or the player's own mode need the player", () => {
    expect(setupStatus(ghostrunnerNeedsSetup(), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ gamepad: "no-build" }), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ mode: { state: "own", api: "dx12", flag: "-dx12", unlocks: "rayTracing", own: "-dx11" } }), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ gamepad: undefined, mode: undefined }), [])).toEqual({ attention: false, hdrOk: true, passed: 0 });
  });
});

describe("game page", () => {
  it("main view: the art, the Play bar and the game at a glance; every section at the right", () => {
    render(ghostrunner());
    expect($(".dk-split-main .gp-hero")).not.toBeNull();
    expect($(".dk-split-main .gp-bar .gp-play")).not.toBeNull();
    expect($(".dk-split-head h2")!.textContent).toBe("Ghostrunner");
    expect(sectionIds()).toEqual(["profile", "setup", "compatibility", "hdr", "report", "notes"]);
    expect(container!.querySelectorAll(".dk-card")).toHaveLength(0); // no cards left
    // Nothing needs the player: nothing opens by itself, and a folded section renders nothing.
    expect(openIds()).toEqual([]);
    expect(container!.querySelectorAll(".dk-sec-body")).toHaveLength(0);
    // Every section says its state.
    for (const id of sectionIds()) expect(status(id!), id).toBeTruthy();
    // Your words for the rating, and the sheet's counts (the record's old checklist, migrated: haptic feedback works + feels weak = 1 Fail).
    expect(status("report")).toBe(`${i18n.t("desktop.library.rateLabel.4")} · ${i18n.t("desktop.library.resultCounts", { pass: 0, fail: 1 })}`);
    // DualSense support is a readout: a main-view block with the tier as its status.
    expect($('.dk-split-main [data-block="support"] .dk-sec-status')!.textContent).toBe(`✓✓ ${i18n.t("desktop.library.tier.verified")}`);
    expect($('.dk-split-panel [data-section="support"]')).toBeNull();
  });

  it("each tile opens its section (and flashes it): the panel's names, in the panel's order", () => {
    render(ghostrunner());
    const tiles = [...container!.querySelectorAll<HTMLButtonElement>(".gp-glance .gp-tile")];
    expect(tiles.map((t) => t.querySelector(".gp-tile-label")!.textContent)).toEqual([
      i18n.t("desktop.library.section.profile"),
      i18n.t("desktop.library.section.setup"),
      i18n.t("desktop.library.section.compat"),
      i18n.t("desktop.library.section.report"),
    ]);
    const targets = ["profile", "setup", "compatibility", "report"];
    // In the panel's order: the tiles' sections come in the same order there.
    expect(targets.map((id) => sectionIds().indexOf(id))).toEqual([...targets.map((id) => sectionIds().indexOf(id))].sort((a, b) => a - b));
    // Each tile's label is its section's title.
    tiles.forEach((tile, i) => expect(tile.querySelector(".gp-tile-label")!.textContent).toBe(sec(targets[i])!.querySelector(".dk-sec-title")!.textContent));
    // A section with nothing to do (page rule 6) has nothing to open: the tile still takes you there (the flash).
    tiles.forEach((tile, i) => {
      act(() => tile.click());
      expect(openIds()).toEqual(sec(targets[i])!.classList.contains("idle") ? [] : [targets[i]]);
      expect(sec(targets[i])!.classList.contains("dk-flash")).toBe(true);
    });
  });

  it("all set: Setup has nothing to do, so it shows its status only, no body (page rule 6, IA audit Q9)", () => {
    render(ghostrunner());
    expect(status("setup")).toBe("✓ All set (2 checks)");
    expect(hasDot("setup")).toBe(false);
    expect(status("hdr")).toBe(`${i18n.t("desktop.library.supportsHdr")} · on for DP-1`);
    expect(hasDot("hdr")).toBe(false);
    expect(sec("setup")!.classList.contains("idle")).toBe(true);
    expect(sec("setup")!.querySelector("button.dk-sec-toggle, .dk-sec-pin, .dk-sec-body")).toBeNull();
    // HDR still has something to do for a game we don't know (Supports HDR), so it opens: the checklist all ✓.
    const hdr = open("hdr");
    expect(hdr.querySelector(".hdr-check")!.textContent).not.toContain("✗");
    expect(hdr.textContent).toContain(i18n.t("desktop.library.supportsHdr"));
  });

  it("a game that can still be marked keeps Setup open-able: the mark is something to do", () => {
    render(ghostrunner({ support: "unknown", gamepad: undefined }));
    expect(sec("setup")!.classList.contains("idle")).toBe(false);
    expect(open("setup").querySelector(".gp-marks input")).not.toBeNull();
  });

  it("needs attention: Setup and HDR carry their dots; a first visit opens Setup with Review", () => {
    render(ghostrunnerNeedsSetup(), HDR_NO_LAYER);
    expect(openIds()).toEqual(["setup"]);
    expect(hasDot("setup")).toBe(true);
    expect(status("setup")).toBe(i18n.t("desktop.library.needsAttention"));
    expect([...body("setup")!.querySelectorAll("button")].some((b) => b.textContent === i18n.t("desktop.library.setupReview"))).toBe(true);
    expect(checksHead()).toBe("1 check passed");
    expect(body("setup")!.querySelector(".hdr-check")).toBeNull(); // HDR has its own section
    expect(hasDot("hdr")).toBe(true);
    const hdr = open("hdr");
    expect(hdr.querySelector(".hdr-check")!.textContent).toContain("✗");
    // Set it up yourself: shown (no fold), a compact numbered list; the intro behind the ⓘ.
    expect(hdr.querySelector("details, summary")).toBeNull();
    const manual = hdr.querySelector("ol.hdr-manual")!.closest(".dk-sec-group")!;
    expect(manual.querySelector(".dk-subhead")!.firstChild!.textContent).toBe(i18n.t("desktop.hdrManual.title"));
    expect(manual.querySelectorAll("ol.hdr-manual > li").length).toBeGreaterThanOrEqual(3);
    expect(manual.querySelector(".dk-subhead button")!.getAttribute("aria-label")).toBe("More information");
    // loop: test — a few paragraphs
    expect([...manual.querySelectorAll("p")].some((p) => p.textContent!.includes(i18n.t("desktop.hdrManual.intro")))).toBe(false);
  });

  it("each fact once: no placeholders, no tier or Proton in the stats, the store in Details", () => {
    render(ghostrunner({ launcher: "heroic", store: "gog" }));
    const text = container!.textContent!;
    expect(text).not.toContain("Player ratings");
    expect(text).not.toContain("Shared configs");
    expect([...container!.querySelectorAll(".gp-stat-label")].map((l) => l.textContent)).toEqual([i18n.t("desktop.library.lastPlayed"), i18n.t("desktop.library.playTime")]);
    // Already on ours, no other build: Compatibility has nothing to do, its status says so; the build's name is the tile's.
    expect(sec("compatibility")!.classList.contains("idle")).toBe(true);
    expect(status("compatibility")).toBe(i18n.t("desktop.library.compatStatus.ours"));
    expect($('.gp-tile[data-tile="compatibility"] .gp-tile-value')!.textContent).toBe(OUR_PROTON);
    expect(status("compatibility")).not.toContain(i18n.t("desktop.library.store"));
    expect(openDetails().textContent).toContain(i18n.t("desktop.library.storeName.gog"));
    // Details has no status line: its rows say the store and the size (IA audit R6).
    expect($('.dk-split-main [data-block="details"] .dk-sec-status')).toBeNull();
  });

  it("Controller profile: what it changes, Edit in controller view, the layout and curves; no copy of the controller view's settings", () => {
    render(ghostrunner());
    // The tile counts the changes, the section's status names them.
    expect($('.gp-tile[data-tile="profile"] .gp-tile-value')!.textContent).toBe("2 changes");
    expect(status("profile")).toBe(`${i18n.t("desktop.library.haptics")}, ${i18n.t("desktop.library.speaker")}`);
    const profile = open("profile");
    expect([...profile.querySelectorAll(".dk-chip")].map((c) => c.textContent)).toHaveLength(2);
    const buttons = [...profile.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain(i18n.t("desktop.editing.open"));
    expect(buttons).toContain(i18n.t("desktop.library.profileCopyCurrent"));
    expect(buttons).toContain(i18n.t("desktop.library.profileDelete"));
    // No saved layouts: no layout picker (nothing to pick), the hint says where layouts are made.
    expect(profile.textContent).toContain(i18n.t("desktop.layouts.noneForGame"));
    expect([...profile.querySelectorAll(".dk-row > .dk-label")].map((l) => l.firstChild?.textContent)).toEqual([i18n.t("desktop.curves.profileLeft"), i18n.t("desktop.curves.profileRight")]);
    expect(profile.querySelectorAll('input[type="range"]')).toHaveLength(0);
  });

  it("the player's marks: Controller not detected in Setup (the same field as the sheet's Controller detected), Supports HDR in HDR", () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      render(ghostrunner({ support: "unknown", gamepad: undefined }), HDR_READY, "linux", GHOSTRUNNER_RECORD, calls);
      // Shown under its question, no fold.
      const marks = open("setup").querySelector(".gp-marks")!.closest(".dk-sec-group")!;
      expect(marks.querySelector(".dk-subhead")!.textContent).toBe(i18n.t("desktop.library.marksTitle"));
      expect(marks.textContent).toContain(i18n.t("desktop.library.tag.not-detected"));
      expect(marks.textContent).not.toContain(i18n.t("desktop.library.supportsHdr"));
      expect(body("setup")!.querySelector("details")).toBeNull();
      const hdrMark = [...open("hdr").querySelectorAll<HTMLLabelElement>(".dk-fix")].find((l) => l.textContent!.includes(i18n.t("desktop.library.supportsHdr")))!;
      expect(hdrMark.querySelector("input")!.checked).toBe(true); // the record says so
      // The sheet always has the row; ticking the mark sets it to Fail, and back to Not tested.
      const row = () => open("report").querySelector('[data-feature="controller-detected"]')!;
      expect(row().getAttribute("data-result")).toBe("not-tested");
      const mark = open("setup").querySelector<HTMLInputElement>(".gp-marks input")!;
      act(() => mark.click());
      expect(row().getAttribute("data-result")).toBe("fail");
      expect(open("setup").querySelector<HTMLInputElement>(".gp-marks input")!.checked).toBe(true);
      act(() => void vi.advanceTimersByTime(1000));
      const saved = JSON.parse(calls.find((c) => c.startsWith("librarySetMine"))!.slice("librarySetMine ".length)) as { mine: Record<string, unknown> };
      expect(saved.mine.report).toMatchObject({ results: { "controller-detected": { result: "fail" } } });
      expect(saved.mine.tags).toBeUndefined();
      // Not tested from the sheet clears the mark.
      const notTested = row().querySelector<HTMLButtonElement>(`button[aria-pressed="false"]:last-child`)!;
      act(() => notTested.click());
      expect(row().getAttribute("data-result")).toBe("not-tested");
      expect(open("setup").querySelector<HTMLInputElement>(".gp-marks input")!.checked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("DualSense support is a main-view block: the tier's meaning, the feature checklist and the tier legend (compact, no fold)", () => {
    render(ghostrunner());
    const support = $('.dk-split-main [data-block="support"] .dk-block-body')!;
    expect(support.querySelector("details")).toBeNull();
    expect(support.querySelector(".gp-tier")!.textContent).toBe(i18n.t("desktop.library.tierHint.verified"));
    expect(support.querySelectorAll(".gp-features li")).toHaveLength(5);
    expect(support.querySelector(".dk-subhead")!.textContent).toBe(i18n.t("desktop.library.tierLegend"));
    expect(support.querySelectorAll(".gp-legend-list li")).toHaveLength(6);
    // Before Details.
    expect(support.compareDocumentPosition(openDetails()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a tile never repeats its section's status (IA audit Q7)", () => {
    for (const game of [ghostrunner(), ghostrunnerNeedsSetup(), ghostrunner({ support: "unknown", usesOurProton: false })]) {
      render(game);
      for (const tile of [...container!.querySelectorAll<HTMLElement>(".gp-tile")]) {
        const said = status(tile.dataset.tile!)!;
        for (const part of [tile.querySelector(".gp-tile-value"), tile.querySelector(".gp-tile-hint")]) {
          if (!part) continue;
          expect(said, `${tile.dataset.tile}: "${part.textContent}"`).not.toContain(part.textContent!);
          expect(part.textContent, tile.dataset.tile).not.toContain(said);
        }
      }
    }
  });

  it("Your report is a test sheet: a Pass / Fail / Not tested row per feature (Sony's names), Fail details, the setup flag, saved with a new stamp", () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      render(ghostrunner(), HDR_READY, "linux", GHOSTRUNNER_RECORD, calls);
      expect(sec("report")!.querySelector(".dk-sec-ic svg")).not.toBeNull();
      const report = open("report");
      // After the rating; no checkboxes left.
      const sheet = report.querySelector(".gp-sheet")!;
      expect(report.querySelector("#gp-rating")!.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(report.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
      expect($('[data-block="support"] .gp-sheet')).toBeNull();
      // Seven rows in order, each one group named by Sony's term, three buttons: icon + word (never color alone).
      const rows = [...sheet.querySelectorAll<HTMLElement>(".gp-sheet-row")];
      expect(rows.map((r) => r.dataset.feature)).toEqual(["controller-detected", "adaptive-triggers", "haptic-feedback", "speaker", "microphone", "light-bar", "stays-connected"]);
      expect(rows.map((r) => r.querySelector("[role=group]")!.getAttribute("aria-label"))).toEqual(
        ["Controller detected", "Adaptive triggers", "Haptic feedback", "Speaker", "Microphone", "Light bar", "Stays connected"].map((x) => x),
      );
      for (const r of rows) {
        const buttons = [...r.querySelectorAll<HTMLButtonElement>(".dk-seg button")];
        expect(buttons.map((b) => b.textContent)).toEqual([i18n.t("desktop.library.result.pass"), i18n.t("desktop.library.result.fail"), i18n.t("desktop.library.result.not-tested")]);
        for (const b of buttons) {
          expect(b.querySelector(".dk-seg-icon svg")).not.toBeNull();
          expect(b.tabIndex).toBe(0); // keyboard reachable
        }
        expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      }
      // The record's old checklist, migrated: haptic feedback Fail + Feels weak, marked for a re-check; the rest Not tested.
      const row = (f: string) => sheet.querySelector<HTMLElement>(`[data-feature="${f}"]`)!;
      const press = (f: string, label: string) => act(() => [...row(f).querySelectorAll<HTMLButtonElement>(".dk-seg button")].find((b) => b.textContent === label)!.click());
      expect(rows.map((r) => r.dataset.result)).toEqual(["not-tested", "not-tested", "fail", "not-tested", "not-tested", "not-tested", "not-tested"]);
      const chips = () => [...row("haptic-feedback").querySelectorAll<HTMLButtonElement>(".gp-details .dk-chip")];
      expect(chips().map((c) => [c.textContent, c.getAttribute("aria-pressed")])).toEqual([
        [i18n.t("desktop.library.detail.weak"), "true"],
        [i18n.t("desktop.library.detail.rumble-only"), "false"],
      ]);
      expect(row("haptic-feedback").querySelector(".gp-details")!.getAttribute("aria-label")).toBe(i18n.t("desktop.library.failDetails", { feature: "Haptic feedback" }));
      expect(row("haptic-feedback").querySelector(".gp-conflict")!.textContent).toContain(i18n.t("desktop.library.sheetConflict"));
      // A row without details has no chips, even on Fail.
      press("stays-connected", "Fail");
      expect(row("stays-connected").querySelector(".gp-details")).toBeNull();
      // Picking a result confirms the conflicting row; Speaker's Fail offers its detail.
      press("haptic-feedback", "Fail");
      expect(row("haptic-feedback").querySelector(".gp-conflict")).toBeNull();
      press("adaptive-triggers", "Pass");
      press("speaker", "Fail");
      act(() => row("speaker").querySelector<HTMLButtonElement>(".gp-details .dk-chip")!.click());
      expect(row("speaker").querySelector(".gp-details .dk-chip")!.getAttribute("aria-pressed")).toBe("true");
      expect(status("report")).toBe(`${i18n.t("desktop.library.rateLabel.4")} · ${i18n.t("desktop.library.resultCounts", { pass: 1, fail: 3 })}`);
      // The suggestion sits by the stars and never moves them.
      expect(report.querySelector(".gp-suggested")!.textContent).toContain(i18n.t("desktop.library.suggested", { label: i18n.t("desktop.library.rateLabel.2") }));
      expect(report.querySelectorAll(".gp-stars button.on")).toHaveLength(4);
      // The setup flag: a switch, off until set.
      const flag = report.querySelector<HTMLButtonElement>('button[role="switch"]')!;
      expect(flag.getAttribute("aria-label")).toBe(i18n.t("desktop.library.flag.steam-input-off"));
      expect(flag.getAttribute("aria-checked")).toBe("false");
      act(() => flag.click());
      act(() => void vi.advanceTimersByTime(1000));
      const last = calls.filter((c) => c.startsWith("librarySetMine")).at(-1)!;
      const saved = JSON.parse(last.slice("librarySetMine ".length)) as { mine: Record<string, unknown> };
      expect(saved.mine).toMatchObject({
        rating: 4,
        notes: "Ray Tracing needs -dx12.",
        hdr: true,
        report: {
          schemaVersion: 1,
          results: {
            "adaptive-triggers": { result: "pass" },
            "haptic-feedback": { result: "fail", details: ["weak"] },
            speaker: { result: "fail", details: ["problems"] },
            "stays-connected": { result: "fail" },
          },
          setup: { "steam-input-off": true },
        },
        ratedOn: { app: "1.0.0", build: "1000", os: "linux" },
      });
      expect(saved.mine.tags).toBeUndefined(); // the old checklist is replaced, not kept beside
      expect((saved.mine.report as Record<string, unknown>).conflicts).toBeUndefined();
      expect(last).not.toMatch(/Pass|Fail|Feels weak/); // IDs, never the words
      // Back to Not tested: the row's details go with it.
      press("speaker", "Not tested");
      expect(row("speaker").dataset.result).toBe("not-tested");
      expect(row("speaker").querySelector(".gp-details")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a game with no report: every row Not tested, no suggestion, the status says so", () => {
    render(ghostrunner(), HDR_READY, "linux", { title: "Ghostrunner" });
    expect(status("report")).toBe(i18n.t("desktop.library.notTestedYet"));
    const report = open("report");
    expect([...report.querySelectorAll<HTMLElement>(".gp-sheet-row")].map((r) => r.dataset.result)).toEqual(Array(7).fill("not-tested"));
    expect(report.querySelector(".gp-suggested")).toBeNull();
    expect(report.querySelector(".gp-conflict")).toBeNull();
  });

  it("Notes: the first line is the status; a folded section keeps what was typed", () => {
    vi.useFakeTimers();
    try {
      render(ghostrunner());
      expect(status("notes")).toBe("Ray Tracing needs -dx12.");
      const box = open("notes").querySelector("textarea")!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Use DX12\nand HDR");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(status("notes")).toBe("Use DX12");
      act(() => $<HTMLButtonElement>('[data-section="notes"] .dk-sec-toggle')!.click());
      expect(open("notes").querySelector("textarea")!.value).toBe("Use DX12\nand HDR");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Windows: no Proton or HDR sections, the store and launcher in Details", () => {
    render(ghostrunner({ hdr: undefined, gamepad: undefined, runner: null, usesOurProton: false, envFlags: [] }), HDR_READY, "win32");
    expect(sectionIds()).toEqual(["profile", "setup", "report", "notes"]);
    expect([...container!.querySelectorAll(".gp-tile")]).toHaveLength(3);
    // Nothing to set up and no mark on Windows: its status only.
    expect(sec("setup")!.classList.contains("idle")).toBe(true);
    expect(status("setup")).toBe("✓ All set (1 check)");
    expect(openDetails().textContent).toContain(i18n.t("desktop.library.launcher"));
  });
});

// The rating rates the controller in this game, not the game: it sits in
// Your report, asks so, and every star names what it means (owner: "five
// stars under a game banner read as rating the game").
describe("rating: how well the DualSense works in this game", () => {
  const stars = () => [...container!.querySelectorAll<HTMLButtonElement>("#gp-rating [role=radio]")];
  // The rating is in Your report: rendered while it's open.
  const show = (game: GameEntry = ghostrunner()) => {
    render(game);
    open("report");
  };
  const label = () => $("#gp-rating .gp-rate-label");
  const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

  it("lives in Your report, first, with its question and the saved-on-this-PC line", () => {
    show();
    const rating = $('[data-section="report"] #gp-rating')!;
    expect(rating).not.toBeNull();
    expect(body("report")!.firstElementChild).toBe(rating);
    expect(rating.querySelector("h3")!.textContent).toBe("How well does your DualSense work in this game?");
    expect(rating.querySelector("[role=radiogroup]")!.getAttribute("aria-labelledby")).toBe(rating.querySelector("h3")!.id);
    expect(rating.querySelector(".gp-tags")).toBeNull();
    expect(rating.textContent).toContain(i18n.t("desktop.library.shareSoon"));
  });

  it("each star names how the controller works; the chosen one's words show next to the stars", () => {
    show(); // rated 4
    expect(stars().map((b) => b.title)).toEqual(["Doesn't work", "Barely works", "Works with problems", "Works well", "Works perfectly"]);
    expect(stars()[0].getAttribute("aria-label")).toBe("1 star: Doesn't work");
    expect(stars()[4].getAttribute("aria-label")).toBe("5 stars: Works perfectly");
    expect(stars().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(label()!.textContent).toBe("Works well");
    expect(label()!.classList.contains("preview")).toBe(false);
  });

  it("hover and focus preview a star's words; leaving shows the chosen one again", () => {
    show();
    act(() => void stars()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(label()!.textContent).toBe("Doesn't work");
    expect(label()!.classList.contains("preview")).toBe(true);
    expect(stars().filter((b) => b.classList.contains("on")).length).toBe(1);
    act(() => void $("#gp-rating .gp-stars")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(label()!.textContent).toBe("Works well");
    act(() => stars()[4].focus());
    expect(label()!.textContent).toBe("Works perfectly");
  });

  it("no rating yet: no words until a star is pointed at, and the first star is the one tab stop", () => {
    const record = { ...GHOSTRUNNER_RECORD, mine: { ...GHOSTRUNNER_RECORD.mine, rating: undefined } };
    vi.stubGlobal("desktop", fakeDesktop("linux"));
    act(() =>
      root!.render(
        createElement(GamePage, {
          game: ghostrunner(),
          info: GHOSTRUNNER_INFO,
          record,
          running: false,
          report: gamesReport(ghostrunner()),
          bridge: fakeBridge(),
          onLibrary: () => undefined,
          onRescan: () => undefined,
        }),
      ),
    );
    open("report");
    expect(label()).toBeNull();
    expect(stars().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("keyboard: one tab stop, arrows and Home/End pick a star and move focus; saved in the same rating field", () => {
    vi.useFakeTimers();
    try {
      show();
      const calls: string[] = [];
      vi.stubGlobal("desktop", fakeDesktop("linux", calls));
      expect(stars().map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
      act(() => stars()[3].focus());
      key(stars()[3], "ArrowRight");
      expect(stars()[4].getAttribute("aria-checked")).toBe("true");
      expect(document.activeElement).toBe(stars()[4]);
      expect(label()!.textContent).toBe("Works perfectly");
      key(stars()[4], "ArrowRight"); // stays at 5
      expect(stars()[4].getAttribute("aria-checked")).toBe("true");
      key(stars()[4], "Home");
      expect(document.activeElement).toBe(stars()[0]);
      key(stars()[0], "ArrowUp");
      expect(stars()[1].getAttribute("aria-checked")).toBe("true");
      expect(stars().map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
      act(() => void vi.advanceTimersByTime(1000));
      expect(calls.at(-1)).toContain('"rating":2');
    } finally {
      vi.useRealTimers();
    }
  });

  it("all 7 languages have the question and the five star words", () => {
    for (const lng of ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"]) {
      expect(i18n.exists("desktop.library.rateTitle", { lng })).toBe(true);
      for (const n of [1, 2, 3, 4, 5]) expect(i18n.exists(`desktop.library.rateLabel.${n}`, { lng })).toBe(true);
    }
  });
});

describe("Compatibility: the Proton version picker (Linux)", () => {
  const PICK_ID = "steam-0000abcd:proton:1997030:0a0b0c0d";
  const pickFix: Fix = {
    id: PICK_ID,
    kind: "set-proton",
    launcher: "steam",
    label: { key: "label.runner", params: { game: "Ghostrunner", proton: "Proton 9.0" } },
    why: { key: "why.protonPick", params: { game: "Ghostrunner", proton: "Proton 9.0", current: OUR_PROTON, note: "" } },
    files: ["~/.local/share/Steam/config/config.vdf"],
    recommended: false,
  };
  const withPicker = () =>
    ghostrunner({
      protons: [
        { name: OUR_PROTON, recommended: true, current: true },
        { name: "Proton 9.0", recommended: false, current: false, fix: pickFix },
      ],
    });
  // Steam runs: the page says it'll close and reopen it before anything is written.
  function renderPicker(game: GameEntry, calls: string[]) {
    const base = fakeDesktop("linux");
    const desktop = new Proxy(base, {
      get: (t, p: string) =>
        p === "gamesRunningLaunchers"
          ? () => Promise.resolve(["steam"])
          : p === "gamesApply"
            ? (r: { fixIds: string[]; restart: string[] }) => (
                calls.push(`apply ${r.fixIds.join(",")} restart=${r.restart.join(",")}`),
                Promise.resolve({ applied: [{ id: r.fixIds[0], ok: true }], backupId: "b1", blockedBy: [] })
              )
            : p === "gamesUndo"
              ? (r: { backupId: string; restart: string[] }) => (calls.push(`undo ${r.backupId} restart=${r.restart.join(",")}`), Promise.resolve({ ok: true, restored: [] }))
              : t[p],
    });
    vi.stubGlobal("desktop", desktop);
    act(() =>
      root!.render(
        createElement(GamePage, {
          game,
          info: GHOSTRUNNER_INFO,
          record: GHOSTRUNNER_RECORD,
          running: false,
          report: gamesReport(game),
          bridge: fakeBridge(),
          onLibrary: () => undefined,
          onRescan: () => undefined,
        }),
      ),
    );
  }
  const settle = () => act(async () => undefined);
  const button = (body: HTMLElement, text: string) => [...body.querySelectorAll("button")].find((b) => b.textContent === text)!;

  it("lists the builds with ours recommended, says the launcher restart first, applies, and undoes in place", async () => {
    const calls: string[] = [];
    renderPicker(withPicker(), calls);
    const compat = open("compatibility");
    await settle();
    const select = compat.querySelector<HTMLSelectElement>("select")!;
    expect(select.getAttribute("aria-label")).toBe(i18n.t("desktop.library.protonPick"));
    expect([...select.options].map((o) => o.textContent)).toEqual([i18n.t("desktop.library.protonBoth", { name: OUR_PROTON }), "Proton 9.0"]);
    // On the current build: nothing to apply.
    expect(button(compat, i18n.t("desktop.library.switchTo", { name: "Proton 9.0" }))).toBeUndefined();

    act(() => {
      select.value = "Proton 9.0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(compat.textContent).toContain(`Ghostrunner will run with Proton 9.0 instead of ${OUR_PROTON}.`);
    expect(compat.textContent).toContain("~/.local/share/Steam/config/config.vdf");
    // First press: Steam's close and reopen is said; nothing is written yet.
    await act(async () => button(compat, i18n.t("desktop.library.switchTo", { name: "Proton 9.0" })).click());
    expect(compat.textContent).toContain(i18n.t("desktop.games.willRestart", { launcher: "Steam" }));
    expect(calls).toEqual([]);
    await act(async () => button(compat, i18n.t("desktop.library.switchTo", { name: "Proton 9.0" })).click());
    expect(calls).toEqual([`apply ${PICK_ID} restart=steam`]);
    expect(compat.textContent).toContain(i18n.t("desktop.library.protonSwitched", { name: "Proton 9.0" }));

    // Undo: said first too, then undone with the same launcher named.
    await act(async () => button(compat, i18n.t("desktop.games.undoShort")).click());
    expect(compat.textContent).toContain(i18n.t("desktop.games.willRestartUndo", { launcher: "Steam" }));
    expect(calls).toHaveLength(1);
    await act(async () => button(compat, i18n.t("desktop.games.undoShort")).click());
    expect(calls[1]).toBe("undo b1 restart=steam");
    expect(compat.textContent).toContain(i18n.t("desktop.library.protonUndone"));
    expect(button(compat, i18n.t("desktop.games.undoShort"))).toBeUndefined();
  });

  it("Cancel puts the picker back on the current build", async () => {
    renderPicker(withPicker(), []);
    const compat = open("compatibility");
    const select = compat.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      select.value = "Proton 9.0";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button(compat, i18n.t("desktop.library.cancel")).click());
    expect(select.value).toBe(OUR_PROTON);
    expect(compat.textContent).not.toContain("instead of");
  });

  it("our build missing for a game that needs it: Compatibility carries Install, which goes to Games → DualSense Proton build (IA audit R5)", () => {
    const game = ghostrunner({ support: "triggers", usesOurProton: false, runner: "Proton 9.0" });
    const report = gamesReport(game);
    report.ourProton = { ...report.ourProton, name: null };
    vi.stubGlobal("desktop", fakeDesktop("linux"));
    act(() =>
      root!.render(
        createElement(GamePage, { game, info: GHOSTRUNNER_INFO, record: GHOSTRUNNER_RECORD, running: false, report, bridge: fakeBridge(), onLibrary: () => undefined, onRescan: () => undefined }),
      ),
    );
    expect(status("compatibility")).toBe(i18n.t("desktop.library.compatStatus.notInstalled"));
    const install = [...open("compatibility").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === i18n.t("desktop.library.installOurs"))!;
    expect(install).toBeTruthy(); // where it leads: gamesHome.test.ts
  });

  it("no picker without builds to switch to (and none on Windows, where Compatibility isn't shown)", () => {
    render(ghostrunner());
    expect(sec("compatibility")!.classList.contains("idle")).toBe(true);
    expect(sec("compatibility")!.querySelector("select")).toBeNull();
    render(withPicker(), HDR_READY, "win32");
    expect(sectionIds()).not.toContain("compatibility");
  });

  it("every locale has the picker's words", () => {
    // loop: NOT-WORTH — 7 languages in a test
    for (const lng of ["en", "de", "es", "fr", "ja", "pt-BR", "zh-CN"]) {
      for (const k of ["protonPick", "protonPickInfo", "protonRecommended", "protonCurrent", "protonBoth", "protonGone", "protonSwitched", "protonUndone"])
        expect(i18n.exists(`desktop.library.${k}`, { lng }), `${lng} ${k}`).toBe(true);
      for (const k of ["protonPick", "protonPickDefault"]) expect(i18n.exists(`desktop.games.msg.why.${k}`, { lng }), `${lng} ${k}`).toBe(true);
    }
  });
});
