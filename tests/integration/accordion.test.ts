// @vitest-environment jsdom
// The accordion (src/desktop/accordion/): one section open at a time, the pin
// dot keeps one open, what's open and pinned is remembered (pins per board and
// slot on the controller page), closed sections render nothing, the keyboard
// moves between headers, and deep links open their section. Then the pages
// built on it (App settings, About, the Controller and Pico 2 W pages, Games
// → Home and a game's page): every setting from the plan's table (the
// accordion sketch's MAPPING.md) renders in exactly one section, nothing
// lost, no dupes; and every deep link target exists. Readouts (Pico
// diagnostics, Controller info, a game's details) are main-view blocks
// (MainBlock), never sections: always shown, no fold, nothing remembered.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { fakeBridge, fakeDesktop, gamesReport, ghostrunnerNeedsSetup, GHOSTRUNNER_INFO, GHOSTRUNNER_RECORD, HDR_NO_LAYER } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.scrollTo ??= () => undefined;
// jsdom lacks these: SVG shape geometry, media queries and canvases (the live drawing).
(globalThis as Record<string, unknown>).SVGGeometryElement ??= class extends SVGElement {};
window.matchMedia ??= ((media: string) => Object.assign(new EventTarget(), { media, matches: false, onchange: null, addListener() {}, removeListener() {} })) as never;
HTMLCanvasElement.prototype.getContext = (() => null) as never;
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Loaded after the dev-build flag is set (App settings' Developer section).
let m: {
  i18n: typeof import("../../src/i18n").default;
  Section: typeof import("../../src/desktop/accordion/Section");
  acc: typeof import("../../src/desktop/accordion/useAccordion");
  block: typeof import("../../src/desktop/accordion/MainBlock");
  sections: typeof import("../../src/desktop/accordion/sections");
  AppSettingsPage: typeof import("../../src/desktop/pages/AppSettingsPage").default;
  AboutPage: typeof import("../../src/desktop/pages/AboutPage").default;
  notices: typeof import("../../src/desktop/notices");
  openTasks: typeof import("../../src/desktop/openTasks");
  ControllerView: typeof import("../../src/desktop/live/ControllerView");
  useDs5Bridge: typeof import("../../src/hooks/useDs5Bridge").useDs5Bridge;
  storage: typeof import("../../src/desktop/storage");
  devPreview: typeof import("../../src/desktop/devPreview");
  GamesPage: typeof import("../../src/desktop/pages/GamesPage").default;
  GamePage: typeof import("../../src/desktop/library/GamePage").default;
};
const t = ((key: string, o?: Record<string, unknown>) => m.i18n.t(key, o)) as TFunction;

beforeAll(async () => {
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  vi.resetModules();
  m = {
    i18n: (await import("../../src/i18n")).default,
    Section: await import("../../src/desktop/accordion/Section"),
    acc: await import("../../src/desktop/accordion/useAccordion"),
    block: await import("../../src/desktop/accordion/MainBlock"),
    sections: await import("../../src/desktop/accordion/sections"),
    AppSettingsPage: (await import("../../src/desktop/pages/AppSettingsPage")).default,
    AboutPage: (await import("../../src/desktop/pages/AboutPage")).default,
    notices: await import("../../src/desktop/notices"),
    openTasks: await import("../../src/desktop/openTasks"),
    ControllerView: await import("../../src/desktop/live/ControllerView"),
    useDs5Bridge: (await import("../../src/hooks/useDs5Bridge")).useDs5Bridge,
    storage: await import("../../src/desktop/storage"),
    devPreview: await import("../../src/desktop/devPreview"),
    GamesPage: (await import("../../src/desktop/pages/GamesPage")).default,
    GamePage: (await import("../../src/desktop/library/GamePage")).default,
  };
  await m.i18n.changeLanguage("en");
});

const SETTINGS = {
  closeToTray: true,
  launchAtLogin: false,
  startMinimized: false,
  hardwareAcceleration: true,
  hdrLighting: true,
  checkForUpdates: true,
  autoInstallUpdates: false,
  updateChannel: "dev",
  gamesScanAllowed: true,
  updatesAsked: true,
};
// window.desktop: the settings above; anything else answers nothing.
const desktop = () =>
  new Proxy({ platform: "linux", appVersion: "0.9.5-dev.11", buildId: "", getSettings: () => Promise.resolve(SETTINGS) } as Record<string, unknown>, {
    get: (o, p: string) => (p in o ? o[p] : p.startsWith("on") ? () => () => undefined : () => Promise.resolve(undefined)),
  });

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("desktop", desktop());
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
const render = async (el: ReactNode) => {
  await act(async () => root.render(el));
  await act(async () => undefined); // settings reads
};
const heads = () => [...container.querySelectorAll<HTMLButtonElement>(".dk-sec-toggle")];
const head = (id: string) => container.querySelector<HTMLButtonElement>(`[data-section="${id}"] .dk-sec-toggle`)!;
const pinOf = (id: string) => container.querySelector<HTMLButtonElement>(`[data-section="${id}"] .dk-sec-pin`)!;
const openIds = () => [...container.querySelectorAll<HTMLElement>(".dk-sec.open")].map((s) => s.dataset.section);
const click = (b: HTMLElement) => act(() => b.click());
// A main-view block (MainBlock): its heading, and its body.
const blockHead = (id: string) => container.querySelector<HTMLElement>(`.dk-split-main [data-block="${id}"] .dk-block-head`)!;
const blockBody = (id: string) => container.querySelector<HTMLElement>(`.dk-split-main [data-block="${id}"] .dk-block-body`);
// A hardware zone's spec line as shown (its own text, not the ⓘ's hidden tooltip).
// loop: test
const lineText = (zone: HTMLElement) =>
  [...(zone.querySelector(".zone-sub")?.childNodes ?? [])]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("");

// A small page on the accordion: the body counts how often it renders.
let bodyRenders = 0;
function TestPage({ scope = "app", task = null }: { scope?: string; task?: "graphics" | null }) {
  const { Accordion, Section } = m.Section;
  const acc = m.acc.useAccordion("app", scope, task);
  const Icon = (() => null) as never;
  return createElement(Accordion, {
    state: acc,
    // loop: test fixture
    children: ["language", "appearance", "graphics"].map((id) =>
      createElement(Section, {
        key: id,
        id,
        icon: Icon,
        title: id,
        status: `${id} status`,
        task: id === task ? "to do" : null,
        children: () => {
          bodyRenders++;
          return createElement("p", { className: "body" }, id);
        },
      }),
    ),
  });
}

// The same page in a SplitView (the panel's header, with the panel menu).
function SplitTestPage() {
  const { SplitView, Section } = m.Section;
  const acc = m.acc.useAccordion("app", "app");
  const Icon = (() => null) as never;
  return createElement(SplitView, {
    page: "app",
    title: "Test",
    main: createElement("p", null, "main"),
    state: acc,
    // loop: test fixture
    children: ["language", "appearance", "graphics"].map((id) => createElement(Section, { key: id, id, icon: Icon, title: id, children: () => createElement("p", { className: "body" }, id) })),
  });
}
// jsdom keeps the contents of a popover="…" element unfocusable (it has no
// showPopover to show it), so the panel menu stays in the page flow here.
const noPopover = () => {
  const set = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
    if (name !== "popover") set.call(this, name, value);
  });
};
const menuButton = () => container.querySelector<HTMLButtonElement>('.dk-split-head [aria-haspopup="menu"]')!;
const menuItem = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((b) => b.textContent === name)!;

