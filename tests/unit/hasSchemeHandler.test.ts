// "Is the launcher installed?": Windows and macOS ask the system through
// Electron (app.getApplicationNameForProtocol), Linux asks xdg-mime with the
// real home and falls back to Electron's answer only without xdg-mime.
import { describe, expect, it } from "vitest";
import { hasSchemeHandler } from "../../electron/main/games/schemeHandler";

const names = (registered: Record<string, string>) => {
  const asked: string[] = [];
  const fn = (url: string) => {
    asked.push(url);
    return registered[url.split(":")[0]] ?? "";
  };
  return { fn, asked };
};
const xdg =
  (entry: string | null, err = false) =>
  async () => ({ err, entry });
const noXdg = async () => {
  throw new Error("xdg-mime must not be asked on this OS");
};

describe("hasSchemeHandler", () => {
  for (const platform of ["win32", "darwin"] as const) {
    it(`${platform}: not installed when Electron names no app (no longer always "installed")`, async () => {
      const e = names({ steam: "Steam" });
      expect(await hasSchemeHandler("heroic://launch?appName=x&runner=gog", e.fn, platform, noXdg)).toBe(false);
      expect(await hasSchemeHandler("steam://rungameid/4078430", e.fn, platform, noXdg)).toBe(true);
      expect(e.asked).toEqual(["heroic://", "steam://"]);
    });
  }

  it("Windows: GOG Galaxy and Epic links by their own schemes", async () => {
    const e = names({ goggalaxy: "GOG Galaxy" });
    expect(await hasSchemeHandler("goggalaxy://openGameView/1207664643", e.fn, "win32", noXdg)).toBe(true);
    expect(await hasSchemeHandler("com.epicgames.launcher://apps/x?action=launch&silent=true", e.fn, "win32", noXdg)).toBe(false);
  });

  it("an Electron error can't tell: the open attempt decides", async () => {
    const boom = () => {
      throw new Error("no");
    };
    expect(await hasSchemeHandler("steam://x", boom, "win32", noXdg)).toBe(true);
  });

  it("Linux: xdg-mime's answer (real home), not Electron's", async () => {
    const e = names({ heroic: "Heroic Games Launcher" });
    expect(await hasSchemeHandler("heroic://launch", e.fn, "linux", xdg(null))).toBe(false);
    expect(await hasSchemeHandler("lutris:rungame/x", e.fn, "linux", xdg("net.lutris.Lutris.desktop"))).toBe(true);
    expect(e.asked).toEqual([]);
  });

  it("Linux without xdg-mime: Electron's answer", async () => {
    expect(await hasSchemeHandler("heroic://launch", names({}).fn, "linux", xdg(null, true))).toBe(false);
    expect(await hasSchemeHandler("heroic://launch", names({ heroic: "Heroic" }).fn, "linux", xdg(null, true))).toBe(true);
  });

  it("no scheme: no handler", async () => {
    expect(await hasSchemeHandler("not a link", names({}).fn, "win32", noXdg)).toBe(false);
  });
});
