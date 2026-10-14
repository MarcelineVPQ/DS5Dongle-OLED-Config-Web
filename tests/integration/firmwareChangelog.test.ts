// @vitest-environment jsdom
// About → Firmware changes shows the firmware's CHANGELOG.md bundled into the
// app at build time (firmwareChangelog.config.ts), like App changes and
// Proton changes: no IPC call and no network request when the tab opens.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import AboutPage from "../../src/desktop/pages/AboutPage";
import { revealSection } from "../../src/desktop/accordion/useAccordion";
import { FIRMWARE_CHANGELOG_MISSING, firmwareChangelogPath } from "../../firmwareChangelog.config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => undefined; // jsdom has none (a deep link scrolls to its section)
const ROOT = resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("About → Firmware changes", () => {
  it("renders the bundled changelog without asking the main process or the network", async () => {
    await i18n.changeLanguage("en");
    const calls: string[] = [];
    // Any window.desktop call is recorded (the old tab asked for firmwareChangelog()).
    vi.stubGlobal(
      "desktop",
      new Proxy({ platform: "linux", appVersion: "0.0.0", buildId: "" } as Record<string, unknown>, { get: (t, p: string) => (p in t ? t[p] : (calls.push(p), () => Promise.resolve(""))) }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    revealSection("about", "firmware"); // as About → Firmware changes opens from the update notice
    act(() => root!.render(createElement(AboutPage)));
    const bundled = readFileSync(firmwareChangelogPath(ROOT), "utf8");
    const firstHeading = /^# (.+)$/m.exec(bundled)![1];
    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toContain(firstHeading);
    expect(container.textContent).not.toContain("Loading");
    expect(calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("where the build finds the firmware changelog", () => {
  const tree = () => {
    const base = mkdtempSync(join(tmpdir(), "fwlog-"));
    const app = join(base, "app");
    mkdirSync(join(app, "resources/firmware"), { recursive: true });
    mkdirSync(join(base, "DS5Dongle"));
    return { base, app };
  };

  it("prefers the release bundle, then DS5_FIRMWARE_DIR, then the sibling firmware checkout", () => {
    const { base, app } = tree();
    writeFileSync(join(base, "DS5Dongle/CHANGELOG.md"), "sibling");
    expect(firmwareChangelogPath(app, {})).toBe(join(base, "DS5Dongle/CHANGELOG.md"));
    mkdirSync(join(base, "fw"));
    writeFileSync(join(base, "fw/CHANGELOG.md"), "env");
    expect(firmwareChangelogPath(app, { DS5_FIRMWARE_DIR: join(base, "fw") })).toBe(join(base, "fw/CHANGELOG.md"));
    writeFileSync(join(app, "resources/firmware/CHANGELOG.md"), "release");
    expect(firmwareChangelogPath(app, { DS5_FIRMWARE_DIR: join(base, "fw") })).toBe(join(app, "resources/firmware/CHANGELOG.md"));
  });

  it("without one: a note for checks and dev builds, a failed build for a release", () => {
    const { app } = tree();
    expect(firmwareChangelogPath(app, {})).toBe(join(app, FIRMWARE_CHANGELOG_MISSING));
    expect(() => firmwareChangelogPath(app, { DS5_REQUIRE_FIRMWARE_CHANGELOG: "1" })).toThrow(/firmware CHANGELOG.md to bundle wasn't found/);
  });
});
