// App settings (not dongle settings): stored as JSON in the user data folder.
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { DesktopSettings } from "../../src/desktop/api";
import { writeFileAtomic } from "./games/backup";
import { prettyJson, readPersistedFile } from "./persistedFile";
import { salvageObject } from "../../src/persisted";

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
  controllerVolumeFull: false,
  devFakeGames: false,
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
  controllerVolumeFull: z.boolean().optional(),
  devFakeGames: z.boolean().optional(),
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

export function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

// No file yet (first start): the defaults. A damaged one (batch E1): every
// setting that still reads is kept, the rest are the defaults, the damaged
// file is copied aside and the page says so (readPersistedFile). A setting
// this version doesn't know (a newer app's) is not damage: it's left out.
export function loadSettings(): DesktopSettings {
  return readPersistedFile(settingsPath(), {
    kind: "settings",
    salvage: (data) => {
      const read = salvageObject(SettingsFile, data, false);
      return read && { value: { ...DEFAULT_SETTINGS, ...read.value }, lost: read.lost };
    },
    fallback: () => ({ ...DEFAULT_SETTINGS }),
    serialize: prettyJson,
  });
}

// Throws when the file can't be written: the caller (updateSetting) puts the
// setting back and the page says so (error pass: it used to be only logged).
export function saveSettings(settings: DesktopSettings): void {
  // Atomic (temp file, fsync, rename): a crash mid-save can't leave a
  // half-written file, which would reset every setting (and autostart).
  writeFileAtomic(settingsPath(), prettyJson(settings));
}
