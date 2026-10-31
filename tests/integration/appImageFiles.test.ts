// Linux AppImage housekeeping removes only what the app made (pre-release
// review, update M2 and app S2): the start-up tidy-up deleted every
// *.AppImage.part in the AppImage's folder (often ~/Downloads, so a browser's
// download in progress), and the stable-name symlink step deleted a real file
// the user kept under that name.
import { existsSync, lstatSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.9.5", getPath: () => tmpdir(), releaseSingleInstanceLock: vi.fn(), exit: vi.fn(), quit: vi.fn() },
  net: { fetch: vi.fn() },
  shell: {},
}));

import { Updater } from "../../electron/main/updater";
import { launchPath, linkStableAppImage } from "../../electron/main/integration";

// The real path: the app resolves the AppImage's (macOS runners' /var is /private/var).
const temp = realpathSync(mkdtempSync(join(tmpdir(), "appimage-files-")));
const NAME = (v: string) => `DS5Dongle-OLED-Edition-Configurator-${v}-linux-x86_64.AppImage`;
const STABLE = join(temp, "DS5Dongle-OLED-Edition-Configurator.AppImage");
const saved = { platform: process.platform, appImage: process.env.APPIMAGE };
const symlinks = process.platform !== "win32"; // Windows runners can't make symlinks without developer mode

beforeAll(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
  process.env.APPIMAGE = join(temp, NAME("0.9.5"));
  writeFileSync(process.env.APPIMAGE, "running");
});
afterAll(() => {
  Object.defineProperty(process, "platform", { value: saved.platform });
  if (saved.appImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = saved.appImage;
  rmSync(temp, { recursive: true, force: true });
});
afterEach(() => rmSync(STABLE, { force: true }));

describe("start-up tidy-up (Linux)", () => {
  it("removes our own partial download and older builds, never another program's .part file", () => {
    const files = {
      ours: `${NAME("0.9.6")}.part`,
      oursDev: `${NAME("0.9.6-dev.1")}.part`,
      older: NAME("0.9.4"),
      browsers: "Other-App-1.0-x86_64.AppImage.part",
      lookAlike: "DS5Dongle-OLED-Edition-Configurator-copy.AppImage.part",
    };
    for (const f of Object.values(files)) writeFileSync(join(temp, f), "x");
    new Updater(() => undefined).pruneStaleFiles();
    expect(existsSync(join(temp, files.ours))).toBe(false);
    expect(existsSync(join(temp, files.oursDev))).toBe(false);
    expect(existsSync(join(temp, files.older))).toBe(false);
    expect(existsSync(join(temp, files.browsers))).toBe(true);
    expect(existsSync(join(temp, files.lookAlike))).toBe(true);
    expect(existsSync(process.env.APPIMAGE!)).toBe(true);
  });
});

describe("stable-name symlink", () => {
  it("never deletes a real file the user keeps under the stable name; launchers use the versioned file", () => {
    writeFileSync(STABLE, "the user's own copy");
    expect(linkStableAppImage(process.env.APPIMAGE!)).toBe(process.env.APPIMAGE);
    expect(lstatSync(STABLE).isSymbolicLink()).toBe(false);
    expect(launchPath()).toBe(process.env.APPIMAGE);
  });

  it.skipIf(!symlinks)("creates the symlink, and repoints our old one", () => {
    expect(linkStableAppImage(process.env.APPIMAGE!)).toBe(STABLE);
    expect(readlinkSync(STABLE)).toBe(process.env.APPIMAGE);
    rmSync(STABLE);
    symlinkSync(join(temp, NAME("0.9.3")), STABLE);
    expect(linkStableAppImage(process.env.APPIMAGE!)).toBe(STABLE);
    expect(readlinkSync(STABLE)).toBe(process.env.APPIMAGE);
    expect(launchPath()).toBe(STABLE);
  });
});
