// @vitest-environment jsdom
// App settings -> Accent color -> Desktop applies the desktop's accent in
// every theme (it used to need the "Match desktop" theme: with Light it kept
// the theme's green), and says so when no accent can be read.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { AccentSetting } from "../../src/desktop/pages/AppSettingsPage";
import { ACCENT_KEY, setDesktopAccent, useControllerAccent } from "../../src/desktop/live/controllerAccent";
import { parseColor, type DesktopPalette } from "../../src/desktop/theme/desktopPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let palette: DesktopPalette | null = null;

function App() {
  useControllerAccent(null, "desktop");
  return createElement(AccentSetting);
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.localStorage.setItem(ACCENT_KEY, "desktop");
  document.documentElement.setAttribute("data-theme", "light");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal("desktop", { getDesktopPalette: () => Promise.resolve(palette), onDesktopPalette: () => () => undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  setDesktopAccent(undefined);
  window.localStorage.clear();
  document.getElementById("ds5-controller-accent")?.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const layer = () => document.getElementById("ds5-controller-accent")?.textContent ?? "";
const token = (name: string) => parseColor(new RegExp(`${name}: ([^;!]+)`).exec(layer())?.[1] ?? "");

describe("Accent color -> Desktop", () => {
  it("Light theme: the accent tokens come from the desktop's accent", async () => {
    palette = { source: "accent", isDark: false, accent: [233, 58, 154] };
    act(() => root!.render(createElement(App)));
    await settle();
    const accent = token("--accent");
    expect(accent).not.toBeNull();
    const [r, g, b] = accent!;
    expect(r).toBeGreaterThan(g); // pink, not the Light theme's green
    expect(b).toBeGreaterThan(g);
    expect(layer()).not.toMatch(/--bg-panel/); // surfaces stay the theme's own
    expect(container!.textContent).not.toMatch(/Couldn't read/);
  });

  // The owner's machine: KDE read fine (a full "kde" palette over IPC), yet
  // with Light / Dark / System only the warning-text layer was set.
  it.each(["light", "dark", "system"])("%s theme with KDE's full palette: the accent is KDE's", async (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    palette = { source: "kde", isDark: true, accent: [233, 58, 154], window: [32, 35, 38], windowText: [252, 252, 252] };
    act(() => root!.render(createElement(App)));
    await settle();
    const [r, g, b] = token("--accent")!;
    expect(r).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(g);
  });

  it("no desktop accent: the row says so", async () => {
    palette = null;
    act(() => root!.render(createElement(App)));
    await settle();
    expect(container!.querySelector(".dk-row")!.textContent).toContain("Couldn't read your desktop's accent color");
    expect(token("--accent")).toBeNull();
  });
});
