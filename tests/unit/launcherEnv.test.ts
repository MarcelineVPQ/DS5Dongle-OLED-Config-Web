import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
// No user systemd here (systemctl fails), so starts fall back to the detached spawn.
const execFileMock = vi.hoisted(() => vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, out: string) => void) => cb(new Error("no systemd"), "")));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn: spawnMock, execFile: execFileMock }));

import {
  launcherEnv,
  openForUser,
  parseManagerEnv,
  parseSystemdVersion,
  startIndependent,
  systemdRunArgs,
  unitAppId,
  unitName,
  type RunResult,
  type StartDeps,
} from "../../electron/main/games/schemeHandler";

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
  it("without a user systemd, spawns xdg-open with a fixed argv, no shell, detached, with the launcher env", async () => {
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

describe("starting programs independent of the app", () => {
  const ENV = { HOME: "/home/me", PATH: "/usr/bin", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", INVOCATION_ID: "abc", JOURNAL_STREAM: "8:9" };
  const MANAGER = { HOME: "/home/me", PATH: "/usr/bin", DISPLAY: ":0" };

  function fakes(over: Partial<StartDeps> & { run?: RunResult } = {}) {
    const calls = { systemdRun: [] as { argv: string[]; env: NodeJS.ProcessEnv }[], spawn: [] as { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] };
    const deps: StartDeps = {
      platform: "linux",
      env: () => ({ ...ENV }),
      userSystemd: async () => ({ version: 259, env: MANAGER }),
      systemdRun: async (argv, env) => {
        calls.systemdRun.push({ argv, env });
        return over.run ?? "ok";
      },
      spawnDetached: async (cmd, args, env) => {
        calls.spawn.push({ cmd, args, env });
        return true;
      },
      now: () => 1_760_000_000_000,
      random: () => "a1b2c3",
      ...over,
    };
    return { deps, calls };
  }

  it("names units the desktop way: app-<launcher>-<app id>@<random>.service", () => {
    expect(unitAppId("steam", ["-silent"])).toBe("steam");
    expect(unitAppId("/opt/Heroic/heroic", [])).toBe("heroic");
    expect(unitAppId("/home/me/Apps/Heroic-2.15.0.AppImage", [])).toBe("heroic2.15.0");
    expect(unitAppId("flatpak", ["run", "com.valvesoftware.Steam"])).toBe("com.valvesoftware.steam");
    expect(unitAppId("xdg-open", ["steam://nav/games"])).toBe("xdgopen");
    expect(unitAppId("C:\\Program Files (x86)\\Steam\\steam.exe", [])).toBe("steam");
    expect(unitAppId("-_-", [])).toBe("program");
    expect(unitName("steam", [], 1_760_000_000_000, "a1b2c3")).toBe(`app-ds5configurator-steam@${(1_760_000_000_000).toString(36)}a1b2c3.service`);
  });

  it("parses systemctl's environment and version", () => {
    expect(parseManagerEnv("HOME=/home/me\nLANG=en_US.UTF-8\nX=a=b\n\n")).toEqual({ HOME: "/home/me", LANG: "en_US.UTF-8", X: "a=b" });
    expect(parseSystemdVersion("systemd 259 (259.5-0ubuntu3.4)\n+PAM +AUDIT")).toBe(259);
    expect(parseSystemdVersion("")).toBe(0);
  });

  it("Linux: systemd-run in its own transient unit, fixed argv, --setenv only for launcher variables that differ", async () => {
    const { deps, calls } = fakes();
    await expect(startIndependent("steam", ["-silent"], deps)).resolves.toBe(true);
    expect(calls.spawn).toEqual([]);
    expect(calls.systemdRun).toHaveLength(1);
    const { argv, env } = calls.systemdRun[0];
    expect(argv).toEqual([
      "--user",
      "--collect",
      "--quiet",
      `--unit=app-ds5configurator-steam@${(1_760_000_000_000).toString(36)}a1b2c3.service`,
      "--property=Type=exec",
      "--property=ExitType=cgroup",
      "--setenv=WAYLAND_DISPLAY=wayland-0",
      "--",
      "steam",
      "-silent",
    ]);
    // Never the app unit's own per-unit variables.
    expect(argv.join(" ")).not.toMatch(/INVOCATION_ID|JOURNAL_STREAM/);
    // systemd-run itself gets the launcher env (its session bus, PATH).
    expect(env).toEqual(ENV);
  });

  it("Linux before systemd 250: KillMode=process keeps the program when the unit ends", () => {
    const argv = systemdRunArgs("xdg-open", ["https://example.org"], { HOME: "/h" }, { version: 249, env: { HOME: "/h" } }, "u.service");
    expect(argv).toContain("--property=KillMode=process");
    expect(argv).not.toContain("--property=ExitType=cgroup");
    expect(argv.slice(-3)).toEqual(["--", "xdg-open", "https://example.org"]);
  });

  it("Linux: --setenv carries a changed HOME and new variables, values verbatim (no shell)", () => {
    const argv = systemdRunArgs("heroic", [], { HOME: "/home/me", A: "x; rm -rf ~", PATH: "/usr/bin" }, { version: 259, env: { HOME: "/tmp/dev", PATH: "/usr/bin" } }, "u.service");
    expect(argv.filter((a) => a.startsWith("--setenv="))).toEqual(["--setenv=HOME=/home/me", "--setenv=A=x; rm -rf ~"]);
  });

  it("Linux without a user systemd: a detached spawn with the launcher env", async () => {
    const { deps, calls } = fakes({ userSystemd: async () => null });
    await expect(startIndependent("lutris", [], deps)).resolves.toBe(true);
    expect(calls.systemdRun).toEqual([]);
    expect(calls.spawn).toEqual([{ cmd: "lutris", args: [], env: ENV }]);
  });

  it("Linux: falls back when systemd-run fails (missing, no bus), never when it timed out (no second copy)", async () => {
    const failed = fakes({ run: "failed" });
    await expect(startIndependent("steam", [], failed.deps)).resolves.toBe(true);
    expect(failed.calls.spawn).toEqual([{ cmd: "steam", args: [], env: ENV }]);

    const timedOut = fakes({ run: "timeout" });
    await expect(startIndependent("steam", [], timedOut.deps)).resolves.toBe(false);
    expect(timedOut.calls.spawn).toEqual([]);
  });

  it("Windows and macOS: a detached spawn (no job object, reparented on exit), never systemd", async () => {
    for (const platform of ["win32", "darwin"] as const) {
      let asked = false;
      const { deps, calls } = fakes({
        platform,
        userSystemd: async () => {
          asked = true;
          return null;
        },
      });
      await expect(startIndependent("C:\\Steam\\steam.exe", [], deps)).resolves.toBe(true);
      expect(asked).toBe(false);
      expect(calls.systemdRun).toEqual([]);
      expect(calls.spawn).toEqual([{ cmd: "C:\\Steam\\steam.exe", args: [], env: ENV }]);
    }
  });
});
