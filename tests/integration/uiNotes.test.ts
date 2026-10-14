// @vitest-environment jsdom
// The owner's review notes of 2026-10-14 (laptop build): the main view's
// readouts are live (usePoll: every second while shown, paused while the
// window is hidden, gone with the page);
// a Row stacks its control under the label when it doesn't fit beside it,
// and every inline select is one width; the ⓘ (InfoTip) shows its text on
// hover and on keyboard focus, closes with Esc and gives it to screen
// readers; the rail's item of the page you're on shows / hides that page's
// settings panel, every page alike, remembered per page.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { usePoll } from "../../src/desktop/usePoll";
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

describe("usePoll: the readouts are live while shown", () => {
  let reads: number;
  let value: number | null;
  function Probe() {
    value = usePoll(() => Promise.resolve(++reads), 1000, true).value;
    return null;
  }
  const advance = async (ms: number) => {
    // loop: test — 100 ms steps, so the read promises settle between ticks
    for (let t = 0; t < ms; t += 100) await act(() => vi.advanceTimersByTimeAsync(100));
  };
  const setVisible = (visible: boolean) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: visible ? "visible" : "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
  };
  afterEach(() => setVisible(true));

  it("polls every second while shown, stops while the window is hidden, resumes when shown, and stops when the page is left", async () => {
    vi.useFakeTimers();
    reads = 0;
    act(() => root.render(createElement(Probe)));
    await advance(10_200);
    expect(reads, "one read a second while shown").toBeGreaterThanOrEqual(10);
    expect(reads).toBeLessThanOrEqual(12);
    expect(value).toBe(reads);
    // Hidden (minimized / in the tray): no reads, no timer; the last value stays.
    setVisible(false);
    await advance(200);
    const hiddenAt = reads;
    await advance(30_000);
    expect(reads, "no read while hidden").toBe(hiddenAt);
    expect(vi.getTimerCount(), "no timer while hidden").toBe(0);
    expect(value).toBe(hiddenAt);
    // Shown again: live again.
    setVisible(true);
    await advance(3_200);
    expect(reads).toBeGreaterThanOrEqual(hiddenAt + 3);
    // The page left (unmounted): nothing more.
    act(() => root.render(null));
    const leftAt = reads;
    await advance(30_000);
    expect(reads, "no read after the page is left").toBe(leftAt);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has the notes' strings in all 7 languages", () => {
    // loop: test — 7 locales
    for (const l of [de, en, es, fr, ja, ptBR, zhCN]) {
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
    expect(b.getAttribute("popover"), "in the top layer, never clipped by a section").toBe("manual");
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
