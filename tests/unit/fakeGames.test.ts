// Developer card → Fake games (dev builds only): the made-up library has what
// the Games pages need to show (stores, tiers, setup states, HDR, runners,
// play history, art), Apply / Undo act on it alone, the art is drawn at the
// launchers' real sizes, and a release build can't reach any of it.
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ipcHandled = vi.hoisted(() => [] as string[]);
vi.mock("electron", () => ({
  default: "electron",
  ipcMain: { handle: (channel: string) => ipcHandled.push(channel), on: () => undefined },
  nativeImage: {},
}));

import { GameKeySchema } from "../../src/desktop/games/library";
import { FixIdsSchema, registerIpc, type IpcHandlers } from "../../electron/main/ipc";
import { IPC } from "../../src/desktop/api";
import { allFixes, type ArtKind } from "../../src/desktop/games/types";
import { supportOf } from "../../src/desktop/library/support";
import {
  ART_SIZES,
  FAKE_GAMES,
  LATEST_PROTON,
  OLD_GE,
  OUR_PROTON,
  fakeApply,
  fakeBackups,
  fakeDetails,
  fakeKey,
  fakeReport,
  fakeUndo,
  isFakeKey,
  newFakeState,
} from "../../electron/main/games/fake/library";
import { GLYPHS, drawArt, wrapTitle } from "../../electron/main/games/fake/art";
import { FakeGamesService, PLAY_MS } from "../../electron/main/games/fake/service";

const linux = { linux: true, now: new Date("2026-10-14T12:00:00Z") };
const titleKey = (title: string) => fakeKey(FAKE_GAMES.find((g) => g.title === title)!);

describe("the fake library", () => {
  const report = fakeReport(newFakeState(), linux);

  it("has about 20 games with valid, unique keys that can never match a real install", () => {
    expect(report.games.length).toBe(21);
    const keys = report.games.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(GameKeySchema.safeParse(k).success, k).toBe(true);
      expect(isFakeKey(k)).toBe(true);
    }
  });

  it("covers Steam, Heroic's GOG, Epic, Amazon and sideloaded games, and Lutris", () => {
    const pairs = new Set(report.games.map((g) => `${g.launcher}/${g.store}`));
    for (const p of ["steam/steam", "heroic/gog", "heroic/epic", "heroic/amazon", "heroic/sideload", "lutris/lutris"]) expect(pairs).toContain(p);
    expect(report.launchers.map((l) => [l.id, l.running])).toEqual([
      ["steam", true],
      ["heroic", false],
      ["lutris", false],
    ]);
  });

  it("shows every DualSense tier the app assigns", () => {
    const tiers = new Set(report.games.map((g) => supportOf(g).tier));
    // "broken" comes from community reports later (support.ts); nothing assigns it yet.
    for (const t of ["verified", "works", "needs-setup", "partial", "unknown"]) expect(tiers).toContain(t);
  });

  it("mixes set-up games and ones that need attention, with ids the IPC accepts", () => {
    const fixes = allFixes(report);
    expect(FixIdsSchema.safeParse(fixes.map((f) => f.id)).success).toBe(true);
    expect(report.games.some((g) => g.fixes.length === 0)).toBe(true);
    const kinds = new Set(fixes.map((f) => f.kind));
    for (const k of ["set-default", "set-runner", "steam-input-off", "remove-env", "standard-gamepad", "hdr-on", "graphics-mode", "audio-volume"]) expect(kinds).toContain(k);
    // Every fix names the file it would change, except the controller volume (ALSA, no file).
    for (const f of fixes) if (f.kind !== "audio-volume") expect(f.files.length, f.id).toBeGreaterThan(0);
  });

  it("has our Proton, an older GE-Proton and a missing runner, and an update to install", () => {
    expect(report.games.some((g) => g.usesOurProton)).toBe(true);
    expect(report.games.some((g) => g.runner === OLD_GE)).toBe(true);
    expect(report.games.some((g) => g.runnerMissing)).toBe(true);
    expect(report.ourProton).toMatchObject({ name: OUR_PROTON, latest: LATEST_PROTON, updateAvailable: true });
  });

  it("has HDR games in every state, and 'missing' when the computer isn't ready", () => {
    const states = (hdr: "ready" | "hdr-off" | "no-gamescope") => {
      const s = newFakeState();
      s.hdr = hdr;
      return new Set(
        fakeReport(s, linux)
          .games.map((g) => g.hdr)
          .filter(Boolean),
      );
    };
    expect(states("ready")).toEqual(new Set(["set", "needed", "update"]));
    expect(states("no-gamescope")).toEqual(new Set(["set", "missing", "update"]));
    expect(fakeReport(newFakeState(), linux).system.hdr.screens.some((s) => s.hdr)).toBe(true);
  });

  it("leaves Proton and HDR out off Linux, like the real scan", () => {
    const r = fakeReport(newFakeState(), { ...linux, linux: false });
    expect(r.games.every((g) => g.hdr === undefined && !g.runnerMissing && !g.usesOurProton)).toBe(true);
    expect(r.launchers.every((l) => l.fixes.length === 0)).toBe(true);
  });

  it("has play history for Continue playing and art at the stores' sizes, one game with none", () => {
    const d = fakeDetails(newFakeState(), linux.now.getTime());
    const played = Object.values(d).filter((i) => i.lastPlayed);
    expect(played.length).toBeGreaterThanOrEqual(5);
    expect(Object.values(d).filter((i) => i.art.length === 0)).toHaveLength(1);
    expect(ART_SIZES.steam).toMatchObject({ cover: [600, 900], hero: [1920, 620], header: [460, 215], icon: [32, 32] });
    expect(ART_SIZES.small.cover).toEqual([300, 450]);
    expect(d[titleKey("Cyberpunk 2077")].actions).toContain("play");
  });
});

