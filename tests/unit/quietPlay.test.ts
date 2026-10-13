// ▶ Play with the launcher staying in the background (actions.ts quietPlay):
// the argv per launcher and OS, running vs not running, Flatpak, AppImage and
// Windows paths, and reading Heroic's program from its heroic:// handler.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// xdg-mime answers "heroic.desktop" (no real desktop is asked).
const execFileMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, out: string) => void) => cb(null, "heroic.desktop\n")));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execFile: execFileMock }));

import { execWords, heroicProgram, quietPlay, type QuietPlaySystem } from "../../electron/main/games/actions";
import { applicationDirs, desktopExec, schemeHandlerExec, systemdRunArgs } from "../../electron/main/games/schemeHandler";
import type { LauncherId } from "../../src/desktop/games/types";

const STEAM = "steam://rungameid/4078430";
const HEROIC = "heroic://launch?appName=1207664643&runner=gog";

const system = ({ running, ...over }: Partial<Omit<QuietPlaySystem, "running">> & { running?: LauncherId[] } = {}): QuietPlaySystem => ({
  platform: "linux",
  flatpak: false,
  heroicHandler: async () => ["/opt/Heroic/heroic"],
  exists: () => true,
  steamExe: () => "C:\\Program Files (x86)\\Steam\\steam.exe",
  heroicExe: () => "C:\\Users\\me\\AppData\\Local\\Programs\\heroic\\Heroic.exe",
  ...over,
  running: () => new Set(running ?? []),
});

describe("▶ Play with the launcher closed (Linux)", () => {
  it("starts Steam silently (tray) with the game", async () => {
    expect(await quietPlay("steam", STEAM, system())).toEqual({ cmd: "steam", args: ["-silent", STEAM] });
  });

  it("starts the Flatpak launchers by their app id", async () => {
    expect(await quietPlay("steam", STEAM, system({ flatpak: true }))).toEqual({ cmd: "flatpak", args: ["run", "com.valvesoftware.Steam", "-silent", STEAM] });
    expect(await quietPlay("heroic", HEROIC, system({ flatpak: true }))).toEqual({ cmd: "flatpak", args: ["run", "com.heroicgameslauncher.hgl", "--no-gui", HEROIC] });
  });

  it("starts Heroic with --no-gui, by the program its heroic:// handler runs", async () => {
    expect(await quietPlay("heroic", HEROIC, system())).toEqual({ cmd: "/opt/Heroic/heroic", args: ["--no-gui", HEROIC] });
    const appImage = "/home/me/Applications/Heroic-2.22.3-linux-x86_64.AppImage";
    expect(await quietPlay("heroic", HEROIC, system({ heroicHandler: async () => [appImage] }))).toEqual({ cmd: appImage, args: ["--no-gui", HEROIC] });
    const flatpakHandler = ["/usr/bin/flatpak", "run", "--branch=stable", "--arch=x86_64", "--command=heroic-run", "--file-forwarding", "com.heroicgameslauncher.hgl", "@@u", "@@"];
    expect(await quietPlay("heroic", HEROIC, system({ heroicHandler: async () => flatpakHandler }))).toEqual({ cmd: "flatpak", args: ["run", "com.heroicgameslauncher.hgl", "--no-gui", HEROIC] });
    // No handler entry: heroic on PATH.
    expect(await quietPlay("heroic", HEROIC, system({ heroicHandler: async () => null }))).toEqual({ cmd: "heroic", args: ["--no-gui", HEROIC] });
  });

  it("hands a running launcher the plain link (never Heroic's gui=false, which hides an open window)", async () => {
    expect(await quietPlay("steam", STEAM, system({ running: ["steam"] }))).toBeNull();
    expect(await quietPlay("heroic", HEROIC, system({ running: ["heroic"] }))).toBeNull();
    expect(await quietPlay("heroic", HEROIC, system({ running: ["steam"] }))).not.toBeNull();
  });

  it("keeps the link for Lutris (its rungame link never shows the window) and the Windows stores", async () => {
    for (const launcher of ["lutris", "gog", "epic"] as LauncherId[]) expect(await quietPlay(launcher, "lutris:rungame/x", system())).toBeNull();
  });

  it("goes through startForUser's own unit: the argv after --, unchanged", async () => {
    const plan = (await quietPlay("heroic", HEROIC, system()))!;
    const argv = systemdRunArgs(plan.cmd, plan.args, { HOME: "/home/me" }, { version: 259, env: {} }, "app-ds5configurator-heroic@x.service");
    expect(argv.slice(argv.indexOf("--"))).toEqual(["--", "/opt/Heroic/heroic", "--no-gui", HEROIC]);
  });
});

