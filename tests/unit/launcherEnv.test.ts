import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn: spawnMock }));

import { launcherEnv, openForUser } from "../../electron/main/games/schemeHandler";

describe("launcherEnv", () => {
  const fake = "/home/me/.claude/jobs/x/tmp/devhome";
  it("replaces an overridden HOME with the real home and drops XDG folders inside it", () => {
    const env = launcherEnv(
      {
        HOME: fake,
        XDG_CONFIG_HOME: `${fake}/.config`,
        XDG_DATA_HOME: `${fake}/.local/share`,
        XDG_CACHE_HOME: fake,
        XDG_STATE_HOME: "/elsewhere/state",
        XDG_RUNTIME_DIR: "/run/user/1000",
        PATH: "/usr/bin",
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      },
      "/home/me",
    );
    expect(env).toEqual({
      HOME: "/home/me",
      XDG_STATE_HOME: "/elsewhere/state",
      XDG_RUNTIME_DIR: "/run/user/1000",
      PATH: "/usr/bin",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    });
  });

  it("keeps the user's own XDG folders when HOME isn't overridden", () => {
    const env = launcherEnv({ HOME: "/home/me", XDG_CONFIG_HOME: "/home/me/.cfg" }, "/home/me");
    expect(env).toEqual({ HOME: "/home/me", XDG_CONFIG_HOME: "/home/me/.cfg" });
  });

  it("drops app-only variables (Electron, Chromium, DS5 dev switches, AppImage runtime)", () => {
    const env = launcherEnv(
      { HOME: "/home/me", ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "x.desktop", DS5_DEV_TOOLS: "1", APPIMAGE: "/a.AppImage", APPDIR: "/tmp/.mount_x", LANG: "en_US.UTF-8" },
      "/home/me",
    );
    expect(env).toEqual({ HOME: "/home/me", LANG: "en_US.UTF-8" });
  });

  it("sets HOME even when none was set", () => {
    expect(launcherEnv({}, "/home/me")).toEqual({ HOME: "/home/me" });
  });
});

describe("openForUser", () => {
  it("spawns xdg-open with a fixed argv, no shell, detached, with the launcher env", async () => {
    const child = { once: vi.fn((ev: string, cb: () => void) => (ev === "spawn" ? cb() : undefined)), unref: vi.fn() };
    spawnMock.mockReturnValue(child);
    await expect(openForUser("heroic://launch?appName=1234&runner=gog")).resolves.toBe(true);
    const [cmd, argv, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("xdg-open");
    expect(argv).toEqual(["heroic://launch?appName=1234&runner=gog"]);
    expect(opts.shell).toBeUndefined();
    expect(opts.detached).toBe(true);
    expect(opts.env.HOME).toBeTruthy();
    expect(Object.keys(opts.env).some((k) => /^(ELECTRON_|DS5_|CHROME_)/.test(k))).toBe(false);
    expect(child.unref).toHaveBeenCalled();
  });

  it("refuses anything that would read as an option", async () => {
    spawnMock.mockClear();
    await expect(openForUser("--help")).resolves.toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