describe("the accordion", () => {
  it("opens one section at a time; closed sections render no body", async () => {
    bodyRenders = 0;
    await render(createElement(TestPage));
    expect(openIds()).toEqual([]);
    expect(container.querySelectorAll(".body")).toHaveLength(0);
    expect(bodyRenders).toBe(0);
    click(head("language"));
    expect(openIds()).toEqual(["language"]);
    expect(head("language").getAttribute("aria-expanded")).toBe("true");
    click(head("appearance"));
    expect(openIds()).toEqual(["appearance"]);
    expect(container.querySelectorAll(".body")).toHaveLength(1);
    click(head("appearance"));
    expect(openIds()).toEqual([]);
  });

  it("keeps a pinned section open while the others fold, and remembers both across restarts", async () => {
    await render(createElement(TestPage));
    click(pinOf("language"));
    expect(pinOf("language").getAttribute("aria-pressed")).toBe("true");
    expect(pinOf("language").getAttribute("aria-label")).toBe("Keep language open");
    click(head("appearance"));
    click(head("graphics"));
    expect(openIds()).toEqual(["language", "graphics"]);
    act(() => root.unmount());
    root = createRoot(container);
    await render(createElement(TestPage));
    expect(openIds()).toEqual(["language", "graphics"]);
    // The header of a pinned section folds it and takes the pin off.
    click(head("language"));
    expect(openIds()).toEqual(["graphics"]);
    expect(pinOf("language").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps pins per scope (the controller page: per board and pairing slot)", async () => {
    expect(m.acc.pinScope("controller", "Pico 2 W", 1)).toBe("controller:Pico 2 W:1");
    expect(m.acc.pinScope("game")).toBe("game");
    await render(createElement(TestPage, { scope: m.acc.pinScope("controller", "Pico 2 W", 0) }));
    click(pinOf("graphics"));
    await render(createElement(TestPage, { scope: m.acc.pinScope("controller", "Pico 2 W", 1) }));
    expect(pinOf("graphics").getAttribute("aria-pressed")).toBe("false");
    await render(createElement(TestPage, { scope: m.acc.pinScope("controller", "Pico 2 W", 0) }));
    expect(pinOf("graphics").getAttribute("aria-pressed")).toBe("true");
  });

  it("the panel menu: Collapse all folds every section, pinned ones too, and they open again next visit", async () => {
    noPopover();
    await render(createElement(SplitTestPage));
    click(pinOf("language"));
    click(head("graphics"));
    expect(openIds()).toEqual(["language", "graphics"]);
    expect(menuButton().getAttribute("aria-label")).toBe("Panel options");
    click(menuButton());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    // The menu opens with the focus on its first item.
    expect(document.activeElement).toBe(menuItem("Collapse all"));
    expect(container.querySelector('[role="menu"]')!.textContent).not.toMatch(/Expand/);
    click(menuItem("Collapse all"));
    expect(openIds()).toEqual([]);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
    // Still pinned; nothing left to fold, so Collapse all is disabled and says why.
    expect(pinOf("language").getAttribute("aria-pressed")).toBe("true");
    click(menuButton());
    expect(menuItem("Collapse all").disabled).toBe(true);
    expect(menuItem("Collapse all").title).toBe("Every section is already folded");
    click(menuButton());
    // A folded pinned section's header opens it again, still pinned.
    click(head("language"));
    expect(openIds()).toEqual(["language"]);
    expect(pinOf("language").getAttribute("aria-pressed")).toBe("true");
    click(menuButton());
    click(menuItem("Collapse all"));
    // Next visit: the pinned section is open again, the folded one stays folded.
    act(() => root.unmount());
    root = createRoot(container);
    await render(createElement(SplitTestPage));
    expect(openIds()).toEqual(["language"]);
  });

  it("the panel menu: Clear pins unpins this page's sections; keyboard and Escape", async () => {
    noPopover();
    await render(createElement(SplitTestPage));
    click(menuButton());
    expect(menuItem("Clear pins").disabled).toBe(true);
    expect(menuItem("Clear pins").title).toBe("No pinned sections on this page");
    click(menuButton());
    click(pinOf("language"));
    click(pinOf("graphics"));
    expect(openIds()).toEqual(["language", "graphics"]);
    const key = (k: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
    menuButton().focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Collapse all"));
    key("ArrowDown");
    expect(document.activeElement).toBe(menuItem("Clear pins"));
    key("Escape");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
    click(menuButton());
    click(menuItem("Clear pins"));
    expect(pinOf("language").getAttribute("aria-pressed")).toBe("false");
    expect(pinOf("graphics").getAttribute("aria-pressed")).toBe("false");
    expect(m.acc.readPins("app")).toEqual([]);
  });

  it("opens the first section with a task on the first visit only", async () => {
    await render(createElement(TestPage, { task: "graphics" }));
    expect(openIds()).toEqual(["graphics"]);
    expect(container.querySelector('[data-section="graphics"] .dk-sec-task')).not.toBeNull();
    expect(container.querySelector('[data-section="graphics"] .dk-sec-status')!.textContent).toBe("to do");
    click(head("graphics"));
    act(() => root.unmount());
    root = createRoot(container);
    await render(createElement(TestPage, { task: "graphics" }));
    expect(openIds()).toEqual([]);
  });

  it("moves between headers with the arrow keys, Home and End", async () => {
    await render(createElement(TestPage));
    const key = (k: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
    heads()[0].focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(heads()[1]);
    key("End");
    expect(document.activeElement).toBe(heads()[2]);
    key("ArrowDown");
    expect(document.activeElement).toBe(heads()[0]);
    key("ArrowUp");
    expect(document.activeElement).toBe(heads()[2]);
    key("Home");
    expect(document.activeElement).toBe(heads()[0]);
    // Enter / Space are the button's own: focus stays on the header.
    click(heads()[0]);
    expect(document.activeElement).toBe(heads()[0]);
  });

  it("opens a deep link's section, focuses its header and flashes it; also one made before the page mounted", async () => {
    m.acc.revealSection("app", "graphics");
    await render(createElement(TestPage));
    expect(openIds()).toEqual(["graphics"]);
    expect(document.activeElement).toBe(head("graphics"));
    expect(container.querySelector('[data-section="graphics"]')!.classList.contains("dk-flash")).toBe(true);
    act(() => m.acc.revealSection("app", "language"));
    expect(openIds()).toEqual(["language"]);
    // A link for another page waits for that page.
    act(() => m.acc.revealSection("about", "credits"));
    expect(openIds()).toEqual(["language"]);
  });
});

// The plan's table (MAPPING.md, "App settings" and "About"): each section and
// what it holds, by the label each row or button shows.
const KNOBS = ["cardOpacity", "backdropDim", "backdropBlur", "depth"].map((k) => `desktop.knobs.${k}`);
const APP_INVENTORY: Record<string, string[]> = {
  language: ["desktop.settings2.language"],
  appearance: ["desktop.settings2.theme", "desktop.glass.label", "desktop.accent.label", "desktop.backdrop.label", ...KNOBS, "desktop.customColors.toggle"],
  accessibility: ["desktop.colorVision.label", "desktop.settings2.reduceMotion", "desktop.narrator.voice", "desktop.narrator.captions", "desktop.narrator.test"],
  startup: ["desktop.live.closeToTray", "desktop.live.launchAtLogin", "desktop.live.startMinimized"],
  graphics: ["desktop.live.hardwareAcceleration", "desktop.hdr.label", "desktop.knobs.hdrNits"],
  updates: ["desktop.live.checkForUpdates", "desktop.live.autoInstall", "desktop.channel.label", "desktop.setup.checkUpdates", "desktop.channel.backToStable"],
  privacy: ["desktop.games.readLaunchers"],
  dismissed: [], // none dismissed: nothing to do, its status says so (page rule 6)
  developer: ["desktop.dev.model", "desktop.dev.colorway", "desktop.dev.simulated", "desktop.dev.fakeSlots", "desktop.dev.updates", "desktop.dev.hdrTitle"],
};

// Page rule 6 (IA audit Q9): a section with nothing to do shows its header
// and status only (no toggle, no pin, no body); every section that opens has
// something to set or do in it (a control that isn't a notice's ×).
const isIdle = (id: string) => !!container.querySelector(`[data-section="${id}"].idle`);
function expectIdle(id: string) {
  const sec = container.querySelector(`[data-section="${id}"]`)!;
  expect(sec.querySelector("button.dk-sec-toggle, .dk-sec-pin, .dk-sec-body"), `${id}: idle, nothing to open`).toBeNull();
  expect(sec.querySelector(".dk-sec-status")?.textContent, `${id}: idle, its status says why`).toBeTruthy();
}
function expectSomethingToDo(id: string) {
  const body = container.querySelector(`[data-section="${id}"] .dk-sec-body`)!;
  const controls = [...body.querySelectorAll("button, input, select, textarea, a[href]")].filter((c) => !c.closest(".dk-notice"));
  expect(controls.length, `${id}: an open section has something to set or do (page rule 6)`).toBeGreaterThan(0);
}
const closeOpen = () => {
  for (const sec of container.querySelectorAll<HTMLElement>(".dk-sec.open:not(.pinned)")) click(sec.querySelector<HTMLButtonElement>("button.dk-sec-toggle")!);
};

// What an open section shows: its rows' labels, its buttons and its texts.
const labelsIn = (id: string) => {
  const body = container.querySelector(`[data-section="${id}"] .dk-sec-body`);
  if (!body) return [];
  const labels = [...body.querySelectorAll(".dk-row > .dk-label")].map((l) => l.firstChild?.textContent?.trim() ?? "");
  const buttons = [...body.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
  // A heading's own text (its ⓘ's tooltip text isn't on screen).
  const own = (el: Element) =>
    [...el.childNodes]
      .filter((n) => !(n instanceof Element && n.matches("[role=tooltip], .dk-info")))
      .map((n) => n.textContent)
      .join("")
      .trim();
  const texts = [...body.querySelectorAll("p, h3")].map(own);
  return [...labels, ...buttons, ...texts];
};
const appSettings = () =>
  createElement(m.AppSettingsPage, {
    bridge: { firmwareVersion: null, identity: null } as never,
    fw: { refreshLatest: () => Promise.resolve({ latest: null }) } as never,
  });

describe("App settings on the accordion", () => {
  it("has every section of the plan, in its order", async () => {
    await render(appSettings());
    expect(container.querySelectorAll(".dk-card")).toHaveLength(0); // no settings cards left
    expect([...container.querySelectorAll<HTMLElement>(".dk-sec")].map((s) => s.dataset.section)).toEqual([...m.sections.SECTIONS.app]);
    expect(Object.keys(APP_INVENTORY)).toEqual([...m.sections.SECTIONS.app]);
  });

  it("shows every setting in exactly one section: nothing lost, no dupes", async () => {
    await render(appSettings());
    const seen = new Map<string, string[]>();
    for (const id of m.sections.SECTIONS.app) {
      if (isIdle(id)) {
        expectIdle(id);
        expect(APP_INVENTORY[id], id).toEqual([]);
        continue;
      }
      click(head(id));
      await act(async () => undefined);
      expect(openIds()).toEqual([id]);
      expectSomethingToDo(id);
      // loop: test
      for (const label of labelsIn(id)) seen.set(label, [...(seen.get(label) ?? []), id]);
    }
    for (const [id, keys] of Object.entries(APP_INVENTORY)) for (const key of keys) expect(seen.get(m.i18n.t(key)), `${key} in ${id}`).toEqual([id]);
    const dupes = [...seen].filter(([label, ids]) => label && ids.length > 1);
    expect(dupes).toEqual([]);
  });

  it("says each section's state in its header, from the settings it holds", async () => {
    await render(appSettings());
    const status = (id: string) => container.querySelector(`[data-section="${id}"] .dk-sec-status`)?.textContent;
    expect(status("language")).toBe("English");
    expect(status("startup")).toBe("Close to tray");
    expect(status("graphics")).toBe("Hardware acceleration on · HDR lighting on");
    expect(status("updates")).toBe("Development · asks before installing");
    expect(status("privacy")).toBe("Games may read your launchers");
    expect(status("dismissed")).toBe("No dismissed notices.");
  });

  it("an app update: the rail's task opens Updates, with its yellow dot and the task as its status", async () => {
    const app = { phase: "available" as const, version: "1.2.3", size: 1_000_000 };
    const { tasks } = m.openTasks.openTasks(t, { app: app as never, fw: { available: false, latest: null, state: { phase: "idle" } as never }, connected: true, board: [], gamesCount: 0 });
    const task = tasks.find((x) => x.place === "app")!;
    expect(task.section).toBe("updates");
    m.acc.revealSection("app", task.section as "updates");
    await render(createElement(m.notices.NoticeTasksContext.Provider, { value: { tasks, goTo: () => undefined } }, appSettings()));
    expect(openIds()).toEqual(["updates"]);
    expect(container.querySelector('[data-section="updates"] .dk-sec-task')).not.toBeNull();
    expect(container.querySelector('[data-section="updates"] .dk-sec-status')!.textContent).toBe(task.text);
  });

  // Decision 2026-10-15 (owner, best judgement): a hidden panel stays hidden.
  // Arriving through a rail item's task dot (DesktopApp's goTo(item, section,
  // keepHidden)) opens and marks the section; it's scrolled to and flashed
  // when the panel is shown, once.
  it("the rail's task dot leaves a hidden panel hidden: the dot on the rail item, the section opened, shown when the panel is", async () => {
    const app = { phase: "available" as const, version: "1.2.3", size: 1_000_000 };
    const { tasks } = m.openTasks.openTasks(t, { app: app as never, fw: { available: false, latest: null, state: { phase: "idle" } as never }, connected: true, board: [], gamesCount: 0 });
    const task = tasks.find((x) => x.place === "app")!;
    localStorage.setItem(m.Section.PANEL_HIDDEN_KEY("app"), "1");
    m.acc.revealSection("app", "updates", undefined, { keepHidden: true });
    await render(createElement(m.notices.NoticeTasksContext.Provider, { value: { tasks, goTo: () => undefined } }, appSettings()));
    const split = container.querySelector(".dk-split")!;
    const sec = container.querySelector<HTMLElement>('[data-section="updates"]')!;
    expect(split.classList.contains("panel-hidden"), "still hidden").toBe(true);
    expect(localStorage.getItem(m.Section.PANEL_HIDDEN_KEY("app"))).toBe("1");
    expect(openIds()).toEqual(["updates"]); // opened and marked, ready
    expect(sec.querySelector(".dk-sec-task")).not.toBeNull();
    expect(sec.classList.contains("dk-flash"), "not flashed while hidden").toBe(false);
    // No show button on the page (2026-10-16): the task goes to the page's rail item (AppRail's railDot).
    expect(container.querySelector(".dk-split-show")).toBeNull();
    expect(m.Section.panelTasks.get().get("app")).toBe(task.text);
    // Shown through the rail item (togglePanel): the section is scrolled to, focused and flashed.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [{}] as unknown as DOMRectList); // jsdom lays nothing out
    const show = () => act(() => m.Section.togglePanel());
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    show();
    expect(split.classList.contains("panel-hidden")).toBe(false);
    expect(scrolled).toHaveBeenCalled();
    expect(sec.classList.contains("dk-flash")).toBe(true);
    expect(document.activeElement).toBe(head("updates"));
    expect(m.Section.panelTasks.get().get("app"), "shown: the section carries the dot").toBeNull();
    // Hidden and shown again: no second flash for the same link.
    sec.classList.remove("dk-flash");
    click(container.querySelector<HTMLButtonElement>(`.dk-split-head button[aria-label="${m.i18n.t("desktop.accordion.hidePanel")}"]`)!);
    expect(m.Section.panelTasks.get().get("app")).toBe(task.text);
    show();
    expect(sec.classList.contains("dk-flash")).toBe(false);
  });

  it("any other deep link (a notice's Go to, a tile) still shows a hidden panel", async () => {
    localStorage.setItem(m.Section.PANEL_HIDDEN_KEY("app"), "1");
    await render(appSettings());
    expect(container.querySelector(".dk-split")!.classList.contains("panel-hidden")).toBe(true);
    expect(m.Section.panelTasks.get().get("app")).toBeNull(); // no task: no dot
    await act(async () => m.acc.revealSection("app", "graphics"));
    expect(container.querySelector(".dk-split")!.classList.contains("panel-hidden")).toBe(false);
    expect(openIds()).toEqual(["graphics"]);
  });

  it("Privacy's turn-off question is a notice inside its section", async () => {
    await render(appSettings());
    click(head("privacy"));
    click(container.querySelector<HTMLButtonElement>('[data-section="privacy"] [role="switch"]')!);
    const notice = container.querySelector('[data-section="privacy"] .dk-sec-body > .dk-notice[role="alert"]');
    expect(notice?.textContent).toContain(m.i18n.t("desktop.games.readLaunchersOff"));
  });
});

describe("About on the accordion", () => {
  it("has a section per text, each listing its chapters; a section's text shows in the main view", async () => {
    await render(createElement(m.AboutPage));
    expect([...container.querySelectorAll<HTMLElement>(".dk-sec")].map((s) => s.dataset.section)).toEqual([...m.sections.SECTIONS.about]);
    // Nothing open on a first visit: the guide shows.
    expect(container.querySelector(".dk-about-text h1")?.textContent).toContain("guide");
    click(head("guide"));
    const chapters = [...container.querySelectorAll('[data-section="guide"] .dk-chapter')].map((c) => c.textContent);
    expect(chapters[0]).toBe("1. Build your board");
    expect(chapters).toContain("9. Troubleshooting");
    click(head("credits"));
    expect(container.querySelector(".dk-studio")).not.toBeNull();
    // Credits has no level-2 headings: its level-3 ones are the chapters (never an empty section).
    expect([...container.querySelectorAll('[data-section="credits"] .dk-chapter')].map((c) => c.textContent)).toEqual(["Built on", "Third-party assets and code"]);
    // Firmware changes is left out: a checkout without the firmware repo next to it bundles a one-line placeholder.
    // loop: test
    for (const id of m.sections.SECTIONS.about.filter((x) => x !== "firmware")) {
      click(head(id));
      expect(container.querySelectorAll(`[data-section="${id}"] .dk-chapter`).length, id).toBeGreaterThan(0);
    }
    click(head("roadmap"));
    expect(container.querySelector(".dk-roadmap")).not.toBeNull();
    expect([...container.querySelectorAll('[data-section="roadmap"] .dk-chapter')].map((c) => c.textContent)).toEqual(["In the next build", "In progress", "Planned", "Ideas"]);
  });

  it("App changes opens on its newest releases; older ones show on request or from their chapter", async () => {
    const releases = () => [...container.querySelectorAll(".dk-about-text h2")].map((h) => h.textContent);
    const older = () => [...container.querySelectorAll<HTMLButtonElement>(".dk-about-text .dk-btn")].find((b) => b.textContent === m.i18n.t("desktop.about.showOlder"));
    await render(createElement(m.AboutPage));
    click(head("changes"));
    const chapters = [...container.querySelectorAll<HTMLButtonElement>('[data-section="changes"] .dk-chapter')];
    const shown = releases();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(chapters.length);
    click(older()!);
    expect(releases()).toHaveLength(chapters.length);
    expect(older()).toBeUndefined();
    // Folded and opened again: the newest releases; the last chapter shows the older ones.
    click(head("guide"));
    click(head("changes"));
    expect(releases()).toEqual(shown);
    click(container.querySelectorAll<HTMLButtonElement>('[data-section="changes"] .dk-chapter')[chapters.length - 1]);
    expect(releases()).toHaveLength(chapters.length);
  });

  it("App changes carries the 'Updated to' task until it's opened", async () => {
    const seen = vi.fn();
    await render(createElement(m.AboutPage, { whatsNew: "0.9.5-dev.12", onSeen: seen }));
    expect(openIds()).toEqual(["changes"]); // the first section with a task opens on a first visit
    expect(container.querySelector('[data-section="changes"] .dk-sec-task')).not.toBeNull();
    expect(seen).toHaveBeenCalled();
  });
});

// Firmware up to date (no update service in this test).
const FW = {
  available: false,
  backToStable: false,
  latest: null,
  problem: null,
  state: { phase: "idle" },
  start: () => Promise.resolve(),
  refreshLatest: () => Promise.resolve({ latest: null }),
  dismiss: () => undefined,
} as never;
// The live pages as DesktopApp shows them: the app's connection to the
// simulated board, its update state, and the view around the live controller.
function Live({ view }: { view: "overview" | "dongle" | "app" }) {
  const bridge = m.useDs5Bridge();
  return bridge.isConnected ? createElement(m.ControllerView.default, { bridge, fw: FW, view, onView: () => undefined }) : null;
}
const live = async (view: "overview" | "dongle" | "app") => {
  m.storage.writePref(m.devPreview.SIMULATED_KEY, "1");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await render(createElement(Live, { view }));
  // loop: test — until the simulated board answers (connect, identity, settings)
  for (let i = 0; i < 100 && !container.querySelector(".dk-sec"); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  await act(() => new Promise((r) => setTimeout(r, 50)));
};

// The plan's table (MAPPING.md, "Controller page" and "Pico 2 W page"), by
// what each section shows: its rows' labels, headings and buttons.
const CONTROLLER_INVENTORY: Record<string, string[]> = {
  lightbar: ["desktop.lightbar.mode", "desktop.lightbar.modes.rainbow", "desktop.lightbar.favorites"],
  triggers: ["desktop.live.pull", "desktop.settings.triggerReduce", "desktop.triggers.title", "desktop.triggers.presets.weapon"],
  haptics: ["haptics.audioBufferLabel", "desktop.live.hapticLevel", "autoHaptics.sectionTitle", "autoHaptics.modeLabel"],
  speaker: [
    "desktop.settings.speakerLevel",
    "desktop.settings.speakerBoost",
    "desktop.settings.lockVolume",
    "desktop.settings.audioOutput",
    "desktop.live.speakerLevel",
    "desktop.audioTest.speakerTitle",
  ],
  mic: ["haptics.btMicLabel", "desktop.settings.micInput", "desktop.settings.micLevel", "desktop.settings.echoCancel", "desktop.audioTest.micTitle"],
  buttons: ["desktop.live.remapApply", "desktop.layouts.title", "desktop.layouts.saveAs"],
  sticks: ["desktop.calib.title", "desktop.calib.leftStick", "desktop.curves.title", "desktop.calib.triggers"],
  slots: ["desktop.slots.wipe"],
};
// The Pico 2 W page's panel (IA audit Q10): the OLED first, the danger zone last.
const DONGLE_INVENTORY: Record<string, string[]> = {
  oled: ["desktop.settings.brightness", "behavior.screenDimTimeoutLabel", "behavior.screenOffTimeoutLabel", "desktop.settings.controllerWakes"],
  power: ["desktop.settings.idleDisconnect", "behavior.inactiveTimeLabel", "desktop.settings.pcSleep", "desktop.settings.sleepControllerOff"],
  usb: ["behavior.pollingRateLabel", "behavior.controllerModeLabel", "actions.reconnect"],
  lights: ["desktop.settings.picoLed", "desktop.settings.statusPin", "desktop.settings.statusPinGpio", "desktop.settings.statusPinMode"],
  firmware: ["desktop.firmware.check"],
  device: ["desktop.firmware.enterBootsel", "desktop.firmware.factoryReset"],
};
// Each section opened in turn: everything listed shows in it, and no row or
// heading shows in two sections (nothing lost, no dupes).
async function inventory(page: "controller" | "dongle", table: Record<string, string[]>) {
  expect([...container.querySelectorAll<HTMLElement>(".dk-sec")].map((s) => s.dataset.section)).toEqual([...m.sections.SECTIONS[page]]);
  expect(Object.keys(table)).toEqual([...m.sections.SECTIONS[page]]);
  expect(container.querySelectorAll(".dk-card, .live-data-card.ctrl-info")).toHaveLength(0); // no settings cards left
  const rows = new Map<string, Set<string>>();
  for (const id of m.sections.SECTIONS[page]) {
    click(head(id));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(openIds()).toEqual([id]);
    expectSomethingToDo(id);
    const seen = labelsIn(id);
    // loop: test
    for (const key of table[id]) expect(seen, `${key} in ${id}`).toContain(m.i18n.t(key));
    const body = container.querySelector(`[data-section="${id}"] .dk-sec-body`)!;
    // loop: test
    for (const x of body.querySelectorAll(".dk-row > .dk-label, .dk-subhead")) {
      // A row by its label under its group's heading ("Mode" of the light bar and of Audio Auto Haptics are two settings).
      const group = x.closest(".dk-sec-group")?.querySelector(".dk-subhead")?.textContent?.trim() ?? "";
      const l = `${group}/${(x.firstChild?.textContent ?? "").trim()}`;
      rows.set(l, new Set([...(rows.get(l) ?? []), id]));
    }
  }
  closeOpen();
  expect(openIds()).toEqual([]);
  expect(container.querySelectorAll(".dk-sec-body")).toHaveLength(0); // folded: nothing rendered
  expect([...rows].filter(([, ids]) => ids.size > 1)).toEqual([]);
}

describe("the Controller page on the accordion", () => {
  it("has every section of the plan, each setting in exactly one", async () => {
    await live("overview");
    await inventory("controller", CONTROLLER_INVENTORY);
    // The panel's title is the controller's colorway and model.
    expect(container.querySelector(".dk-split-head h2")?.textContent).toBe("Cosmic Red DualSense");
    // Every header says its state.
    // loop: test
    for (const id of m.sections.SECTIONS.controller) expect(container.querySelector(`[data-section="${id}"] .dk-sec-status`)?.textContent, id).toBeTruthy();
  });

  it("shows Controller info in the main view under the drawing, always open (no fold), with Refresh next to it", async () => {
    await live("overview");
    expect(container.querySelector(".dk-split-panel [data-block], .dk-split-panel [data-section='info']")).toBeNull();
    expect(blockHead("info").textContent).toContain(m.i18n.t("desktop.ctrlInfo.title"));
    // A heading, not a toggle: nothing to fold, nothing remembered.
    expect(blockHead("info").tagName).toBe("H3");
    expect(container.querySelector(".dk-block-toggle, .dk-block [aria-expanded]")).toBeNull();
    // Under the drawing.
    const ctl = container.querySelector(".dk-split-main .live-ctl")!;
    expect(ctl.compareDocumentPosition(blockHead("info")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(blockBody("info")?.textContent).toContain(m.i18n.t("desktop.ctrlInfo.refresh"));
    expect(Object.keys(localStorage).filter((k) => k.startsWith("ds5.block."))).toEqual([]);
  });

  it("a newer official firmware: Sony's How to update steps are shown in Controller info, compact (no fold)", async () => {
    const { Ds5BridgeClient } = await import("../../src/protocol/bridgeClient");
    const { FakeDongle } = await import("../support/fakeDongle");
    const { default: ControllerInfo, useControllerInfo } = await import("../../src/desktop/live/ControllerInfo");
    const client = new Ds5BridgeClient(new FakeDongle({ protoMinor: 17 }));
    await client.checkCompatible();
    const identity = await client.identity();
    // Sony publishes 9.90 on every DualSense line: newer than any controller.
    const latest = { "0004": 0x0990, "000B": 0x0990, "000E": 0x0990 };
    vi.stubGlobal("desktop", { platform: "linux", officialControllerFirmware: () => Promise.resolve({ latest, problem: null }) });
    const bridge = { client, identity } as never;
    const Info = () => createElement(ControllerInfo, { data: useControllerInfo(bridge), power: null });
    act(() => root.render(createElement(Info)));
    // loop: test — waits for the reads (≤ 1 s)
    for (let i = 0; i < 100 && !container.querySelector(".dk-fw-steps"); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
    const steps = container.querySelector(".dk-fw-howto")!;
    expect(steps.querySelector("details, summary")).toBeNull();
    expect(steps.querySelector(".dk-subhead")!.textContent).toBe(m.i18n.t("desktop.ctrlInfo.howToUpdate"));
    expect(steps.querySelector(".dk-fw-steps")!.textContent).toContain(m.i18n.t("desktop.ctrlInfo.howToPs5"));
  });

  // Page rule 5: settings → the section's own live meter → its test group, titled "<Sony term> test", last.
  it("every section with a test ends with it, its live meter (if any) right before it", async () => {
    await live("overview");
    const TESTS: Record<string, { test: string; meter?: string }> = {
      triggers: { test: "desktop.triggers.title", meter: "desktop.live.pull" },
      haptics: { test: "desktop.grips.testTitle", meter: "desktop.live.hapticLevel" },
      speaker: { test: "desktop.audioTest.speakerTitle", meter: "desktop.live.speakerLevel" },
      mic: { test: "desktop.audioTest.micTitle" },
    };
    for (const [id, { test, meter }] of Object.entries(TESTS)) {
      click(head(id));
      await act(() => new Promise((r) => setTimeout(r, 30)));
      const groups = [...container.querySelectorAll(`[data-section="${id}"] .dk-sec-body > .dk-sec-group`)].map((g) => g.querySelector(".dk-subhead")?.firstChild?.textContent ?? "");
      expect(groups.at(-1), `${id}: its test last`).toBe(m.i18n.t(test));
      expect(m.i18n.t(test).toLowerCase(), `${id}: "<term> test"`).toMatch(/test|prueba|teste|测试|テスト/);
      if (meter) expect(groups.at(-2), `${id}: its meter right before the test`).toBe(m.i18n.t(meter));
    }
    // Microphone level and Echo cancellation are settings above the test, not inside it.
    const micGroup = [...container.querySelectorAll('[data-section="mic"] .dk-sec-group')].at(-1)!;
    expect(micGroup.textContent).not.toContain(m.i18n.t("desktop.settings.micLevel"));
  });

  it("says what a click on the drawing does right under it, and keeps the line (hidden) while a part is picked", async () => {
    await live("overview");
    const hint = () => [...container.querySelectorAll<HTMLElement>(".live-hint")].find((p) => p.textContent === m.i18n.t("desktop.live.pickHint"))!;
    expect(container.querySelector(".dk-split-main .live-hero")!.nextElementSibling).toBe(hint());
    act(() => void container.querySelector(`.live-ctl [data-part="lightbar"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(hint().classList.contains("live-hint-idle")).toBe(true);
    expect(hint().getAttribute("aria-hidden")).toBe("true");
  });

  it("a click on the drawing opens the part's section (a button: Button assignments at its row)", async () => {
    await live("overview");
    const part = (p: string) => container.querySelector(`.live-ctl [data-part="${p}"]`)!;
    act(() => void part("lightbar").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openIds()).toEqual(["lightbar"]);
    act(() => void part("speaker").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openIds()).toEqual(["speaker"]);
    act(() => void part("cross").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openIds()).toEqual(["buttons"]);
    expect(container.querySelector('[data-row="btn-13"]')?.classList.contains("dk-flash")).toBe(true);
    act(() => void part("ps").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(openIds()).toEqual(["slots"]);
  });
});

describe("the Pico 2 W page on the accordion", () => {
  it("has every section of the plan, each setting in exactly one; Diagnostics is in the main view, read live every second", async () => {
    const { Ds5BridgeClient } = await import("../../src/protocol/bridgeClient");
    const counters = vi.spyOn(Ds5BridgeClient.prototype, "readAudioCounters"); // 0xF5
    const cpu = vi.spyOn(Ds5BridgeClient.prototype, "readCpu"); // 0xFC
    await live("dongle");
    expect(container.querySelector(".dk-split-panel [data-block]")).toBeNull();
    expect(container.querySelector(".dk-block-toggle, .dk-block [aria-expanded]")).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 300)));
    // Live: a read of each about every second, no button to press.
    expect(counters).toHaveBeenCalled();
    expect(cpu).toHaveBeenCalled();
    const first = cpu.mock.calls.length;
    await act(() => new Promise((r) => setTimeout(r, 2300)));
    expect(cpu.mock.calls.length, "0xFC read live").toBeGreaterThanOrEqual(first + 2);
    expect(counters.mock.calls.length, "0xF5 read live").toBeGreaterThanOrEqual(first + 2);
    expect(container.querySelector('[data-block="diagnostics"] button.dash-watch')).toBeNull();
    // Graphs, audio counters, the timings: all in the block, shown, in the data's order (link → audio → timing).
    const diagText = blockBody("diagnostics")?.textContent ?? "";
    // loop: test
    for (const key of ["desktop.dash.usb", "desktop.dash.audio", "desktop.dash.timing.title"]) expect(diagText, key).toContain(m.i18n.t(key));
    expect(diagText.indexOf(m.i18n.t("desktop.dash.usb"))).toBeLessThan(diagText.indexOf(m.i18n.t("desktop.dash.audio")));
    expect(diagText.indexOf(m.i18n.t("desktop.dash.audio"))).toBeLessThan(diagText.indexOf(m.i18n.t("desktop.dash.timing.title")));
    // The board's specs: its zone's title line (name, then chip · cores · clock · SRAM · flash · wireless), not in Diagnostics.
    const zone = container.querySelector<HTMLElement>(".dk-split-main .pico-zone")!;
    expect(zone.querySelector("h3")?.textContent).toBe("Pico 2 W");
    expect(lineText(zone)).toMatch(/^RP2350 · 2× Cortex-M33 · \d+ MHz · 520 KB · 4 MB · CYW43439$/);
    expect(zone.querySelectorAll(".dash-gauge")).toHaveLength(3);
    expect(diagText).not.toContain("RP2350");
    counters.mockRestore();
    cpu.mockRestore();
    await inventory("dongle", DONGLE_INVENTORY);
    expect(container.querySelector(".dk-split-head h2")?.textContent).toBe("Pico 2 W");
    // The dials stay in the main view.
    expect(container.querySelectorAll(".dk-split-main .dash-gauge")).toHaveLength(3);
  }, 15_000);

  it("puts the OLED first: the module named, the mirror with KEY0 / KEY1, its live readings and specs beside it, none of it in Diagnostics", async () => {
    await live("dongle");
    await act(() => new Promise((r) => setTimeout(r, 300)));
    const hero = container.querySelector<HTMLElement>(".dk-split-main .oled-hero")!;
    expect(hero).not.toBeNull();
    // The first thing in the main view, before the dials and Diagnostics.
    expect(container.querySelector(".dk-split-main .dongle-main")?.firstElementChild).toBe(hero);
    expect(hero.querySelector("h3")?.textContent).toBe("Waveshare Pico-OLED-1.3");
    expect(hero.textContent).toContain("DS5 Dongle OLED Edition");
    // One spec line in the title, the keys and "not detected" behind its ⓘ: no Specs card.
    expect(lineText(hero)).toBe("1.3″ · 128 × 64 · SH1107 · SPI");
    expect(hero.querySelector(".zone-sub [role=tooltip]")?.textContent).toContain("KEY0 / KEY1");
    expect(hero.querySelectorAll(".dash-card")).toHaveLength(1);
    expect(hero.querySelector(".dcon canvas.dcon-oled")).not.toBeNull();
    // The keys sit on the module, KEY0 above KEY1.
    expect([...hero.querySelectorAll(".dcon-module .dcon-key")].map((k) => k.getAttribute("aria-label"))).toEqual(["KEY0", "KEY1"]);
    // Its readings: in the hero, once.
    // loop: test
    for (const key of ["desktop.dash.oledState", "desktop.dash.oledScreen", "desktop.dash.oledFps", "desktop.dash.oledFrame"]) {
      expect(hero.textContent, key).toContain(m.i18n.t(key));
      expect(blockBody("diagnostics")?.textContent ?? "", key).not.toContain(m.i18n.t(key));
    }
    expect(blockBody("diagnostics")?.textContent ?? "").not.toContain("Pico-OLED-1.3");
    // Live: the simulated board's screen named, e.g. "1/11 · Status".
    expect(hero.querySelector(".oled-stats")?.textContent).toMatch(/\d+\/11 · \w/);
  });

  it("KEY0 / KEY1 on the mirror press the board's keys (Space works too); the screen follows", async () => {
    await live("dongle");
    await act(() => new Promise((r) => setTimeout(r, 300)));
    const screenNow = () => /(\d+)\/11/.exec(container.querySelector(".oled-stats")?.textContent ?? "")?.[1];
    const key = (k: 0 | 1) => container.querySelector<HTMLButtonElement>(`.dcon-key-${k}`)!;
    expect(key(0).getAttribute("aria-disabled")).toBe("false");
    expect(key(0).title).toMatch(/^KEY0: /);
    const before = Number(screenNow());
    const press = async (k: 0 | 1) => {
      act(() => void key(k).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      act(() => void key(k).dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
      // loop: test — until the mirror shows the new screen
      for (let i = 0; i < 50 && Number(screenNow()) === before; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    };
    await press(0);
    expect(Number(screenNow())).toBe((before % 11) + 1);
    await act(() => new Promise((r) => setTimeout(r, 200)));
    const after = Number(screenNow());
    act(() => void key(1).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    act(() => void key(1).dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    // loop: test — until the mirror shows the previous screen
    for (let i = 0; i < 50 && Number(screenNow()) === after; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(Number(screenNow())).toBe(before);
  });

  it("the controller buttons beside the mirror press the board's screen: a tap moves Settings, △ held fills its bar and is sent as a hold", async () => {
    await live("dongle");
    await act(() => new Promise((r) => setTimeout(r, 300)));
    const board = m.devPreview.simulatedBoard()!.dongle()!;
    const pad = (b: string) => container.querySelector<HTMLButtonElement>(`.dpad-btn[data-button="${b}"]`)!;
    // Beside the module, in the hero: R1, the directional buttons, △ ○ ✕ □.
    expect([...container.querySelectorAll(".oled-hero .dpad .dpad-btn")].map((b) => b.getAttribute("data-button"))).toEqual([
      "r1",
      "up",
      "left",
      "right",
      "down",
      "triangle",
      "square",
      "circle",
      "cross",
    ]);
    // Status ignores them all: disabled, and the tooltip says so.
    expect(pad("up").getAttribute("aria-disabled")).toBe("true");
    expect(pad("up").title).toContain("Status");
    // KEY1 back from Status = Settings (the last screen).
    const key1 = container.querySelector<HTMLButtonElement>(".dcon-key-1")!;
    act(() => void key1.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    act(() => void key1.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    // loop: test — until the mirror shows Settings
    for (let i = 0; i < 50 && pad("up").getAttribute("aria-disabled") !== "false"; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(board.oledScreen).toBe(10);
    expect(pad("down").getAttribute("aria-disabled")).toBe("false");
    expect(pad("circle").getAttribute("aria-disabled")).toBe("true"); // Settings doesn't use ○
    expect(pad("down").title).toMatch(/Settings: next setting/);
    expect(pad("triangle").title).toMatch(/Hold 2 s/);
    // A tap (Space): one step down.
    const tap = async (b: string) => {
      const n = board.oledScreens.presses.length;
      act(() => void pad(b).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      act(() => void pad(b).dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
      // loop: test — until the board took the press
      for (let i = 0; i < 50 && board.oledScreens.presses.length === n; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    };
    await tap("down");
    expect(board.oledScreens.sel).toBe(1);
    expect(board.oledScreens.presses.at(-1)).toEqual(["down", 0]);
    // △ held: the bar fills over 2 s (CSS, --hold-ms), and the release sends the held time.
    const tri = pad("triangle");
    act(() => void tri.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    expect(tri.classList.contains("held")).toBe(true);
    expect(tri.classList.contains("holdable")).toBe(true);
    expect(tri.style.getPropertyValue("--hold-ms")).toBe("2000ms");
    await act(() => new Promise((r) => setTimeout(r, 400)));
    act(() => void tri.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    // loop: test — until the board took the press
    for (let i = 0; i < 50 && board.oledScreens.presses.at(-1)?.[0] !== "triangle"; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
    const [, held] = board.oledScreens.presses.at(-1)!;
    expect(held).toBeGreaterThanOrEqual(350);
    expect(tri.classList.contains("held")).toBe(false);
  });

  it("a deep link (the rail's board-problem dot, the tray's Diagnostics) scrolls to the Diagnostics block and flashes it", async () => {
    m.block.revealBlock("dongle", "diagnostics"); // before the page mounts: taken when it does
    await live("dongle");
    expect(blockBody("diagnostics")).not.toBeNull();
    expect(document.activeElement).toBe(blockHead("diagnostics"));
    expect(container.querySelector('[data-block="diagnostics"]')?.classList.contains("dk-flash")).toBe(true);
    // "More in Diagnostics" under the dials does the same.
    blockHead("diagnostics").blur();
    container.querySelector('[data-block="diagnostics"]')!.classList.remove("dk-flash");
    click(container.querySelector<HTMLButtonElement>(".dash-more")!);
    expect(document.activeElement).toBe(blockHead("diagnostics"));
    expect(container.querySelector('[data-block="diagnostics"]')?.classList.contains("dk-flash")).toBe(true);
  });

  it("a firmware update and a board problem open their places from the rail", () => {
    const { tasks } = m.openTasks.openTasks(t, {
      app: { phase: "idle" } as never,
      fw: { available: true, latest: { version: "v2" }, state: { phase: "idle" } as never },
      connected: true,
      board: [{ reason: "mic-decoder", text: "mic" }],
      gamesCount: 0,
    });
    expect(tasks.filter((x) => x.place === "dongle").map((x) => x.section)).toEqual(["firmware", "diagnostics"]);
  });
});

describe("App settings beside the live controller", () => {
  it("shows the drawing in the main view and its sections at the right, like every page", async () => {
    await live("app");
    expect(container.querySelector(".dk-split-main .live-ctl")).not.toBeNull();
    expect([...container.querySelectorAll<HTMLElement>(".dk-split-panel .dk-sec")].map((s) => s.dataset.section)).toEqual([...m.sections.SECTIONS.app]);
  });
});

// The plan's table (MAPPING.md, "Games Home" and "Game page"), by what each
// section's body says (its texts, buttons and row labels).
// [] = nothing to do in this state: the section shows its status only (page rule 6).
const GAMES_INVENTORY: Record<string, string[]> = {
  launchers: ["desktop.games.intro", "desktop.games.rescan"],
  proton: [], // ours installed and current
  recommended: ["desktop.games.changesHint", "desktop.games.review"],
  history: ["desktop.games.undoShort"],
};
const GAME_INVENTORY: Record<string, string[]> = {
  profile: ["desktop.library.profileCopyCurrent", "desktop.editing.open", "desktop.library.profileDelete", "desktop.layouts.profileLabel", "desktop.curves.profileLeft"],
  setup: ["desktop.library.setupReview", "desktop.library.marksTitle"],
  compatibility: [], // no other build to pick, nothing recommended, ours not needed

  hdr: ["desktop.hdrManual.title"],
  report: ["desktop.library.rateTitle", "desktop.library.tag.weak-vibration"],
  notes: [],
};
// Each section opened in turn: everything listed is in it (by text; some
// carry a count or a name), and no row label or heading shows in two.
async function textInventory(page: "games" | "game", table: Record<string, string[]>) {
  expect([...container.querySelectorAll<HTMLElement>(".dk-split-panel .dk-sec")].map((x) => x.dataset.section)).toEqual([...m.sections.SECTIONS[page]]);
  expect(Object.keys(table)).toEqual([...m.sections.SECTIONS[page]]);
  expect(container.querySelectorAll(".dk-card")).toHaveLength(0); // no settings cards left
  const rows = new Map<string, Set<string>>();
  for (const id of m.sections.SECTIONS[page]) {
    if (isIdle(id)) {
      expectIdle(id);
      expect(table[id], id).toEqual([]);
      continue;
    }
    const toggle = head(id);
    if (toggle.getAttribute("aria-expanded") !== "true") click(toggle);
    await act(async () => undefined);
    expect(openIds(), id).toEqual([id]);
    expectSomethingToDo(id);
    const body = container.querySelector(`[data-section="${id}"] .dk-sec-body`)!;
    // loop: test
    for (const key of table[id]) expect(body.textContent, `${key} in ${id}`).toContain(m.i18n.t(key, { count: 1, name: "", launcher: "" }).replace(/ +$/, ""));
    // loop: test
    for (const x of body.querySelectorAll(".dk-row > .dk-label, .dk-subhead, dt")) {
      const l = (x.firstChild?.textContent ?? "").trim();
      rows.set(l, new Set([...(rows.get(l) ?? []), id]));
    }
  }
  click(head(m.sections.SECTIONS[page].at(-1)!));
  expect(openIds()).toEqual([]);
  expect(container.querySelectorAll(".dk-sec-body")).toHaveLength(0); // folded: nothing rendered
  expect([...rows].filter(([, ids]) => ids.size > 1)).toEqual([]);
}

describe("App settings' main view", () => {
  it("is the drawing and its color / status line only: no tiles or data cards (none react to an app setting)", async () => {
    await live("app");
    expect(container.querySelector(".dk-split-main .live-ctl")).not.toBeNull();
    expect(container.querySelector(".dk-split-main .live-specs")).not.toBeNull();
    expect(container.querySelectorAll(".dk-split-main :is(.live-tile, .live-data-card, .live-status, .dk-block)")).toHaveLength(0);
    // The Controller page keeps them.
    await live("overview");
    expect(container.querySelectorAll(".dk-split-main .live-tile").length).toBeGreaterThan(0);
  });
});

// Page rule 3: the panel's sub-line says where its settings are kept and how
// they save: one string per page, no version, no status.
describe("the panel sub-lines", () => {
  const sub = () => container.querySelector(".dk-split-sub")?.textContent ?? null;
  const VERSION = /\d+\.\d+(\.\d+)?/;
  it("the Controller page: on the board, which pairing slot", async () => {
    await live("overview");
    expect(sub()).toBe(m.i18n.t("desktop.panelSub.controller", { slot: 0 }));
  });
  it("the Pico 2 W page: on the board, every slot; no firmware version (that's Firmware's)", async () => {
    await live("dongle");
    expect(sub()).toBe(m.i18n.t("desktop.panelSub.dongle"));
    expect(sub()).not.toMatch(VERSION);
    // The OLED's settings first, the danger zone last (IA audit Q10).
    const ids = [...container.querySelectorAll<HTMLElement>(".dk-split-panel .dk-sec")].map((x) => x.dataset.section);
    expect(ids[0]).toBe("oled");
    expect(ids.at(-1)).toBe("device");
  });
  it("App settings, About and a game's page: their own line, no version", async () => {
    await render(appSettings());
    expect(sub()).toBe(m.i18n.t("desktop.panelSub.app"));
    await render(createElement(m.AboutPage));
    expect(sub()).toBe(m.i18n.t("desktop.panelSub.about"));
    expect(sub()).not.toMatch(VERSION);
    expect(container.querySelector(".dk-about-text")!.textContent).not.toContain(window.desktop!.appVersion);
    vi.stubGlobal("desktop", fakeDesktop("linux"));
    const game = ghostrunnerNeedsSetup();
    await render(
      createElement(m.GamePage, {
        game,
        info: GHOSTRUNNER_INFO,
        record: GHOSTRUNNER_RECORD,
        running: false,
        report: gamesReport(game, HDR_NO_LAYER),
        bridge: fakeBridge(),
        onLibrary: () => undefined,
        onRescan: () => undefined,
      }),
    );
    expect(sub()).toBe(m.i18n.t("desktop.panelSub.game"));
  });
});

describe("Games → Home on the accordion", () => {
  it("has every section of the plan, each thing in exactly one; the library is the main view", async () => {
    const report = homeReport("attention");
    vi.stubGlobal("desktop", homeDesktop("attention", [], report));
    await render(
      createElement(m.GamesPage, {
        allowed: true,
        onAllowedChange: () => undefined,
        bridge: fakeBridge(),
        profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
      }),
    );
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(container.querySelector(".dk-split-main .lib-grid")).not.toBeNull();
    expect(container.querySelector(".dk-split-head h2")?.textContent).toBe(m.i18n.t("desktop.nav.games"));
    await textInventory("games", GAMES_INVENTORY);
  });
});

describe("a game's page on the accordion", () => {
  it("has every section of the plan, each thing in exactly one; art, Play and the tiles are the main view", async () => {
    const game = ghostrunnerNeedsSetup();
    vi.stubGlobal("desktop", fakeDesktop("linux"));
    await render(
      createElement(m.GamePage, {
        game: { ...game, support: "unknown", gamepad: undefined },
        info: GHOSTRUNNER_INFO,
        record: GHOSTRUNNER_RECORD,
        running: false,
        report: gamesReport(game, HDR_NO_LAYER),
        bridge: fakeBridge(),
        onLibrary: () => undefined,
        onRescan: () => undefined,
      }),
    );
    expect(container.querySelector(".dk-split-main .gp-hero")).not.toBeNull();
    expect(container.querySelectorAll(".dk-split-main .gp-tile")).toHaveLength(4);
    // DualSense support and Details: blocks in the main view under the tiles, always shown.
    expect(blockHead("support").textContent).toContain(m.i18n.t("desktop.library.section.support"));
    expect(blockBody("support")?.textContent).toContain(m.i18n.t("desktop.library.tierLegend"));
    expect(blockHead("details").textContent).toContain(m.i18n.t("desktop.library.section.details"));
    // loop: test
    for (const key of ["desktop.library.launcher", "desktop.library.id"]) expect(blockBody("details")?.textContent, key).toContain(m.i18n.t(key));
    expect(container.querySelector(".dk-split-head h2")?.textContent).toBe("Ghostrunner");
    await textInventory("game", GAME_INVENTORY);
    expect(container.querySelector('[data-section="notes"] .dk-sec-toggle')).not.toBeNull();
    click(head("notes"));
    expect(container.querySelector('[data-section="notes"] textarea')).not.toBeNull();
  });
});

describe("deep links", () => {
  it("every task with a place targets a section or main-view block its page has (the rail's Games count: Recommended changes)", () => {
    const app = { phase: "ready" as const, version: "1.2.3" };
    const { tasks } = m.openTasks.openTasks(t, { app: app as never, fw: { available: true, latest: { version: "v2" }, state: { phase: "idle" } as never }, connected: true, board: [], gamesCount: 1 });
    expect(tasks.find((x) => x.place === "games")?.section).toBe("recommended");
    // loop: test
    for (const task of tasks.filter((x) => x.section)) {
      const page = task.place as keyof typeof m.sections.SECTIONS;
      expect(Object.keys(m.sections.SECTIONS), task.id).toContain(page);
      const blocks = (m.sections.MAIN_BLOCKS as Record<string, readonly string[]>)[page] ?? [];
      expect([...m.sections.SECTIONS[page], ...blocks], task.id).toContain(task.section);
    }
    // A board problem: the Pico 2 W page's Diagnostics block (a readout, not a section).
    const board = m.openTasks.openTasks(t, {
      app: { phase: "idle" } as never,
      fw: { available: false, latest: null, state: { phase: "idle" } as never },
      connected: true,
      board: [{ reason: "mic-decoder", text: "mic" }] as never,
      gamesCount: 0,
    });
    expect(board.tasks[0]?.section).toBe("diagnostics");
    expect(m.sections.MAIN_BLOCKS.dongle as readonly string[]).toContain("diagnostics");
    expect(m.sections.SECTIONS.dongle as readonly string[]).not.toContain("diagnostics");
  });

  it("every section a link can name renders on its page", async () => {
    await render(appSettings());
    // loop: test
    for (const id of m.sections.SECTIONS.app) expect(container.querySelector(`[data-section="${id}"]`), id).not.toBeNull();
    await render(createElement(m.AboutPage));
    // loop: test
    for (const id of m.sections.SECTIONS.about) expect(container.querySelector(`[data-section="${id}"]`), id).not.toBeNull();
  });
});