describe("▶ Play with the launcher closed (Windows, macOS)", () => {
  it("starts steam.exe -silent and Heroic.exe --no-gui", async () => {
    const win = system({ platform: "win32" });
    expect(await quietPlay("steam", STEAM, win)).toEqual({ cmd: "C:\\Program Files (x86)\\Steam\\steam.exe", args: ["-silent", STEAM] });
    expect(await quietPlay("heroic", HEROIC, win)).toEqual({ cmd: "C:\\Users\\me\\AppData\\Local\\Programs\\heroic\\Heroic.exe", args: ["--no-gui", HEROIC] });
  });

  it("keeps the link when the program isn't found or the launcher runs", async () => {
    expect(await quietPlay("steam", STEAM, system({ platform: "win32", steamExe: () => null }))).toBeNull();
    expect(await quietPlay("heroic", HEROIC, system({ platform: "win32", heroicExe: () => null }))).toBeNull();
    expect(await quietPlay("steam", STEAM, system({ platform: "win32", running: ["steam"] }))).toBeNull();
  });

  it("keeps the link on macOS (no Games page there)", async () => {
    expect(await quietPlay("steam", STEAM, system({ platform: "darwin" }))).toBeNull();
  });
});

describe("Heroic's program from its link handler", () => {
  it("accepts only Heroic's own program, by an absolute path that exists; never its arguments", () => {
    expect(heroicProgram(["/opt/Heroic/heroic", "--evil"], () => true)).toEqual({ cmd: "/opt/Heroic/heroic", args: [] });
    expect(heroicProgram(["/home/me/heroic.AppImage"], () => true)).toEqual({ cmd: "/home/me/heroic.AppImage", args: [] });
    for (const prog of ["/usr/bin/sh", "/opt/Heroic/heroic-evil", "/tmp/.mount_x/heroic", "heroic-wrapper", "./heroic", "/home/me/Heroic.exe"])
      expect(
        heroicProgram([prog], () => true),
        prog,
      ).toEqual({ cmd: "heroic", args: [] });
    expect(heroicProgram(["/opt/Heroic/heroic"], () => false)).toEqual({ cmd: "heroic", args: [] });
    expect(heroicProgram(["flatpak", "run", "org.other.App"], () => true)).toEqual({ cmd: "heroic", args: [] });
  });

  it("splits an Exec value per the Desktop Entry spec, without field codes", () => {
    expect(execWords("/opt/Heroic/heroic %U")).toEqual(["/opt/Heroic/heroic"]);
    expect(execWords('"/home/me/My Apps/Heroic-2.22.3.AppImage" --no-sandbox %u')).toEqual(["/home/me/My Apps/Heroic-2.22.3.AppImage", "--no-sandbox"]);
    expect(execWords('"/a \\"b\\"/heroic"')).toEqual(['/a "b"/heroic']);
  });

  it("reads Exec from the [Desktop Entry] group only", () => {
    const text = "[Desktop Action x]\nExec=/bin/other\n[Desktop Entry]\nName=Heroic\nExec=/opt/Heroic/heroic %U\n";
    expect(desktopExec(text)).toBe("/opt/Heroic/heroic %U");
    expect(desktopExec("[Desktop Entry]\nName=x\n")).toBeNull();
  });

  it("looks in the XDG applications folders, the user's first", () => {
    expect(applicationDirs({}, "/home/me")).toEqual([join("/home/me/.local/share", "applications"), join("/usr/local/share", "applications"), join("/usr/share", "applications")]);
    expect(applicationDirs({ XDG_DATA_HOME: "/d", XDG_DATA_DIRS: "/a::/b" }, "/home/me")).toEqual([join("/d", "applications"), join("/a", "applications"), join("/b", "applications")]);
  });

  describe("the registered handler's Exec", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("finds the desktop entry xdg-mime names", async () => {
      const data = mkdtempSync(join(tmpdir(), "quietplay-"));
      mkdirSync(join(data, "applications"));
      writeFileSync(join(data, "applications", "heroic.desktop"), "[Desktop Entry]\nExec=/opt/Heroic/heroic %U\n");
      vi.stubEnv("XDG_DATA_HOME", data);
      vi.stubEnv("XDG_DATA_DIRS", join(data, "none"));
      expect(await schemeHandlerExec("heroic")).toBe("/opt/Heroic/heroic %U");
      expect(execFileMock).toHaveBeenLastCalledWith("xdg-mime", ["query", "default", "x-scheme-handler/heroic"], expect.anything(), expect.any(Function));
    });

    it("ignores a handler name that isn't a plain desktop file name", async () => {
      execFileMock.mockImplementationOnce((_c, _a, _o, cb) => cb(null, "../../etc/passwd\n"));
      expect(await schemeHandlerExec("heroic")).toBeNull();
    });
  });
});
