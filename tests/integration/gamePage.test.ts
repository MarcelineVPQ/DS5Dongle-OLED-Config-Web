// @vitest-environment jsdom
// A game's page, like every page: the main view is the art, the Play bar and
// the game at a glance (tiles that open their section); the accordion at the
// right holds Controller profile, Setup, HDR, Compatibility, DualSense
// support, Notes and Details. What needs the player carries a yellow dot (and
// opens on a first visit); what's fine is one line. Each fact has one place.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamePage from "../../src/desktop/library/GamePage";
import { setupStatus } from "../../src/desktop/library/setupStatus";
import { hdrGameReqs } from "../../src/desktop/games/hdrSetup";
import type { GameEntry, HdrSystem } from "../../src/desktop/games/types";
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

function render(game: GameEntry, hdr: HdrSystem = HDR_READY, platform: "linux" | "win32" = "linux") {
  vi.stubGlobal("desktop", fakeDesktop(platform));
  act(() =>
    root!.render(
      createElement(GamePage, {
        game,
        info: GHOSTRUNNER_INFO,
        record: GHOSTRUNNER_RECORD,
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
// Details: a block in the main view (readouts aren't sections), opened.
const openDetails = () => {
  const head = $<HTMLButtonElement>('.dk-split-main [data-block="details"] .dk-block-toggle')!;
  if (head.getAttribute("aria-expanded") !== "true") act(() => head.click());
  return $('.dk-split-main [data-block="details"] .dk-block-body')!;
};
const checks = () => $<HTMLDetailsElement>('[data-section="setup"] details.gp-checks');

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
    expect(sectionIds()).toEqual(["profile", "setup", "hdr", "compatibility", "support", "notes"]);
    expect(container!.querySelectorAll(".dk-card")).toHaveLength(0); // no cards left
    // Nothing needs the player: nothing opens by itself, and a folded section renders nothing.
    expect(openIds()).toEqual([]);
    expect(container!.querySelectorAll(".dk-sec-body")).toHaveLength(0);
    // Every section says its state.
    for (const id of sectionIds()) expect(status(id!), id).toBeTruthy();
    expect(status("support")).toMatch(/ · ★★★★☆$/); // the tier and the player's rating
  });

  it("each tile opens its section (and flashes it)", () => {
    render(ghostrunner());
    const tiles = [...container!.querySelectorAll<HTMLButtonElement>(".gp-glance .gp-tile")];
    expect(tiles.map((t) => t.querySelector(".gp-tile-label")!.textContent)).toEqual([
      i18n.t("desktop.library.section.support"),
      i18n.t("desktop.library.runsWith"),
      i18n.t("desktop.library.section.profile"),
      i18n.t("desktop.library.section.setup"),
    ]);
    const targets = ["support", "compatibility", "profile", "setup"];
    tiles.forEach((tile, i) => {
      act(() => tile.click());
      expect(openIds()).toEqual([targets[i]]);
      expect(sec(targets[i])!.classList.contains("dk-flash")).toBe(true);
    });
  });

  it("all set: Setup is one ✓ line (its list folded), HDR its own section with the checklist", () => {
    render(ghostrunner());
    expect(status("setup")).toBe("✓ All set (2 checks)");
    expect(hasDot("setup")).toBe(false);
    open("setup");
    expect(checks()!.open).toBe(false);
    expect(checks()!.querySelector("summary")!.textContent).toBe("✓ All set (2 checks)");
    expect(status("hdr")).toBe(`${i18n.t("desktop.library.supportsHdr")} · on for DP-1`);
    expect(hasDot("hdr")).toBe(false);
    expect(open("hdr").querySelector(".hdr-check")!.textContent).not.toContain("✗");
  });

  it("needs attention: Setup and HDR carry their dots; a first visit opens Setup with Review", () => {
    render(ghostrunnerNeedsSetup(), HDR_NO_LAYER);
    expect(openIds()).toEqual(["setup"]);
    expect(hasDot("setup")).toBe(true);
    expect(status("setup")).toBe(i18n.t("desktop.library.needsAttention"));
    expect([...body("setup")!.querySelectorAll("button")].some((b) => b.textContent === i18n.t("desktop.library.setupReview"))).toBe(true);
    expect(checks()!.querySelector("summary")!.textContent).toBe("1 check passed");
    expect(body("setup")!.querySelector(".hdr-check")).toBeNull(); // HDR has its own section
    expect(hasDot("hdr")).toBe(true);
    const hdr = open("hdr");
    expect(hdr.querySelector(".hdr-check")!.textContent).toContain("✗");
    // Set it up yourself stays one click away.
    expect(hdr.querySelector(".hdr-manual summary")!.textContent).toBe(i18n.t("desktop.hdrManual.title"));
  });

  it("each fact once: no placeholders, no tier or Proton in the stats, the store in Details", () => {
    render(ghostrunner({ launcher: "heroic", store: "gog" }));
    const text = container!.textContent!;
    expect(text).not.toContain("Player ratings");
    expect(text).not.toContain("Shared configs");
    expect([...container!.querySelectorAll(".gp-stat-label")].map((l) => l.textContent)).toEqual([i18n.t("desktop.library.lastPlayed"), i18n.t("desktop.library.playTime")]);
    const compat = open("compatibility");
    expect(compat.textContent!.split(i18n.t("desktop.library.runsWith")).length - 1).toBe(1);
    expect(compat.textContent).not.toContain(i18n.t("desktop.library.recommended")); // already on ours
    expect(compat.textContent).not.toContain(i18n.t("desktop.library.store"));
    expect(openDetails().textContent).toContain(i18n.t("desktop.library.storeName.gog"));
  });

  it("Controller profile: what it changes, Edit in controller view, the layout and curves; no copy of the controller view's settings", () => {
    render(ghostrunner());
    expect(status("profile")).toBe("2 changes");
    const profile = open("profile");
    expect([...profile.querySelectorAll(".dk-chip")].map((c) => c.textContent)).toHaveLength(2);
    const buttons = [...profile.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain(i18n.t("desktop.editing.open"));
    expect(buttons).toContain(i18n.t("desktop.library.profileCopyCurrent"));
    expect(buttons).toContain(i18n.t("desktop.library.profileDelete"));
    expect([...profile.querySelectorAll(".dk-row > .dk-label")].map((l) => l.textContent)).toEqual([
      i18n.t("desktop.layouts.profileLabel"),
      i18n.t("desktop.curves.profileLeft"),
      i18n.t("desktop.curves.profileRight"),
    ]);
    expect(profile.querySelectorAll('input[type="range"]')).toHaveLength(0);
  });

  it("the player's marks: Controller not detected in Setup (or in the feedback, not both), Supports HDR in HDR", () => {
    render(ghostrunner({ support: "unknown", gamepad: undefined }));
    const marks = open("setup").querySelector<HTMLDetailsElement>("details.gp-marks")!;
    expect(marks.open).toBe(false);
    expect(marks.querySelector("summary")!.textContent).toBe(i18n.t("desktop.library.marksTitle"));
    expect(marks.textContent).toContain(i18n.t("desktop.library.tag.not-detected"));
    expect(marks.textContent).not.toContain(i18n.t("desktop.library.supportsHdr"));
    const hdrMark = [...open("hdr").querySelectorAll<HTMLLabelElement>(".dk-fix")].find((l) => l.textContent!.includes(i18n.t("desktop.library.supportsHdr")))!;
    expect(hdrMark.querySelector("input")!.checked).toBe(true); // the record says so
    expect(open("support").querySelector("#gp-rating")!.textContent).not.toContain(i18n.t("desktop.library.tag.not-detected"));
    // A game on our XInput list: no mark, so the feedback keeps it.
    render(ghostrunner());
    expect(open("support").querySelector("#gp-rating")!.textContent).toContain(i18n.t("desktop.library.tag.not-detected"));
  });

  it("feedback folds under its question with the number ticked", () => {
    render(ghostrunner());
    const fold = open("support").querySelector<HTMLDetailsElement>("#gp-rating details")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe(`${i18n.t("desktop.library.feedbackHint")} (2)`);
    expect(fold.querySelectorAll("input[type=checkbox]").length).toBeGreaterThan(0);
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
    expect(sectionIds()).toEqual(["profile", "setup", "support", "notes"]);
    expect([...container!.querySelectorAll(".gp-tile")]).toHaveLength(3);
    expect(open("setup").textContent).not.toContain(i18n.t("desktop.library.marksTitle"));
    expect(checks()!.querySelector("summary")!.textContent).toBe("✓ All set (1 check)");
    expect(openDetails().textContent).toContain(i18n.t("desktop.library.launcher"));
  });
});

// The rating rates the controller in this game, not the game: it sits in
// DualSense support under the feature list, asks so, and every star names
// what it means (owner: "five stars under a game banner read as rating the game").
describe("rating: how well the DualSense works in this game", () => {
  const stars = () => [...container!.querySelectorAll<HTMLButtonElement>("#gp-rating [role=radio]")];
  // The rating is in DualSense support: rendered while it's open.
  const show = (game: GameEntry = ghostrunner()) => {
    render(game);
    open("support");
  };
  const label = () => $("#gp-rating .gp-rate-label");
  const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

  it("lives in DualSense support under the per-feature list, with its question, feedback and the saved-on-this-PC line", () => {
    show();
    const rating = $('[data-section="support"] #gp-rating')!;
    expect(rating).not.toBeNull();
    expect($('[data-section="support"] .gp-features')!.compareDocumentPosition(rating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rating.querySelector("h3")!.textContent).toBe("How well does your DualSense work in this game?");
    expect(rating.querySelector("[role=radiogroup]")!.getAttribute("aria-labelledby")).toBe(rating.querySelector("h3")!.id);
    expect(rating.querySelector("summary")!.textContent).toContain(i18n.t("desktop.library.feedbackHint"));
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
    open("support");
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
