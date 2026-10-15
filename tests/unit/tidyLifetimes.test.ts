// Lifetime pass batch 4 (docs/LIFETIME_PASS_2026-10.md), the tidy items in
// the main process: the Proton feed's 5 s timeout is cleared once the feed
// answers, and the desktop-palette watcher's stop (now called at quit) also
// drops a pending debounce.
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import type { Manifest } from "../../src/update/manifest";
import { asLinux } from "../support/platform";

const electron = vi.hoisted(() => ({ nativeTheme: null as unknown as EventEmitter, systemPreferences: null as unknown as EventEmitter }));
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  electron.nativeTheme = new Emitter();
  electron.systemPreferences = new Emitter();
  return electron;
});
const { watchDesktopPalette } = await import("../../electron/main/desktopTheme");
const { GamesService } = await import("../../electron/main/games/service");

asLinux();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the Proton feed's timeout during a scan", () => {
  it("is cleared as soon as the feed answers", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-tidy-")));
    const realHome = process.env.HOME;
    try {
      const set = vi.spyOn(globalThis, "setTimeout");
      const clear = vi.spyOn(globalThis, "clearTimeout");
      const service = new GamesService({
        userData: join(home, "userdata"),
        allowed: () => true,
        fetchManifest: () => Promise.resolve({ proton: null } as unknown as Manifest),
        download: () => Promise.reject(new Error("offline")),
        onProtonProgress: () => undefined,
        notDetected: () => new Set(),
        hdrMarked: () => new Set(),
        launchers: { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true },
        probes: { audioCards: async () => [], hdr: async () => NO_HDR_SYSTEM },
      });
      process.env.HOME = home;
      await service.scan();
      const i = set.mock.calls.findIndex((c) => c[1] === 5000);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(clear).toHaveBeenCalledWith(set.mock.results[i].value);
    } finally {
      process.env.HOME = realHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the desktop palette watcher", () => {
  it("stops listening, and a change waiting in the debounce never fires", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = watchDesktopPalette(onChange);
    expect(electron.nativeTheme.listenerCount("updated")).toBe(1);
    electron.nativeTheme.emit("updated");
    stop();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    expect(electron.nativeTheme.listenerCount("updated")).toBe(0);
  });
});
