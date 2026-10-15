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
  shellStart,
  shellStartArgs,
  shellStartScript,
  startIndependent,
  systemdRunArgs,
  unitAppId,
  unitName,
  windowsQuoteArg,
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

  it("drops this copy's AppImage mount from every variable (AppRun's LD_LIBRARY_PATH, XDG_DATA_DIRS, GSETTINGS_SCHEMA_DIR)", () => {
    // Heroic loaded the app's libnotify.so.4 from the mount and crashed at exit once it was gone (2026-10-13).
    const m = "/tmp/.mount_DS5DonBDx0o9";
    const env = launcherEnv(
      {
        HOME: "/home/me",
        LD_LIBRARY_PATH: `${m}/usr/lib`,
        XDG_DATA_DIRS: `${m}/usr/share/:/usr/share/gnome:/usr/local/share/:/usr/share/`,
        GSETTINGS_SCHEMA_DIR: `${m}/usr/share/glib-2.0/schemas:/opt/schemas`,
        QT_PLUGIN_PATH: `${m}/usr/plugins`,
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
        LS_COLORS: "rs=0:di=01;34",
      },
      "/home/me",
    );
    expect(env).toEqual({
      HOME: "/home/me",
      XDG_DATA_DIRS: "/usr/share/gnome:/usr/local/share/:/usr/share/",
      GSETTINGS_SCHEMA_DIR: "/opt/schemas",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      LS_COLORS: "rs=0:di=01;34",
    });
  });

  it("sets HOME even when none was set", () => {
    expect(launcherEnv({}, "/home/me")).toEqual({ HOME: "/home/me" });
  });
});

describe("openForUser", () => {
  it("without a user systemd, starts xdg-open with a fixed argv, no shell, with the launcher env (POSIX: detached; Windows: through PowerShell)", async () => {
    spawnMock.mockClear();
    const child = { once: vi.fn((ev: string, cb: (code?: number) => void) => (ev === "spawn" ? cb() : ev === "exit" ? cb(0) : undefined)), unref: vi.fn(), kill: vi.fn() };
    spawnMock.mockReturnValue(child);
    await expect(openForUser("heroic://launch?appName=1234&runner=gog")).resolves.toBe(true);
    const [cmd, argv, opts] = spawnMock.mock.calls[0];
    if (process.platform === "win32") {
      expect(cmd).toMatch(/powershell\.exe$/);
      expect(argv).toEqual(shellStartArgs("xdg-open", ["heroic://launch?appName=1234&runner=gog"]));
    } else {
      expect(cmd).toBe("xdg-open");
      expect(argv).toEqual(["heroic://launch?appName=1234&runner=gog"]);
      expect(opts.detached).toBe(true);
      expect(child.unref).toHaveBeenCalled();
    }
    expect(opts.shell).toBeUndefined();
    expect(opts.env.HOME).toBeTruthy();
    expect(Object.keys(opts.env).some((k) => /^(ELECTRON_|DS5_|CHROME_)/.test(k))).toBe(false);
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
    const calls = {
      systemdRun: [] as { argv: string[]; env: NodeJS.ProcessEnv }[],
      spawn: [] as { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[],
      shell: [] as { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[],
    };
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
      shellStart: async (cmd, args, env) => {
        calls.shell.push({ cmd, args, env });
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

  it("Windows: through the shell (no handles inherited), macOS: a detached spawn; never systemd", async () => {
    for (const platform of ["win32", "darwin"] as const) {
      let asked = false;
      const { deps, calls } = fakes({
        platform,
        userSystemd: async () => {
          asked = true;
          return null;
        },
      });
      await expect(startIndependent("C:\\Steam\\steam.exe", ["-silent"], deps)).resolves.toBe(true);
      expect(asked).toBe(false);
      expect(calls.systemdRun).toEqual([]);
      const started = [{ cmd: "C:\\Steam\\steam.exe", args: ["-silent"], env: ENV }];
      expect(platform === "win32" ? calls.shell : calls.spawn).toEqual(started);
      expect(platform === "win32" ? calls.spawn : calls.shell).toEqual([]);
    }
  });

  it("quotes Windows arguments the way the C runtime splits them", () => {
    expect(windowsQuoteArg("-silent")).toBe("-silent");
    expect(windowsQuoteArg("steam://rungameid/1091500")).toBe("steam://rungameid/1091500");
    expect(windowsQuoteArg("")).toBe('""');
    expect(windowsQuoteArg("C:\\Program Files\\x")).toBe('"C:\\Program Files\\x"');
    expect(windowsQuoteArg("C:\\My Dir\\")).toBe('"C:\\My Dir\\\\"');
    expect(windowsQuoteArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(windowsQuoteArg('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it("builds a Start-Process script with single-quoted PowerShell strings", () => {
    expect(shellStartScript("C:\\Steam\\steam.exe", [])).toBe("$ErrorActionPreference = 'Stop'\nStart-Process -FilePath 'C:\\Steam\\steam.exe'");
    expect(shellStartScript("C:\\O'Neil\\steam.exe", ["-silent", "steam://rungameid/1"])).toBe(
      "$ErrorActionPreference = 'Stop'\nStart-Process -FilePath 'C:\\O''Neil\\steam.exe' -ArgumentList '-silent steam://rungameid/1'",
    );
    const args = shellStartArgs("steam.exe", ["-silent"]);
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(Buffer.from(args[3], "base64").toString("utf16le")).toBe(shellStartScript("steam.exe", ["-silent"]));
  });

  it("starts PowerShell hidden (not detached), with no stdio and the launcher env; its exit code is the answer", async () => {
    for (const [code, ok] of [
      [0, true],
      [1, false],
    ] as const) {
      spawnMock.mockClear();
      const child = { once: vi.fn((ev: string, cb: (c: number) => void) => (ev === "exit" ? cb(code) : undefined)), kill: vi.fn() };
      spawnMock.mockReturnValue(child);
      await expect(shellStart("C:\\Steam\\steam.exe", ["-silent"], ENV)).resolves.toBe(ok);
      const [cmd, argv, opts] = spawnMock.mock.calls[0];
      expect(cmd).toMatch(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
      expect(argv).toEqual(shellStartArgs("C:\\Steam\\steam.exe", ["-silent"]));
      expect(opts).toEqual({ stdio: "ignore", windowsHide: true, env: ENV }); // not detached: see shellStart
      expect(opts.shell).toBeUndefined();
    }
  });
});
