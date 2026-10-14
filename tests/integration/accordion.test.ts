// @vitest-environment jsdom
// The accordion (src/desktop/accordion/): one section open at a time, the pin
// dot keeps one open, what's open and pinned is remembered (pins per board and
// slot on the controller page), closed sections render nothing, the keyboard
// moves between headers, and deep links open their section. Then the pages
// built on it so far (App settings, About): every setting from the plan's
// table (the accordion sketch's MAPPING.md) renders in exactly one section,
// nothing lost, no dupes; and every deep link target exists.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.scrollTo ??= () => undefined;
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
  sections: typeof import("../../src/desktop/accordion/sections");
  AppSettingsPage: typeof import("../../src/desktop/pages/AppSettingsPage").default;
  AboutPage: typeof import("../../src/desktop/pages/AboutPage").default;
  notices: typeof import("../../src/desktop/notices");
  openTasks: typeof import("../../src/desktop/openTasks");
};
const t = ((key: string, o?: Record<string, unknown>) => m.i18n.t(key, o)) as TFunction;

beforeAll(async () => {
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  vi.resetModules();
  m = {
    i18n: (await import("../../src/i18n")).default,
    Section: await import("../../src/desktop/accordion/Section"),
    acc: await import("../../src/desktop/accordion/useAccordion"),
    sections: await import("../../src/desktop/accordion/sections"),
    AppSettingsPage: (await import("../../src/desktop/pages/AppSettingsPage")).default,
    AboutPage: (await import("../../src/desktop/pages/AboutPage")).default,
    notices: await import("../../src/desktop/notices"),
    openTasks: await import("../../src/desktop/openTasks"),
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
  dismissed: ["desktop.notices.none"],
  developer: ["desktop.dev.model", "desktop.dev.colorway", "desktop.dev.simulated", "desktop.dev.fakeSlots", "desktop.dev.updates", "desktop.dev.hdrTitle"],
};

// What an open section shows: its rows' labels, its buttons and its texts.
const labelsIn = (id: string) => {
  const body = container.querySelector(`[data-section="${id}"] .dk-sec-body`);
  if (!body) return [];
  const labels = [...body.querySelectorAll(".dk-row > .dk-label")].map((l) => l.firstChild?.textContent?.trim() ?? "");
  const buttons = [...body.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
  const texts = [...body.querySelectorAll("p, h3")].map((p) => p.textContent?.trim() ?? "");
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
      click(head(id));
      await act(async () => undefined);
      expect(openIds()).toEqual([id]);
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

  it("App changes carries the 'Updated to' task until it's opened", async () => {
    const seen = vi.fn();
    await render(createElement(m.AboutPage, { whatsNew: "0.9.5-dev.12", onSeen: seen }));
    expect(openIds()).toEqual(["changes"]); // the first section with a task opens on a first visit
    expect(container.querySelector('[data-section="changes"] .dk-sec-task')).not.toBeNull();
    expect(seen).toHaveBeenCalled();
  });
});

describe("deep links", () => {
  it("every task with a section targets one its page has", () => {
    const app = { phase: "ready" as const, version: "1.2.3" };
    const { tasks } = m.openTasks.openTasks(t, { app: app as never, fw: { available: true, latest: { version: "v2" }, state: { phase: "idle" } as never }, connected: true, board: [], gamesCount: 1 });
    // loop: test
    for (const task of tasks.filter((x) => x.section)) {
      const page = task.place as keyof typeof m.sections.SECTIONS;
      expect(m.sections.MIGRATED, task.id).toContain(page);
      expect(m.sections.SECTIONS[page] as readonly string[], task.id).toContain(task.section);
    }
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
