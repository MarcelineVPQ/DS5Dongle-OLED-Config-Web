// @vitest-environment jsdom
// About → Proton changes: a third changelog tab next to App changes and
// Firmware changes, rendering the bundled docs/PROTON_CHANGELOG.md with the
// same Markdown renderer. Linux only, like the Games page's Proton card.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import AboutPage from "../../src/desktop/pages/AboutPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  delete (window as { desktop?: unknown }).desktop;
});

function render(platform: string | null, initialTab?: "proton" | "guide") {
  if (platform) (window as { desktop?: unknown }).desktop = { platform, appVersion: "0.0.0", buildId: "" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AboutPage, { initialTab })));
  return [...container.querySelectorAll<HTMLButtonElement>("button[role=tab]")].map((b) => b.textContent);
}

describe("About → Proton changes", () => {
  it("shows the tab on Linux and renders the bundled Proton changelog", async () => {
    await i18n.changeLanguage("en");
    const tabs = render("linux");
    expect(tabs).toEqual(["Guide", "App changes", "Firmware changes", "Proton changes", "Coming soon", "Credits"]);
    const tab = [...container!.querySelectorAll<HTMLButtonElement>("button[role=tab]")].find((b) => b.textContent === "Proton changes")!;
    act(() => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const headings = [...container!.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(headings).toContain("DualSense Proton changelog");
    expect(headings).toContain("GE-Proton11-7.2-DualSense - 2026-10-13 (not published yet)");
    expect(headings).toContain("GE-Proton11-7-DualSense - 2026-09-27");
    expect(container!.textContent).toContain("PROTON_PREFER_SDL=1");
  });

  it("leaves the tab out where Proton doesn't apply (Windows, macOS)", async () => {
    await i18n.changeLanguage("en");
    for (const platform of ["win32", "darwin"]) {
      expect(render(platform)).not.toContain("Proton changes");
      act(() => root?.unmount());
      container?.remove();
    }
  });
});