describe("Apply and Undo on the fake", () => {
  it("asks to close a running launcher first, then applies, lists the change and undoes it", () => {
    const s = newFakeState();
    const key = titleKey("The Last of Us Part I");
    const fix = fakeReport(s, linux)
      .games.find((g) => g.key === key)!
      .fixes.find((f) => f.kind === "set-runner")!;
    expect(fakeApply(s, [fix.id], [], linux)).toEqual({ applied: [], backupId: null, blockedBy: ["steam"] });
    const r = fakeApply(s, [fix.id, "steam-fa4e5001:runner:999"], ["steam"], linux);
    expect(r.applied).toEqual([{ id: fix.id, ok: true }, expect.objectContaining({ id: "steam-fa4e5001:runner:999", ok: false })]);
    const after = fakeReport(s, linux).games.find((g) => g.key === key)!;
    expect(after.runner).toBe(OUR_PROTON);
    expect(after.fixes.some((f) => f.id === fix.id)).toBe(false);
    expect(fakeBackups(s).map((b) => b.id)).toEqual([r.backupId]);
    expect(fakeUndo(s, r.backupId!, ["steam"])).toEqual({ ok: true, restored: fix.files });
    expect(fakeReport(s, linux).games.find((g) => g.key === key)!.runner).toBe(OLD_GE);
    expect(fakeBackups(s)).toEqual([]);
  });

  it("the Proton version picker: every launcher's builds, ours recommended, a pick applied and undone", () => {
    const s = newFakeState();
    const r = fakeReport(s, linux);
    // loop: NOT-WORTH — a test over 20 fake games
    for (const g of r.games) {
      expect(g.protons![0], g.title).toMatchObject({ name: OUR_PROTON, recommended: true });
      expect(g.protons!.filter((c) => c.current).length, g.title).toBeLessThanOrEqual(1);
      expect(FixIdsSchema.safeParse(g.protons!.flatMap((c) => (c.fix ? [c.fix.id] : []))).success, g.title).toBe(true);
    }
    expect(allFixes(r).some((f) => f.kind === "set-proton")).toBe(false); // never a recommended change
    const key = titleKey("Cyberpunk 2077");
    const pick = r.games.find((g) => g.key === key)!.protons!.find((c) => c.name === "Proton 9.0")!.fix!;
    const done = fakeApply(s, [pick.id], ["steam"], linux);
    expect(done.applied).toEqual([{ id: pick.id, ok: true }]);
    const after = fakeReport(s, linux).games.find((g) => g.key === key)!;
    expect(after.runner).toBe("proton_9");
    expect(after.protons!.find((c) => c.current)!.name).toBe("Proton 9.0");
    expect(fakeUndo(s, done.backupId!, ["steam"])).toMatchObject({ ok: true });
    expect(fakeReport(s, linux).games.find((g) => g.key === key)!.runner).toBe(OUR_PROTON);
    // Off Linux: no picker.
    expect(fakeReport(newFakeState(), { ...linux, linux: false }).games.every((g) => g.protons === undefined)).toBe(true);
  });
});

describe("generated art", () => {
  it("draws each kind at the size asked for, the logo with transparency", () => {
    const sizes: Array<[ArtKind, number, number]> = [
      ["cover", 300, 450],
      ["header", 460, 215],
      ["logo", 480, 180],
      ["icon", 32, 32],
    ];
    for (const [kind, w, h] of sizes) {
      const b = drawArt(kind, "Cyberpunk 2077", w, h);
      expect([b.width, b.height, b.data.length]).toEqual([w, h, w * h * 4]);
    }
    const logo = drawArt("logo", "Sifu", 480, 180).data;
    const alphas = new Set<number>();
    for (let i = 3; i < logo.length; i += 4) alphas.add(logo[i]);
    expect(alphas.has(0) && alphas.has(255)).toBe(true);
    const cover = drawArt("cover", "Sifu", 120, 180).data;
    for (let i = 3; i < cover.length; i += 4) expect(cover[i]).toBe(255);
  });

  it("is the same picture every time, and differs between games", () => {
    const a = drawArt("header", "Metro Exodus", 92, 43).data;
    expect(drawArt("header", "Metro Exodus", 92, 43).data).toEqual(a);
    expect(drawArt("header", "Maneater", 92, 43).data).not.toEqual(a);
  });

  it("has a whole 5x7 glyph for every character of the font", () => {
    for (const [c, g] of Object.entries(GLYPHS)) expect(g.length, c).toBe(c === " " ? 0 : 35);
  });

  it("wraps titles into the font's characters", () => {
    expect(wrapTitle("Marvel's Spider-Man Remastered", 10)).toEqual(["MARVEL'S", "SPIDER-MAN", "REMASTERED"]);
  });
});

