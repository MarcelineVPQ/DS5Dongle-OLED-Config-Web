// Desktop detection and the desktop accent (electron/main/desktopTheme.ts).
// The app started without XDG_CURRENT_DESKTOP (systemd-run, autostart,
// AppImage/Flatpak launchers) still finds KDE Plasma and its accent.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let systemAccent = "";
vi.mock("electron", () => ({
  nativeTheme: { shouldUseDarkColors: false, on: () => undefined, removeListener: () => undefined },
  systemPreferences: { getAccentColor: () => systemAccent, on: () => undefined, removeListener: () => undefined },
}));
// No portal answers in tests.
vi.mock("node:child_process", () => ({ execFile: (_c: string, _a: string[], _o: object, cb: (e: Error) => void) => cb(new Error("no gdbus")) }));

const { isKdeSession } = await import("../../electron/main/desktopTheme");

describe("isKdeSession", () => {
  const never = () => false;
  it("KDE from XDG_CURRENT_DESKTOP", () => expect(isKdeSession({ XDG_CURRENT_DESKTOP: "KDE" }, false, never)).toBe(true));
  it("KDE without XDG_CURRENT_DESKTOP: KDE_FULL_SESSION", () => expect(isKdeSession({ KDE_FULL_SESSION: "true" }, false, never)).toBe(true));
  it("KDE without XDG_CURRENT_DESKTOP: DESKTOP_SESSION / XDG_SESSION_DESKTOP", () => {
    expect(isKdeSession({ DESKTOP_SESSION: "plasma" }, false, never)).toBe(true);
    expect(isKdeSession({ DESKTOP_SESSION: "/usr/share/wayland-sessions/plasma" }, false, never)).toBe(true);
    expect(isKdeSession({ XDG_SESSION_DESKTOP: "KDE" }, false, never)).toBe(true);
  });
  it("KDE without any variable: kdeglobals and a running Plasma shell / KWin", () => {
    expect(isKdeSession({}, true, () => true)).toBe(true);
    expect(isKdeSession({}, true, never)).toBe(false);
    expect(isKdeSession({}, false, () => true)).toBe(false);
  });
  it("not KDE on GNOME", () => expect(isKdeSession({ XDG_CURRENT_DESKTOP: "GNOME", DESKTOP_SESSION: "gnome" }, true, never)).toBe(false));
});

describe.runIf(process.platform === "linux")("readDesktopPalette", () => {
  let dir = "";
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    if (dir) rmSync(dir, { recursive: true, force: true });
    systemAccent = "";
    vi.resetModules();
  });
  const load = async (kdeglobals: string | null, env: NodeJS.ProcessEnv) => {
    dir = mkdtempSync(join(tmpdir(), "ds5-kde-"));
    if (kdeglobals !== null) writeFileSync(join(dir, "kdeglobals"), kdeglobals);
    process.env = { HOME: dir, XDG_CONFIG_HOME: dir, ...env };
    vi.resetModules();
    return (await import("../../electron/main/desktopTheme")).readDesktopPalette();
  };

  it("KDE's [General] AccentColor without XDG_CURRENT_DESKTOP", async () => {
    const p = await load("[General]\nAccentColor=233,58,154\n", { KDE_FULL_SESSION: "true" });
    expect(p?.accent).toEqual([233, 58, 154]);
  });
  it("falls back to the system accent", async () => {
    systemAccent = "e93a9aff";
    const p = await load(null, {});
    expect(p).toMatchObject({ source: "accent", accent: [233, 58, 154] });
  });
  it("null when no accent can be read at all", async () => {
    expect(await load(null, {})).toBeNull();
  });
});
