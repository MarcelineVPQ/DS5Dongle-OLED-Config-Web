// @vitest-environment jsdom
// Every popup is drawn on top, never a pop-under (the owner, 2026-10-14):
// the language menu, the color picker, an ⓘ's bubble, Games' Show menu
// (gamesHome.test.ts) and the Developer channel dialog all join the browser's
// top layer through one hook (topLayer.ts useTopLayer: popover="manual",
// showPopover, placed next to their anchor). A section's body clips only
// while it unfolds. No popup carries a z-index of its own.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import LanguageToggle from "../../src/components/LanguageToggle";
import ColorPicker from "../../src/desktop/colorPicker/ColorPicker";
import { InfoTip } from "../../src/desktop/controls";
import { DevChannelDialog } from "../../src/desktop/pages/AppSettingsPage";
import { placeNear } from "../../src/desktop/topLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let shown: HTMLElement[];
beforeEach(async () => {
  await i18n.changeLanguage("en");
  shown = [];
  // jsdom has no Popover API: record which elements ask for the top layer.
  HTMLElement.prototype.showPopover = function (this: HTMLElement) {
    shown.push(this);
  };
  HTMLElement.prototype.hidePopover = function () {};
  container = document.createElement("div");
  container.className = "dk";
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const onTop = (el: Element | null) => {
  expect(el, "the popup is rendered").not.toBeNull();
  expect(el!.classList.contains("top-layer")).toBe(true);
  expect(el!.getAttribute("popover")).toBe("manual");
  expect(shown).toContain(el);
};

describe("every popup joins the top layer", () => {
  it("the language menu (App settings → Language)", () => {
    act(() => root.render(createElement(LanguageToggle)));
    act(() => container.querySelector<HTMLButtonElement>(".language-toggle-button")!.click());
    onTop(container.querySelector('.dk-menu[role="menu"]'));
  });

  it("the color picker", () => {
    act(() => root.render(createElement(ColorPicker, { value: "#ff0000", onChange: () => undefined, label: "Light bar" })));
    act(() => container.querySelector<HTMLButtonElement>(".cp-swatch")!.click());
    onTop(container.querySelector(".cp-pop"));
  });

  it("an ⓘ's bubble", () => {
    act(() => root.render(createElement(InfoTip, { text: "Longer explanation" })));
    act(() => container.querySelector<HTMLButtonElement>(".dk-info")!.focus());
    onTop(container.querySelector(".dk-info-tip"));
  });

  it("the Developer channel dialog (its backdrop covers the window)", () => {
    vi.stubGlobal("desktop", { getSetting: () => Promise.resolve(null), onUpdateState: () => () => undefined });
    act(() => root.render(createElement(DevChannelDialog, { automatic: false, onJoin: () => undefined, onCancel: () => undefined })));
    onTop(container.querySelector(".dk-dialog-backdrop"));
    vi.unstubAllGlobals();
  });
});

// The language menu is the one popup menu (MenuButton), not a popup of its own
// (bug hunt D2, 0.9.5): arrows / Home / End move, Escape closes it without
// reaching the drawer and puts the focus back on its button, a pick does too.
describe("the language menu is a MenuButton", () => {
  const button = () => container.querySelector<HTMLButtonElement>(".language-toggle-button")!;
  const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]')];
  const key = (k: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
  // jsdom can't focus inside a popover="manual" element: leave the attribute off here (focus is what's tested).
  beforeEach(() => {
    const set = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (name !== "popover") set.call(this, name, value);
    });
  });
  it("keyboard: ↓ opens, arrows / Home / End move, Escape closes, stays in the drawer and returns the focus", () => {
    const drawerKeys = vi.fn();
    act(() => root.render(createElement("div", { onKeyDown: (e: { key: string }) => drawerKeys(e.key) }, createElement(LanguageToggle))));
    expect(container.querySelector(".language-toggle-menu"), "no popup of its own").toBeNull();
    button().focus();
    key("ArrowDown");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(items()).toHaveLength(7);
    expect(
      items()
        .filter((b) => b.getAttribute("aria-checked") === "true")
        .map((b) => b.lang),
    ).toEqual(["en"]);
    expect(document.activeElement).toBe(items()[0]);
    key("ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key("End");
    expect(document.activeElement).toBe(items()[6]);
    key("Home");
    expect(document.activeElement).toBe(items()[0]);
    drawerKeys.mockClear();
    key("Escape");
    expect(drawerKeys, "the drawer's Escape doesn't see it").not.toHaveBeenCalledWith("Escape");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button());
  });
  it("a pick switches the language, closes the menu and returns the focus", async () => {
    act(() => root.render(createElement(LanguageToggle)));
    act(() => button().click());
    act(() =>
      items()
        .find((b) => b.lang === "de")!
        .click(),
    );
    expect(i18n.language).toBe("de");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button());
    await i18n.changeLanguage("en");
  });
});

describe("placeNear: next to its anchor, inside the window", () => {
  const box = (r: Partial<DOMRect>) => ({ getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...r }) as DOMRect }) as Element;
  const pop = (w: number, h: number) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { value: w });
    Object.defineProperty(el, "offsetHeight", { value: h });
    return el;
  };
  it("under the anchor, start edges lined up; end-aligned lines up the right edges", () => {
    const el = pop(100, 50);
    placeNear(el, box({ left: 200, right: 300, top: 100, bottom: 120 }), {});
    expect(el.style.top).toBe("126px");
    expect(el.style.left).toBe("200px");
    placeNear(el, box({ left: 200, right: 300, top: 100, bottom: 120 }), { align: "end" });
    expect(el.style.left).toBe("200px");
  });
  it("above the anchor near the window's bottom; never past the window's right edge", () => {
    const el = pop(200, 100);
    placeNear(el, box({ left: window.innerWidth - 20, right: window.innerWidth - 4, top: window.innerHeight - 30, bottom: window.innerHeight - 10 }), {});
    expect(parseFloat(el.style.top)).toBe(window.innerHeight - 30 - 6 - 100);
    expect(parseFloat(el.style.left)).toBe(window.innerWidth - 200 - 8);
  });
});

describe("the CSS: one mechanism, nothing clipped when settled", () => {
  const css = readFileSync("src/desktop/desktop.css", "utf8") + readFileSync("src/styles.css", "utf8");
  const rule = (sel: string) => {
    const at = css.indexOf(`\n${sel} {`);
    expect(at, sel).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  it("a section's body is overflow: visible when settled, clipped only while it unfolds", () => {
    expect(rule(".dk-sec-body")).toMatch(/overflow: visible;/);
    expect(rule(".dk-sec-body")).not.toMatch(/overflow: (hidden|clip)/);
    const frames = css.slice(css.indexOf("@keyframes dk-sec-unfold"), css.indexOf("@keyframes dk-sec-unfold") + 200);
    expect(frames).toMatch(/from \{\s*height: 0;\s*overflow: hidden;/);
  });
  it("the top layer's reset is there, and no popup has a z-index of its own", () => {
    expect(rule("[popover].top-layer")).toMatch(/position: fixed;[\s\S]*inset: auto;/);
    // loop: test — the popups' classes
    for (const sel of [".cp-pop", ".dk-info-tip", ".dk-menu", ".dk-dialog-backdrop"]) expect(rule(sel), sel).not.toMatch(/z-index/);
    expect(css, "the old card-stacking hack is gone").not.toMatch(/:has\(\.language-toggle-menu\)/);
  });
});
