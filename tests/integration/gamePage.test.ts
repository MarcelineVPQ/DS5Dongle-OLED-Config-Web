// @vitest-environment jsdom
// A game's page puts what needs the player first and folds what's fine:
// Setup with everything ✓ is one "All set" line (the ✓ list, HDR checklist
// included, opens from it); anything ✗ or a fix waiting shows open, above the
// controller profile. Each fact has one place, and no placeholder cards.
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(async () => {
  await i18n.changeLanguage("en");
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
const cards = () => [...container!.querySelectorAll<HTMLElement>(".gp-col section.dk-card")].map((s) => s.id);
const hdrChecklist = () => $("#gp-setup .hdr-check");
const checks = () => $<HTMLDetailsElement>("#gp-setup details.gp-checks");

describe("setupStatus", () => {
  const reqs = (game: GameEntry, hdr: HdrSystem) => hdrGameReqs(hdr, game, { ourProton: OUR_PROTON });

  it("all ✓: nothing needs the player; every ✓ line is counted", () => {
    const game = ghostrunner();
    const s = setupStatus(game, reqs(game, HDR_READY));
    expect(s).toEqual({ attention: false, hdrOk: true, passed: 2 + reqs(game, HDR_READY).length });
  });

  it("any HDR ✗ needs the player, and the HDR list isn't counted as passed", () => {
    const game = ghostrunner({ hdr: "missing" });
    const s = setupStatus(game, reqs(game, HDR_NO_LAYER));
    expect(s.attention).toBe(true);
    expect(s.hdrOk).toBe(false);
    expect(s.passed).toBe(2);
  });

  it("a fix waiting, an unbuildable standard gamepad or the player's own mode need the player", () => {
    expect(setupStatus(ghostrunnerNeedsSetup(), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ gamepad: "no-build" }), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ mode: { state: "own", api: "dx12", flag: "-dx12", unlocks: "rayTracing", own: "-dx11" } }), []).attention).toBe(true);
    expect(setupStatus(ghostrunner({ gamepad: undefined, mode: undefined }), [])).toEqual({ attention: false, hdrOk: true, passed: 0 });
  });
});

describe("game page", () => {
  it("all set: Setup is one folded line after the profile, the HDR checklist inside it", () => {
    render(ghostrunner());
    const fold = checks()!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("✓ All set (10 checks)");
    expect(hdrChecklist()!.closest("details")).toBe(fold);
    expect($("#gp-setup .dk-chip.warn")).toBeNull();
    expect(cards().indexOf("gp-profile")).toBeLessThan(cards().indexOf("gp-setup"));
  });

  it("needs attention: Setup comes first and open, the ✗ checklist outside the fold", () => {
    render(ghostrunnerNeedsSetup(), HDR_NO_LAYER);
    expect(cards()[0]).toBe("gp-setup");
    expect($("#gp-setup .dk-chip.warn")!.textContent).toBe(i18n.t("desktop.library.needsAttention"));
    expect(hdrChecklist()!.closest("details")).toBeNull();
    expect(hdrChecklist()!.textContent).toContain("✗");
    expect(checks()!.querySelector("summary")!.textContent).toBe("1 check passed");
    expect([...container!.querySelectorAll("#gp-setup button")].some((b) => b.textContent === i18n.t("desktop.library.setupReview"))).toBe(true);
    // Set it up yourself stays one click away.
    expect($("#gp-setup .hdr-manual summary")!.textContent).toBe(i18n.t("desktop.hdrManual.title"));
  });

  it("moving Setup between the two places keeps it (its Apply note survives the rescan)", () => {
    render(ghostrunnerNeedsSetup(), HDR_NO_LAYER);
    const before = $("#gp-setup");
    render(ghostrunner());
    expect(cards()[0]).toBe("gp-profile");
    expect($("#gp-setup")).toBe(before);
  });

  it("each fact once: no placeholders, no tier or Proton in the stats, the store in Details", () => {
    render(ghostrunner({ launcher: "heroic", store: "gog" }));
    const text = container!.textContent!;
    expect(text).not.toContain("Player ratings");
    expect(text).not.toContain("Shared configs");
    expect([...container!.querySelectorAll(".gp-stat-label")].map((l) => l.textContent)).toEqual([i18n.t("desktop.library.lastPlayed"), i18n.t("desktop.library.playTime")]);
    expect(text.split(i18n.t("desktop.library.runsWith")).length - 1).toBe(1);
    expect(text.split(i18n.t("desktop.library.recommended")).length - 1).toBe(0); // already on ours
    expect($("#gp-compat")!.textContent).not.toContain(i18n.t("desktop.library.store"));
    expect($("#gp-details")!.textContent).toContain(i18n.t("desktop.library.storeName.gog"));
  });

  it("the player's marks fold under one line; Controller not detected is in Setup or in the feedback, not both", () => {
    render(ghostrunner({ support: "unknown", gamepad: undefined }));
    const marks = [...container!.querySelectorAll<HTMLDetailsElement>("#gp-setup details")].find((d) => d.querySelector("summary")!.textContent!.startsWith(i18n.t("desktop.library.marksTitle")))!;
    expect(marks.open).toBe(false);
    expect(marks.textContent).toContain(i18n.t("desktop.library.tag.not-detected"));
    expect(marks.textContent).toContain(i18n.t("desktop.library.supportsHdr"));
    expect(marks.querySelector("summary")!.textContent).toBe(`${i18n.t("desktop.library.marksTitle")} (1)`); // Supports HDR is ticked
    expect($("#gp-rating")!.textContent).not.toContain(i18n.t("desktop.library.tag.not-detected"));
    // A game on our XInput list: no mark, so the feedback keeps it.
    render(ghostrunner());
    expect($("#gp-rating")!.textContent).toContain(i18n.t("desktop.library.tag.not-detected"));
  });

  it("feedback folds under its question with the number ticked", () => {
    render(ghostrunner());
    const fold = $<HTMLDetailsElement>("#gp-rating details")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe(`${i18n.t("desktop.library.feedbackHint")} (2)`);
    expect(fold.querySelectorAll("input[type=checkbox]").length).toBeGreaterThan(0);
  });

  it("Windows: no Proton or HDR parts, the store and launcher in Details", () => {
    render(ghostrunner({ hdr: undefined, gamepad: undefined, runner: null, usesOurProton: false, envFlags: [] }), HDR_READY, "win32");
    expect($("#gp-compat")).toBeNull();
    expect(hdrChecklist()).toBeNull();
    expect(container!.textContent).not.toContain(i18n.t("desktop.library.marksTitle"));
    expect(checks()!.querySelector("summary")!.textContent).toBe("✓ All set (1 check)");
    expect($("#gp-details")!.textContent).toContain(i18n.t("desktop.library.launcher"));
  });
});

