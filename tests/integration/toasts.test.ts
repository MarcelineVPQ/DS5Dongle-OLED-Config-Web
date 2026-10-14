// @vitest-environment jsdom
// The toast system (docs/BACKLOG.md "Toast system"): one queue for the whole
// app, bottom right, newest last, at most three; each closes by itself after
// its time (waiting while hovered, focused or hidden), or with its ×; read out
// politely; no fade with reduced motion; nothing queued while hidden.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import Toasts from "../../src/desktop/Toasts";
import { announce, clearToasts, showToast, TOAST_ACTION_MS, TOAST_LEAVE_MS, TOAST_MS, TOAST_RESUME_MS } from "../../src/desktop/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers();
  await i18n.changeLanguage("en");
  i18n.addResource("en", "translation", "test.a", "First");
  i18n.addResource("en", "translation", "test.b", "Second");
  i18n.addResource("en", "translation", "test.c", "Third");
  i18n.addResource("en", "translation", "test.d", "Fourth");
  i18n.addResource("en", "translation", "test.undo", "Undo");
  clearToasts();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Toasts)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setVisible(true);
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const show = (key: string, opts?: Parameters<typeof showToast>[1]) => act(() => showToast(key, opts));
const texts = () => [...container.querySelectorAll(".dk-toast .dk-toast-text")].map((e) => e.textContent);
const live = () => [...container.querySelectorAll(".dk-toast:not(.leaving) .dk-toast-text")].map((e) => e.textContent);
const list = () => container.querySelector("ul")!;
// React's enter/leave events come from pointerover/pointerout with a related target.
const pointer = (type: "pointerover" | "pointerout", target: Element, related: Element) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related })));
function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
}

describe("the toast queue", () => {
  it("stacks newest last and keeps at most three (the oldest goes)", () => {
    show("test.a");
    show("test.b");
    show("test.c");
    expect(texts()).toEqual(["First", "Second", "Third"]);
    show("test.d");
    expect(texts()).toEqual(["Second", "Third", "Fourth"]);
  });

  it("never shows the same words twice: showing them again restarts their time", () => {
    show("test.a");
    advance(TOAST_MS - 1000);
    show("test.a");
    expect(texts()).toEqual(["First"]);
    advance(TOAST_MS - 1);
    expect(live()).toEqual(["First"]);
    advance(1);
    expect(live()).toEqual([]);
  });

  it("closes by itself after its time, fades, then goes", () => {
    show("test.a");
    advance(TOAST_MS - 1);
    expect(live()).toEqual(["First"]);
    advance(1);
    expect(container.querySelector(".dk-toast.leaving")).not.toBeNull();
    advance(TOAST_LEAVE_MS);
    expect(texts()).toEqual([]);
  });

  it("gives a toast with an action longer, and runs the action once", () => {
    const run = vi.fn();
    show("test.a", { action: { labelKey: "test.undo", run } });
    advance(TOAST_MS);
    expect(live()).toEqual(["First"]);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo")!.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(live()).toEqual([]);
    expect(TOAST_ACTION_MS).toBeGreaterThan(TOAST_MS);
  });

  it("waits while the pointer is on the stack, then stays a little longer", () => {
    show("test.a");
    advance(TOAST_MS - 100);
    pointer("pointerover", list(), document.body);
    advance(60_000);
    expect(live()).toEqual(["First"]);
    pointer("pointerout", list(), document.body);
    advance(TOAST_RESUME_MS - 1);
    expect(live()).toEqual(["First"]);
    advance(1);
    expect(live()).toEqual([]);
  });

  it("waits while the keyboard focus is on it", () => {
    show("test.a");
    advance(TOAST_MS - 100);
    const close = container.querySelector<HTMLButtonElement>(".dk-toast-close")!;
    act(() => close.focus());
    advance(60_000);
    expect(live()).toEqual(["First"]);
    act(() => close.blur());
    advance(TOAST_RESUME_MS - 1);
    expect(live()).toEqual(["First"]);
    advance(1);
    expect(live()).toEqual([]);
  });

  it("closes with its × right away", () => {
    show("test.a");
    show("test.b");
    act(() => container.querySelector<HTMLButtonElement>(".dk-toast-close")!.click());
    expect(live()).toEqual(["Second"]);
    advance(TOAST_LEAVE_MS);
    expect(texts()).toEqual(["Second"]);
  });

  it("is read out politely, has a name, and its × says what it does", () => {
    show("test.a");
    const region = container.querySelector("section.dk-toasts")!;
    expect(region.getAttribute("aria-label")).toBe("Notifications");
    expect(list().getAttribute("aria-live")).toBe("polite");
    expect(region.querySelector("[role=alert]")).toBeNull(); // never an alert: errors are notices
    const close = container.querySelector(".dk-toast-close")!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(close.getAttribute("type")).toBe("button");
  });

  it("goes at once, without the fade, with reduced motion", () => {
    document.documentElement.setAttribute("data-reduce-motion", "");
    show("test.a");
    act(() => container.querySelector<HTMLButtonElement>(".dk-toast-close")!.click());
    expect(texts()).toEqual([]);
    expect(container.querySelector(".dk-toast.leaving")).toBeNull();
  });

  it("only fades with opacity and transform, and not at all with reduced motion (no animation loop)", () => {
    const css = readFileSync("src/desktop/desktop.css", "utf8");
    const rule = css.match(/\n\.dk-toast \{[^}]*\}/)![0];
    expect(rule).toMatch(/transition:\s*opacity [^;]*,\s*transform [^;]*;/);
    expect(rule).not.toMatch(/animation/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.dk-toast \{\s*transition: none;/);
    expect(css).not.toMatch(/\.dk-toast[^{]*\{[^}]*#[0-9a-f]{3,8}/i); // theme tokens only
  });

  it("queues nothing while the window is hidden, and a shown toast waits until it's back", () => {
    show("test.a");
    advance(1000);
    setVisible(false);
    show("test.b");
    expect(texts()).toEqual(["First"]);
    advance(60_000);
    expect(live()).toEqual(["First"]);
    expect(vi.getTimerCount()).toBe(0);
    setVisible(true);
    advance(TOAST_MS - 1000 - 1); // the rest of its time
    expect(live()).toEqual(["First"]);
    advance(1);
    expect(live()).toEqual([]);
  });

  it("shows an event the narrator has a line for when her caption doesn't (narrator not set up yet)", () => {
    act(() => announce("test.a", "app_saved"));
    expect(texts()).toEqual(["First"]);
  });
});
