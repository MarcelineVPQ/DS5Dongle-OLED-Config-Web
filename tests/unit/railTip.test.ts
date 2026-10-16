// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { railDot, railTip } from "../../src/desktop/AppRail";
import de from "../../src/i18n/locales/de.json";
import en from "../../src/i18n/locales/en.json";
import es from "../../src/i18n/locales/es.json";
import fr from "../../src/i18n/locales/fr.json";
import ja from "../../src/i18n/locales/ja.json";
import ptBR from "../../src/i18n/locales/pt-BR.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";

afterEach(() => vi.unstubAllGlobals());
const on = (platform: string) => vi.stubGlobal("desktop", { platform });

describe("the Games rail tooltip", () => {
  it("mentions Proton setup on Linux only", () => {
    on("linux");
    expect(railTip("games")).toBe("desktop.rail.tip.games");
    for (const platform of ["win32", "darwin"]) {
      on(platform);
      expect(railTip("games")).toBe("desktop.rail.tip.gamesWindows");
    }
    expect(railTip("app")).toBe("desktop.rail.tip.app");
  });

  it("has a variant without Proton in all 7 languages", () => {
    for (const locale of [de, en, es, fr, ja, ptBR, zhCN]) {
      const tip = locale.desktop.rail.tip;
      expect(tip.games).toContain("Proton");
      expect(tip.gamesWindows).toBeTruthy();
      expect(tip.gamesWindows).not.toContain("Proton");
    }
  });
});

// A hidden panel's task (no show button on the page since 2026-10-16): the
// page's rail item carries its dot, added to the item's own tasks once.
describe("the rail's dot", () => {
  it("adds a hidden panel's task to the item's dot, once", () => {
    expect(railDot(undefined, null)).toBeUndefined();
    expect(railDot(undefined, "Updated to 1.2.3.")).toEqual({ count: null, tip: "Updated to 1.2.3." });
    const fw = { count: null, tip: "Firmware update" };
    expect(railDot(fw, null)).toBe(fw);
    expect(railDot(fw, "Firmware update")).toBe(fw); // the same task: not said twice
    expect(railDot({ count: 3, tip: "3 games" }, "Proton not installed")).toEqual({ count: 3, tip: "3 games\nProton not installed" });
  });
});