describe("FakeGamesService", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-games-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.useRealTimers());

  const service = (onRunning = vi.fn()) =>
    new FakeGamesService({
      dir,
      platform: "linux",
      encode: (b) => Buffer.from(`${b.width}x${b.height}`),
      colorOf: () => "#ff8800",
      onRunning,
      onProtonProgress: () => undefined,
      wait: () => Promise.resolve(),
    });

  it("writes its art into its own folder once, and has none for the game without art", async () => {
    const s = service();
    const cover = await s.artFile(titleKey("Cyberpunk 2077"), "cover");
    expect(cover?.startsWith(dir)).toBe(true);
    const mtime = statSync(cover!).mtimeMs;
    expect(await s.artFile(titleKey("Cyberpunk 2077"), "cover")).toBe(cover);
    expect(statSync(cover!).mtimeMs).toBe(mtime);
    expect(await s.artFile(titleKey("Portal 2"), "cover")).toBeUndefined();
    expect(await s.artFile("steam-1a2b3c4d:steam:620", "cover")).toBeUndefined();
    expect(await s.artColor(titleKey("Cyberpunk 2077"))).toBe("#ff8800");
  });

  it("keeps the fake games' profiles and ratings in a library of its own", () => {
    const lib = service().library().get();
    expect(lib.games[titleKey("Cyberpunk 2077")]?.profile).toBeDefined();
    expect(lib.games[titleKey("Baldur's Gate 3")]?.mine?.rating).toBe(4);
    expect(readdirSync(dir)).toContain("game-library-2.json");
  });

  it("▶ Play marks the game running for a minute; the card can pick any game or none", () => {
    vi.useFakeTimers();
    const onRunning = vi.fn();
    const s = service(onRunning);
    const key = titleKey("Sifu");
    expect(s.gameAction(key, "play")).toBe(true);
    expect(s.running).toBe(key);
    expect(s.runningLaunchers()).toContain("heroic");
    vi.advanceTimersByTime(PLAY_MS);
    expect(s.running).toBeNull();
    expect(onRunning.mock.calls).toEqual([[key], [null]]);
    s.setRunning(titleKey("Control"));
    vi.advanceTimersByTime(PLAY_MS * 2);
    expect(s.running).toBe(titleKey("Control"));
    expect(s.gameAction("steam-1a2b3c4d:steam:620", "play")).toBe(false);
  });

  it("installs our newest Proton into the fake only", async () => {
    const s = service();
    expect(await s.installLatestProton()).toMatchObject({ ok: true, name: LATEST_PROTON });
    expect((await s.scan()).ourProton.updateAvailable).toBe(false);
  });
});

describe("release builds can't reach Fake games", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the main process's dev-tools flag is off unless the build defines it", async () => {
    vi.resetModules();
    expect((await import("../../electron/main/devTools")).DEV_TOOLS_BUILT).toBe(false);
    vi.stubEnv("VITE_DEV_TOOLS", "1");
    vi.resetModules();
    expect((await import("../../electron/main/devTools")).DEV_TOOLS_BUILT).toBe(true);
  });

  it("registers the dev channel only when given its handler", () => {
    const handlers = (dev: boolean) => new Proxy({} as IpcHandlers, { get: (_t, k) => (k === "devFakeGames" && !dev ? undefined : () => undefined) });
    ipcHandled.length = 0;
    registerIpc(handlers(false));
    expect(ipcHandled).not.toContain(IPC.devFakeGames);
    expect(ipcHandled).toContain(IPC.gamesScan);
    ipcHandled.length = 0;
    registerIpc(handlers(true));
    expect(ipcHandled).toContain(IPC.devFakeGames);
  });

  it("index.ts uses the fake only behind DEV_TOOLS_BUILT and the setting", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(join(__dirname, "../../electron/main/index.ts"), "utf8");
    expect(main).toContain("if (!DEV_TOOLS_BUILT || !settings.devFakeGames) return null;");
    expect(main).toMatch(/devFakeGames: DEV_TOOLS_BUILT\s*\?/);
    // The setting can't be changed through the ordinary setSetting channel.
    expect(readFileSync(join(__dirname, "../../electron/main/settings.ts"), "utf8")).not.toMatch(/key: z\.literal\("devFakeGames"\)/);
  });
});
