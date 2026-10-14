// Windows per-user installer: update file names, installer arguments, which copy can update itself, first start.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOWS_SETUP_NAME, firstInstalledStart, installerArgs, isInstalledApp } from "../../electron/main/windowsInstall";

describe("Windows installer updates", () => {
  it("accepts only the release's installer as the Windows download", () => {
    expect(WINDOWS_SETUP_NAME.test("DS5Dongle-OLED-Edition-Configurator-0.9.5-win-x64-setup.exe")).toBe(true);
    expect(WINDOWS_SETUP_NAME.test("DS5Dongle-OLED-Edition-Configurator-0.9.5-dev.12-win-x64-setup.exe")).toBe(true);
    expect(WINDOWS_SETUP_NAME.test("DS5Dongle-OLED-Edition-Configurator-0.9.5-win-x64.exe")).toBe(false); // the old portable exe
    expect(WINDOWS_SETUP_NAME.test("../DS5Dongle-OLED-Edition-Configurator-0.9.5-win-x64-setup.exe")).toBe(false);
    expect(WINDOWS_SETUP_NAME.test("evil.exe")).toBe(false);
  });

  it("runs the installer silently as an update, relaunching only for Restart now", () => {
    expect(installerArgs(true)).toEqual(["/S", "--updated", "--force-run"]);
    expect(installerArgs(false)).toEqual(["/S", "--updated"]);
  });

  it("only the installed copy (with its uninstaller beside it) updates itself", () => {
    const dir = join("C:", "Users", "u", "AppData", "Local", "Programs", "ds5-dongle-configurator");
    const exe = join(dir, "DS5 Dongle OLED Edition Configurator.exe");
    const uninstaller = join(dir, "Uninstall DS5 Dongle OLED Edition Configurator.exe");
    expect(isInstalledApp(exe, "DS5 Dongle OLED Edition Configurator", (p) => p === uninstaller)).toBe(true);
    expect(isInstalledApp(exe, "DS5 Dongle OLED Edition Configurator", () => false)).toBe(false);
  });

  it("says once that the app moved from the portable exe, never on a fresh install", () => {
    const files = new Set<string>(["settings.json"]);
    const exists = (p: string) => files.has(p);
    const write = (p: string) => void files.add(p);
    expect(firstInstalledStart("settings.json", "installed-app", exists, write)).toBe("moved");
    expect(firstInstalledStart("settings.json", "installed-app", exists, write)).toBe(null);
    const fresh = new Set<string>();
    expect(
      firstInstalledStart(
        "settings.json",
        "installed-app",
        (p) => fresh.has(p),
        (p) => void fresh.add(p),
      ),
    ).toBe("new");
  });
});
