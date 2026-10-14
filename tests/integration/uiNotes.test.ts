// @vitest-environment jsdom
// The owner's review notes of 2026-10-14 (laptop build): the main view's
// readouts read once and then only while Watch live runs (useSnapshotPoll);
// a Row stacks its control under the label when it doesn't fit beside it,
// and every inline select is one width; the ⓘ (InfoTip) shows its text on
// hover and on keyboard focus, closes with Esc and gives it to screen
// readers; the rail's item of the page you're on shows / hides that page's
// settings panel, every page alike, remembered per page.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { LIVE_WATCH_MS, useSnapshotPoll, type SnapshotPoll } from "../../src/desktop/usePoll";
import { InfoTip, Row, SELECT_PX } from "../../src/desktop/controls";
import { PANEL_HIDDEN_KEY, SplitView } from "../../src/desktop/accordion/Section";
import { railPress, type RailItem } from "../../src/desktop/AppRail";
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
  localStorage.clear();
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  container.className = "dk";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSnapshotPoll: one read, then only Watch live (30 s)", () => {
  let poll: SnapshotPoll<number>;
  let reads: boolean[];
  function Probe() {
    poll = useSnapshotPoll(
      (live) => {
        reads.push(live);
        return Promise.resolve(reads.length);
      },
      1000,
      true,
    );
    return null;
  }
  const advance = async (ms: number) => {
    // loop: test — 100 ms steps, so the read promises settle between ticks
    for (let t = 0; t < ms; t += 100) await act(() => vi.advanceTimersByTimeAsync(100));
  };

  it("reads once as a snapshot (with its time) and then nothing, however long the page stays open", async () => {
    vi.useFakeTimers();
    reads = [];
    act(() => root.render(createElement(Probe)));
    await advance(200);
    expect(reads).toEqual([false]);
    expect(poll.value).toBe(1);
    expect(poll.asOf).not.toBeNull();
    expect(poll.live).toBe(false);
    await advance(120_000);
    expect(reads, "no read without Watch live").toEqual([false]);
    expect(vi.getTimerCount(), "no timer left running").toBe(0);
  });

  it("Watch live reads every second for 30 s with a countdown, stops by itself, and a press restarts the 30 s", async () => {
    vi.useFakeTimers();
    reads = [];
    act(() => root.render(createElement(Probe)));
    await advance(200);
    act(() => poll.watch());
    await advance(100);
    expect(poll.live).toBe(true);
    expect(poll.secondsLeft).toBe(30);
    await advance(10_000);
    expect(poll.secondsLeft).toBeLessThanOrEqual(20);
    // Pressed again: another 30 s from now.
    act(() => poll.watch());
    await advance(100);
    expect(poll.secondsLeft).toBe(30);
    await advance(LIVE_WATCH_MS + 1000);
    expect(poll.live).toBe(false);
    const live = reads.filter(Boolean).length;
    expect(live).toBeGreaterThanOrEqual(38); // ~10 + ~30 reads, one a second
    expect(live).toBeLessThanOrEqual(43);
    // The last live read stays shown; nothing more is read.
    expect(poll.value).toBe(reads.length);
    await advance(60_000);
    expect(reads.filter(Boolean)).toHaveLength(live);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refresh() takes one new snapshot (after the timings' Reset)", async () => {
    vi.useFakeTimers();
    reads = [];
    act(() => root.render(createElement(Probe)));
    await advance(200);
    act(() => poll.refresh());
    await advance(200);
    expect(reads).toEqual([false, false]);
    expect(poll.value).toBe(2);
  });

  it("says As of, Watch live and the countdown in all 7 languages", () => {
    // loop: test — 7 locales
    for (const l of [de, en, es, fr, ja, ptBR, zhCN]) {
      expect(l.desktop.dash.asOf).toContain("{{time}}");
      expect(l.desktop.dash.watchLive).toContain("{{seconds}}");
      expect(l.desktop.dash.liveLeft).toContain("{{seconds}}");
      expect(l.desktop.common.moreInfo).toBeTruthy();
      expect(l.desktop.dev.restartsPage).toBeTruthy();
      expect(l.desktop.rail.again).toBeTruthy();
    }
  });
});

describe("Row: the control stacks under the label when it doesn't fit beside it", () => {
  // jsdom has no layout: the row's width and the control's natural width are given.
  const layout = (rowW: number, ctlW: number, selectW = 0) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dk-row") ? rowW : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.classList.contains("dk-ctl") ? ctlW : this.tagName === "SELECT" ? selectW : 0;
      return { width: w, height: 20, top: 0, left: 0, right: w, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };
    });
  };
  const row = (control: "select" | "range") =>
    createElement(Row, {
      label: "Simulated core1",
      sub: "Restarts the page.",
      children:
        control === "select" ? createElement("select", { className: "dk-select", "aria-label": "x" }, createElement("option", null, "Runs normally")) : createElement("input", { type: "range" }),
    });
  const stacked = () => container.querySelector(".dk-row")!.classList.contains("stack");

  it("beside the label when it fits (a 390 px panel, a short select)", () => {
    layout(368, 170, 170);
    act(() => root.render(row("select")));
    expect(stacked()).toBe(false);
  });

  it("under the label, full width, when the select needs more than the one select width", () => {
    layout(368, 240, SELECT_PX + 60);
    act(() => root.render(row("select")));
    expect(stacked()).toBe(true);
  });

  it("under the label when the panel is too narrow for label and control (the drawer)", () => {
    layout(250, 200);
    act(() => root.render(row("range")));
    expect(stacked()).toBe(true);
  });

  it("measured again only when the row's width changes, never while it isn't laid out", () => {
    layout(0, 500, 500);
    act(() => root.render(row("select")));
    expect(stacked()).toBe(false); // a hidden page: not judged
  });
});