// The rating rates the controller in this game, not the game: it sits in
// DualSense support under the feature list, asks so, and every star names
// what it means (owner: "five stars under a game banner read as rating the game").
describe("rating: how well the DualSense works in this game", () => {
  const stars = () => [...container!.querySelectorAll<HTMLButtonElement>("#gp-rating [role=radio]")];
  const label = () => $("#gp-rating .gp-rate-label");
  const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

  it("lives in DualSense support under the per-feature list, with its question, feedback and the saved-on-this-PC line", () => {
    render(ghostrunner());
    const rating = $("#gp-support #gp-rating")!;
    expect(rating).not.toBeNull();
    expect(cards()).not.toContain("gp-rating");
    expect($("#gp-support .gp-features")!.compareDocumentPosition(rating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rating.querySelector("h3")!.textContent).toBe("How well does your DualSense work in this game?");
    expect(rating.querySelector("[role=radiogroup]")!.getAttribute("aria-labelledby")).toBe(rating.querySelector("h3")!.id);
    expect(rating.querySelector("summary")!.textContent).toContain(i18n.t("desktop.library.feedbackHint"));
    expect(rating.textContent).toContain(i18n.t("desktop.library.shareSoon"));
  });

  it("each star names how the controller works; the chosen one's words show next to the stars", () => {
    render(ghostrunner()); // rated 4
    expect(stars().map((b) => b.title)).toEqual(["Doesn't work", "Barely works", "Works with problems", "Works well", "Works perfectly"]);
    expect(stars()[0].getAttribute("aria-label")).toBe("1 star: Doesn't work");
    expect(stars()[4].getAttribute("aria-label")).toBe("5 stars: Works perfectly");
    expect(stars().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(label()!.textContent).toBe("Works well");
    expect(label()!.classList.contains("preview")).toBe(false);
  });

  it("hover and focus preview a star's words; leaving shows the chosen one again", () => {
    render(ghostrunner());
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
    expect(label()).toBeNull();
    expect(stars().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("keyboard: one tab stop, arrows and Home/End pick a star and move focus; saved in the same rating field", () => {
    vi.useFakeTimers();
    try {
      render(ghostrunner());
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
