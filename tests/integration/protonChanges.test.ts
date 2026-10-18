// @vitest-environment jsdom
// About → Proton changes: a third changelog section next to App changes and
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

function render(platform: string | null) {
  if (platform) (window as { desktop?: unknown }).desktop = { platform, appVersion: "0.0.0", buildId: "" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AboutPage)));
  return [...container.querySelectorAll(".dk-sec-title")].map((b) => b.textContent);
}

describe("About → Proton changes", () => {
  it("shows the section on Linux and renders the bundled Proton changelog", async () => {
    await i18n.changeLanguage("en");
    const sections = render("linux");
    expect(sections).toEqual(["Guide", "App changes", "Firmware changes", "Proton changes", "Coming soon", "Credits"]);
    const header = [...container!.querySelectorAll<HTMLButtonElement>(".dk-sec-toggle")].find((b) => b.querySelector(".dk-sec-title")?.textContent === "Proton changes")!;
    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const headings = [...container!.querySelectorAll("h1, h2")].map((h) => h.textContent);
    expect(headings).toContain("DualSense Proton changelog");
    expect(headings).toContain("GE-Proton11-7.2-DualSense - 2026-10-13");
    expect(headings).toContain("GE-Proton11-7-DualSense - 2026-09-27");
    expect(container!.textContent).toContain("PROTON_PREFER_SDL=1");
  });

  it("leaves the section out where Proton doesn't apply (Windows, macOS)", async () => {
    await i18n.changeLanguage("en");
    for (const platform of ["win32", "darwin"]) {
      expect(render(platform)).not.toContain("Proton changes");
      act(() => root?.unmount());
      container?.remove();
    }
  });
});