describe("InfoTip: the ⓘ", () => {
  const render = () => act(() => root.render(createElement(Row, { label: "Hardware acceleration", info: "Draws with the graphics card.", children: createElement("button", null, "x") })));
  const btn = () => container.querySelector<HTMLButtonElement>(".dk-info")!;
  const bubble = () => container.querySelector<HTMLElement>(".dk-info-tip");

  it("is a named button beside the label; screen readers get the text as its description", () => {
    render();
    expect(btn().closest(".dk-label")).not.toBeNull();
    expect(btn().getAttribute("aria-label")).toBe("More information");
    const desc = document.getElementById(btn().getAttribute("aria-describedby")!)!;
    expect(desc.textContent).toBe("Draws with the graphics card.");
    expect(desc.getAttribute("role")).toBe("tooltip");
    expect(bubble()).toBeNull();
  });

  it("shows on hover, hides when the pointer leaves", () => {
    render();
    act(() => void btn().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(bubble()?.textContent).toBe("Draws with the graphics card.");
    act(() => void btn().dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(bubble()).toBeNull();
  });

  it("shows on keyboard focus (Tab), Esc closes it; inside the window", () => {
    render();
    act(() => btn().focus());
    const b = bubble()!;
    expect(b.textContent).toBe("Draws with the graphics card.");
    expect(b.parentElement).toBe(container); // drawn in the app's root, never clipped by a section
    expect(parseFloat(b.style.left)).toBeGreaterThanOrEqual(8);
    act(() => void btn().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(bubble()).toBeNull();
  });

  it("a click toggles it (touch), and it closes on scroll", () => {
    act(() => root.render(createElement(InfoTip, { text: "Longer explanation" })));
    act(() => btn().click());
    expect(bubble()).not.toBeNull();
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(bubble()).toBeNull();
    act(() => btn().click());
    act(() => btn().click());
    expect(bubble()).toBeNull();
  });
});

describe("the rail: the page you're on, again, shows / hides its panel (every page alike)", () => {
  const PAGES: RailItem[] = ["controller", "dongle", "games", "app", "about"];
  // The page shown: its SplitView, as each page renders one.
  function Page({ page }: { page: string }) {
    useEffect(() => undefined, []);
    return createElement(SplitView, {
      page,
      main: createElement("p", null, "main"),
      title: page,
      state: { revealed: null, isOpen: () => false } as never,
      children: null,
    });
  }
  const split = () => container.querySelector(".dk-split")!;
  const hidden = () => split().classList.contains("panel-hidden");
  beforeEach(() => {
    // jsdom lays nothing out: the shown page has boxes.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{}] as unknown as DOMRectList);
  });

  it.each(PAGES)("%s: a press on its own item toggles its panel, remembered; another item navigates and leaves it", (page) => {
    const go = vi.fn();
    act(() => root.render(createElement(Page, { page })));
    expect(hidden(), "first visit: shown").toBe(false);
    expect(split().classList.contains("drawer-open"), "narrow: the drawer follows the same state").toBe(true);
    act(() => railPress(page, page, go));
    expect(hidden()).toBe(true);
    expect(split().classList.contains("drawer-open")).toBe(false);
    expect(localStorage.getItem(PANEL_HIDDEN_KEY(page))).toBe("1");
    expect(go).not.toHaveBeenCalled();
    // Another page's item: navigates; this page's panel stays as it is.
    const other = PAGES.find((p) => p !== page)!;
    act(() => railPress(other, page, go));
    expect(go).toHaveBeenCalledWith(other);
    expect(hidden()).toBe(true);
    // Back later: as it was left.
    act(() => root.render(null));
    act(() => root.render(createElement(Page, { page })));
    expect(hidden()).toBe(true);
    act(() => railPress(page, page, go));
    expect(hidden()).toBe(false);
    expect(localStorage.getItem(PANEL_HIDDEN_KEY(page))).toBe("0");
  });

  it("only the page on screen answers (Games → Home kept behind a game page stays as it is)", () => {
    vi.restoreAllMocks();
    act(() => root.render(createElement(Page, { page: "games" })));
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [] as unknown as DOMRectList);
    act(() => railPress("games", "games", vi.fn()));
    expect(hidden()).toBe(false);
  });

  it("each item's tooltip says what a second press does on the page you're on", () => {
    // loop: test — 7 locales
    for (const l of [de, en, es, fr, ja, ptBR, zhCN]) expect(l.desktop.rail).not.toHaveProperty("controllerAgain");
  });
});
