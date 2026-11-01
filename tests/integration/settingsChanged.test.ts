// @vitest-environment jsdom
// A setting changed outside the page (a tray switch, hardware acceleration
// turned off after a GPU crash) shows in App settings at once (bug hunt A3,
// 0.9.5): the page read the settings once, so its switches went stale.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DesktopSettings } from "../../src/desktop/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined;
window.matchMedia ??= ((media: string) => Object.assign(new EventTarget(), { media, matches: false, onchange: null, addListener() {}, removeListener() {} })) as never;
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SETTINGS = { closeToTray: true, launchAtLogin: false, startMinimized: false, hardwareAcceleration: true, checkForUpdates: true, updateChannel: "stable", updatesAsked: true } as DesktopSettings;
let changed: ((s: DesktopSettings) => void) | null = null;
const desktop = () =>
  new Proxy(
    {
      platform: "linux",
      appVersion: "0.9.5",
      getSettings: () => Promise.resolve(SETTINGS),
      onSettingsChanged: (listener: (s: DesktopSettings) => void) => {
        changed = listener;
        return () => (changed = null);
      },
    } as Record<string, unknown>,
    { get: (o, p: string) => (p in o ? o[p] : p.startsWith("on") ? () => () => undefined : () => Promise.resolve(undefined)) },
  );

let AppSettingsPage: typeof import("../../src/desktop/pages/AppSettingsPage").default;
beforeAll(async () => {
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  AppSettingsPage = (await import("../../src/desktop/pages/AppSettingsPage")).default;
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

const startup = () => container.querySelector('[data-section="startup"]')?.textContent ?? "";

it("App settings follows a change made in the tray or by the app", async () => {
  await act(async () =>
    root.render(createElement(AppSettingsPage, { bridge: { firmwareVersion: null, identity: null } as never, fw: { refreshLatest: () => Promise.resolve({ latest: null }) } as never })),
  );
  await act(async () => undefined);
  expect(startup()).toContain("Close to tray");
  // The tray's Close to tray unticked, and a GPU crash turned hardware acceleration off.
  await act(async () => changed?.({ ...SETTINGS, closeToTray: false, hardwareAcceleration: false }));
  expect(startup()).not.toContain("Close to tray");
  expect(startup()).toContain("Hardware acceleration");
  act(() => root.unmount());
  expect(changed).toBeNull(); // unsubscribed with the page
  root = createRoot(container);
});

// 2026-11-01 re-review S3: GNOME without a tray. Close to tray and Start
// minimized couldn't act there, so App settings says why instead of showing them.
it("with no tray on this desktop, App settings shows the line instead of the two tray switches", async () => {
  await act(async () =>
    root.render(createElement(AppSettingsPage, { bridge: { firmwareVersion: null, identity: null } as never, fw: { refreshLatest: () => Promise.resolve({ latest: null }) } as never })),
  );
  await act(async () => undefined);
  await act(async () => changed?.({ ...SETTINGS, startMinimized: true, trayMissing: true }));
  expect(startup()).not.toContain("Close to tray");
  expect(startup()).not.toContain("Start minimized");
  const toggle = container.querySelector<HTMLElement>('[data-section="startup"] .dk-sec-toggle');
  act(() => toggle?.click());
  expect(startup()).toContain("This desktop shows no tray icons, so closing the window quits the app.");
  const switches = [...container.querySelectorAll('[data-section="startup"] [role="switch"]')].map((s) => s.getAttribute("aria-label"));
  expect(switches).toContain("Start at login");
  expect(switches).not.toContain("Close to tray");
  expect(switches).not.toContain("Start minimized");
});
