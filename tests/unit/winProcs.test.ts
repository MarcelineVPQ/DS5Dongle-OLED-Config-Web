// Windows running programs: the native snapshot (winProcs.ts) and its tasklist fallback.
import { basename } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProcView } from "../../electron/main/games/running";
import { loadToolhelp, windowsProcReader } from "../../electron/main/games/winProcs";

const proc = (comm: string, pid = 1): ProcView => ({ pid, comm, args: [], cwd: null, env: {} });

describe("windowsProcReader", () => {
  it("reads through the native snapshot once it loads, without tasklist", async () => {
    const fallback = vi.fn(() => Promise.resolve([proc("tasklist-saw.exe")]));
    const load = vi.fn(() => Promise.resolve(() => [proc("game.exe", 42)]));
    const read = windowsProcReader(fallback, load);
    expect(await read()).toEqual([proc("game.exe", 42)]);
    expect(await read()).toEqual([proc("game.exe", 42)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses tasklist when the native part can't load, and doesn't try loading again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fallback = vi.fn(() => Promise.resolve([proc("steam.exe")]));
    const load = vi.fn(() => Promise.reject(new Error("no koffi")));
    const read = windowsProcReader(fallback, load);
    expect(await read()).toEqual([proc("steam.exe")]);
    expect(await read()).toEqual([proc("steam.exe")]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("falls back to tasklist for a pass whose snapshot fails, then tries the snapshot again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail = true;
    const fallback = vi.fn(() => Promise.resolve([proc("from-tasklist.exe")]));
    const read = windowsProcReader(fallback, () =>
      Promise.resolve(() => {
        if (fail) throw new Error("snapshot failed");
        return [proc("from-snapshot.exe")];
      }),
    );
    expect(await read()).toEqual([proc("from-tasklist.exe")]);
    fail = false;
    expect(await read()).toEqual([proc("from-snapshot.exe")]);
    expect(fallback).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("loadToolhelp", () => {
  it.runIf(process.platform === "win32")("lists the running programs, this one included", async () => {
    const read = await loadToolhelp();
    const procs = read();
    expect(procs.length).toBeGreaterThan(5);
    const me = procs.find((p) => p.pid === process.pid);
    expect(me?.comm.toLowerCase()).toBe(basename(process.execPath).toLowerCase());
  });

  it.skipIf(process.platform === "win32")("can't load off Windows (the reader then uses tasklist)", async () => {
    await expect(loadToolhelp()).rejects.toThrow();
  });
});
