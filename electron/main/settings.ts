// App settings (not dongle settings): stored as JSON in the user data folder.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { DesktopSettings } from "../../src/desktop/api";

export const DEFAULT_SETTINGS: DesktopSettings = {
  // The tray keeps track of the dongle, so closing the window hides it.
  closeToTray: true,
  startMinimized: false,
  launchAtLogin: false,
  checkForUpdates: true,
};

const SettingsFile = z.object({
  closeToTray: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  launchAtLogin: z.boolean().optional(),
  checkForUpdates: z.boolean().optional(),
});

export const SettingUpdate = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("closeToTray"), value: z.boolean() }),
  z.strictObject({ key: z.literal("startMinimized"), value: z.boolean() }),
  z.strictObject({ key: z.literal("launchAtLogin"), value: z.boolean() }),
  z.strictObject({ key: z.literal("checkForUpdates"), value: z.boolean() }),
]);

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): DesktopSettings {
  try {
    const parsed = SettingsFile.safeParse(JSON.parse(readFileSync(settingsPath(), "utf8")));
    return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DesktopSettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + "\n");
  } catch (cause) {
    console.error("settings save failed:", cause instanceof Error ? cause.message : cause);
  }
}
