// The tray's menu and tooltip are in the system's language and name the board
// by its name (bug hunt A2, 0.9.5): they were English only and said
// "DS5 Dongle OLED Edition".
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { DesktopSettings, DeviceStatus } from "../../src/desktop/api";

const shown = vi.hoisted(() => ({ menu: [] as MenuItemConstructorOptions[], tooltip: "", menus: 0 }));
vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      shown.menu = template;
      shown.menus++;
      return template;
    },
  },
  Tray: class {
    on() {}
    setImage() {}
    setToolTip(text: string) {
      shown.tooltip = text;
    }
    setContextMenu() {}
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
}));

const { AppTray, trayTooltip } = await import("../../electron/main/tray");
const { mainTranslator } = await import("../../electron/main/mainText");

const SETTINGS = { closeToTray: true, launchAtLogin: false, startMinimized: false, checkForUpdates: true } as DesktopSettings;
const CONNECTED: DeviceStatus = { dongle: true, controller: true, slot: 2, firmware: "0.9.5", power: "charging", battery: 80, board: "Pico 2 W" };
const handlers = { toggleWindow() {}, command() {}, setSetting() {}, createDesktopShortcut() {}, checkForUpdates() {}, restartToUpdate() {}, quit() {} };
const labels = (menu: MenuItemConstructorOptions[]): string[] => menu.flatMap((i) => [...(i.label ? [i.label] : []), ...labels((i.submenu as MenuItemConstructorOptions[] | undefined) ?? [])]);

beforeEach(() => {
  shown.menu = [];
  shown.tooltip = "";
});

describe("the tray speaks the system's language", () => {
  it("the tooltip names the board, never 'Dongle'", async () => {
    const en = await mainTranslator("en-US");
    expect(trayTooltip({ ...CONNECTED, dongle: false, board: null }, en)).toBe("Your board · Not connected");
    expect(trayTooltip({ ...CONNECTED, dongle: false }, en)).toBe("Pico 2 W · Not connected");
    expect(trayTooltip({ ...CONNECTED, controller: false }, en)).toBe("Pico 2 W 0.9.5 · No controller (press the PS button)");
    expect(trayTooltip(CONNECTED, en)).toBe("Pico 2 W 0.9.5 · Controller connected · Slot 2 · Battery 80% · Charging");
  });

  it.each(["de-DE", "es", "fr", "ja", "pt-BR", "zh-CN"])("%s: every label and the tooltip are translated", async (locale) => {
    const t = await mainTranslator(locale);
    const en = await mainTranslator("en");
    const tray = new AppTray("/nonexistent", handlers, SETTINGS);
    expect(shown.menu).toEqual([]); // nothing until the text is loaded
    tray.setText(t);
    tray.update(CONNECTED);
    const english = new AppTray("/nonexistent", handlers, SETTINGS);
    english.setText(en);
    english.update(CONNECTED);
    const englishLabels = labels(shown.menu);
    tray.update({ ...CONNECTED, slot: 1 });
    const own = labels(shown.menu);
    expect(own).toHaveLength(englishLabels.length);
    for (const label of own) {
      expect(label).not.toMatch(/dongle|desktop\.|\{\{/i);
      // Same as English only where the word is the same ("Slot 0", "Diagnostics" in some languages is close but not equal).
      if (!/^Slot \d$/.test(label)) expect(englishLabels).not.toContain(label);
    }
    expect(shown.tooltip).toContain("Pico 2 W 0.9.5");
    expect(shown.tooltip).not.toMatch(/dongle|Charging|Battery/i);
  });
});
