import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// A dead AppImage mount first in PATH (the old copy's, after an in-app update)
// made every program lookup by name fail: execvp stops at the first error that
// isn't "not found" (ENOTCONN for a dead FUSE mount), so kscreen-doctor and
// pactl weren't found and Games showed "controller not connected" and no HDR.

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execFileSync: execFileSyncMock }));
vi.mock("electron", () => ({
  app: { isPackaged: true, releaseSingleInstanceLock: vi.fn(), exit: vi.fn(), quit: vi.fn(), getVersion: () => "0.9.5", getPath: () => tmpdir() },
  net: { fetch: vi.fn() },
}));

import { launcherEnv, pathWithoutAppImageMounts } from "../../electron/main/games/schemeHandler";
import { Updater } from "../../electron/main/updater";
import { app } from "electron";

describe("pathWithoutAppImageMounts", () => {
  it("drops every AppImage mount and its subfolders", () => {
    expect(pathWithoutAppImageMounts("/tmp/.mount_DS5DonXkRIiW:/tmp/.mount_DS5DonXkRIiW/usr/sbin:/usr/local/bin:/usr/bin")).toBe("/usr/local/bin:/usr/bin");
  });

  it("keeps this copy's own mount when asked", () => {
    expect(pathWithoutAppImageMounts("/tmp/.mount_old:/tmp/.mount_old/usr/sbin:/tmp/.mount_new:/tmp/.mount_new/usr/sbin:/usr/bin", "/tmp/.mount_new")).toBe(
      "/tmp/.mount_new:/tmp/.mount_new/usr/sbin:/usr/bin",
    );
  });

  it("leaves a PATH without mounts alone", () => {
    expect(pathWithoutAppImageMounts("/home/me/.local/bin:/usr/bin")).toBe("/home/me/.local/bin:/usr/bin");
    expect(pathWithoutAppImageMounts(undefined)).toBeUndefined();
  });

  it("launchers never get the app's mount in PATH", () => {
    expect(launcherEnv({ HOME: "/home/me", PATH: "/tmp/.mount_abc:/tmp/.mount_abc/usr/sbin:/usr/bin" }, "/home/me").PATH).toBe("/usr/bin");
  });
});

describe.runIf(process.platform === "linux")("a dead folder first in PATH (the real failure)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("stops a program lookup by name, and the cleaned PATH finds it again", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-path-"));
    // A folder whose lookups fail with an error other than "not found" (here a
    // symlink loop: ELOOP), standing in for a dead mount's ENOTCONN.
    const dead = join(dir, ".mount_dead");
    symlinkSync(dead, dead);
    const path = `${dead}:/usr/bin:/bin`;
    // (spawnSync is the real one: only execFileSync is mocked, for the relaunch)
    expect(spawnSync("true", [], { env: { PATH: path } }).error).toBeDefined();
    expect(spawnSync("true", [], { env: { PATH: pathWithoutAppImageMounts(path) } }).status).toBe(0);
  });
});

describe.runIf(process.platform === "linux")("the relaunch after an in-app update", () => {
  const saved = { PATH: process.env.PATH, APPIMAGE: process.env.APPIMAGE };
  afterEach(() => {
    process.env.PATH = saved.PATH;
    process.env.APPIMAGE = saved.APPIMAGE;
    execFileSyncMock.mockReset();
  });

  it("gives the new copy a PATH without this copy's AppImage mount", () => {
    process.env.PATH = "/tmp/.mount_DS5DonOLD:/tmp/.mount_DS5DonOLD/usr/sbin:/usr/local/bin:/usr/bin";
    const updater = new Updater(() => undefined);
    // An installed update, ready to restart into.
    Object.assign(updater as unknown as { state: unknown; installedPath: string }, { state: { phase: "ready" }, installedPath: "/opt/DS5.AppImage" });
    updater.restart();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const args = execFileSyncMock.mock.calls[0][1] as string[];
    expect(args[0]).toBe("--user");
    expect(args).toContain("--setenv=PATH=/usr/local/bin:/usr/bin");
    expect(args.join(" ")).not.toContain(".mount_");
  });

  // 0.9.5-dev.17: the relaunch unit (ExitType=main) killed the new copy's
  // AppImage runtime with its zygote when it quit (SIGBUS, a stale mount), and
  // app.exit skipped will-quit, so the old copy's pactl kept its runtime alive.
  it("lasts until its last process is gone, and quits normally (will-quit runs)", () => {
    vi.useFakeTimers();
    const updater = new Updater(() => undefined);
    Object.assign(updater as unknown as { state: unknown; installedPath: string }, { state: { phase: "ready" }, installedPath: "/opt/DS5.AppImage" });
    updater.restart();
    expect(execFileSyncMock.mock.calls[0][1]).toContain("--property=ExitType=cgroup");
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.exit).not.toHaveBeenCalled();
    // A quit that never finishes still ends this copy.
    vi.advanceTimersByTime(10_000);
    expect(app.exit).toHaveBeenCalledWith(0);
    vi.useRealTimers();
    vi.mocked(app.quit).mockClear();
    vi.mocked(app.exit).mockClear();
  });

  it("systemd < 250 refuses ExitType: the relaunch uses KillMode=process instead", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("Unknown assignment: ExitType=cgroup");
    });
    const updater = new Updater(() => undefined);
    Object.assign(updater as unknown as { state: unknown; installedPath: string }, { state: { phase: "ready" }, installedPath: "/opt/DS5.AppImage" });
    updater.restart();
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    expect(execFileSyncMock.mock.calls[1][1]).toContain("--property=KillMode=process");
    expect(execFileSyncMock.mock.calls[1][1]).not.toContain("--property=ExitType=cgroup");
  });
});
