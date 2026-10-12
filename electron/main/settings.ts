// App settings (not dongle settings): stored as JSON in the user data folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { DesktopSettings } from "../../src/desktop/api";
import { writeFileAtomic } from "./games/backup";

export const DEFAULT_SETTINGS: DesktopSettings = {
  // The tray keeps track of the dongle, so closing the window hides it.
  closeToTray: true,
  startMinimized: false,
  launchAtLogin: false,
  checkForUpdates: true,
  // Off until the user says yes (the app asks once, after the tour).
  autoInstallUpdates: false,
  updatesAsked: false,
  // Linux Games page: off until the user agrees to let the app read launcher settings.
  gamesScanAllowed: false,
  // Silent until the user says yes (the tour asks once).
  narratorVoice: "ask",
  narratorCaptions: true,
  hardwareAcceleration: true,
  hdrLighting: false,
  updateChannel: "stable",
};

const SettingsFile = z.object({
  closeToTray: z.boolean().optional(),
  startMinimized: z.boolean().optional(),
  launchAtLogin: z.boolean().optional(),
  checkForUpdates: z.boolean().optional(),
  autoInstallUpdates: z.boolean().optional(),
  updatesAsked: z.boolean().optional(),
  gamesScanAllowed: z.boolean().optional(),
  narratorVoice: z.enum(["ask", "on", "off"]).optional(),
  narratorCaptions: z.boolean().optional(),
  hardwareAcceleration: z.boolean().optional(),
  hdrLighting: z.boolean().optional(),
  updateChannel: z.enum(["stable", "dev"]).optional(),
});

export const SettingUpdate = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("closeToTray"), value: z.boolean() }),
  z.strictObject({ key: z.literal("startMinimized"), value: z.boolean() }),
  z.strictObject({ key: z.literal("launchAtLogin"), value: z.boolean() }),
  z.strictObject({ key: z.literal("checkForUpdates"), value: z.boolean() }),
  z.strictObject({ key: z.literal("autoInstallUpdates"), value: z.boolean() }),
  z.strictObject({ key: z.literal("updatesAsked"), value: z.boolean() }),
  z.strictObject({ key: z.literal("gamesScanAllowed"), value: z.boolean() }),
  z.strictObject({ key: z.literal("narratorVoice"), value: z.enum(["ask", "on", "off"]) }),
  z.strictObject({ key: z.literal("narratorCaptions"), value: z.boolean() }),
  z.strictObject({ key: z.literal("hardwareAcceleration"), value: z.boolean() }),
  z.strictObject({ key: z.literal("hdrLighting"), value: z.boolean() }),
  z.strictObject({ key: z.literal("updateChannel"), value: z.enum(["stable", "dev"]) }),
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
    // Atomic (temp file, fsync, rename): a crash mid-save can't leave a
    // half-written file, which would reset every setting (and autostart).
    writeFileAtomic(settingsPath(), JSON.stringify(settings, null, 2) + "\n");
  } catch (cause) {
    console.error("settings save failed:", cause instanceof Error ? cause.message : cause);
  }
}
