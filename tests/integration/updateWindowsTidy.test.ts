// Windows: the start-up tidy-up (20 s in) emptied the update folder even while
// an update was downloading into it, and Restart now then started a missing
// installer and quit (bug hunt A5, 0.9.5). The tidy-up leaves the folder alone
// once a download started, and Restart now checks the file first.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const temp = mkdtempSync(join(tmpdir(), "updtidy-"));
const net = vi.hoisted(() => ({ fetch: (async () => new Response("")) as (url: string) => Promise<Response> }));
const exit = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.9.4", getPath: () => temp, releaseSingleInstanceLock: () => undefined, exit, quit: exit },
  net: { fetch: (url: string) => net.fetch(url) },
}));
const spawned = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => (spawned(...args), { unref() {} }), execFileSync: () => undefined }));

const saved = process.platform;
let Updater: typeof import("../../electron/main/updater").Updater;
beforeAll(async () => {
  process.env.DS5_UPDATE_MANIFEST = "http://127.0.0.1:8765/latest.json";
  Object.defineProperty(process, "platform", { value: "win32" });
  ({ Updater } = await import("../../electron/main/updater"));
});
afterAll(() => {
  Object.defineProperty(process, "platform", { value: saved });
  rmSync(temp, { recursive: true, force: true });
});

const BYTES = new Uint8Array([1, 2, 3]);
const SETUP = {
  url: "http://127.0.0.1:8765/DS5Dongle-OLED-Edition-Configurator-0.9.5-win-x64-setup.exe",
  size: BYTES.length,
  sha256: createHash("sha256").update(BYTES).digest("hex"),
};

it("the tidy-up spares a download in progress; Restart now with the installer gone says so and keeps running", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  net.fetch = async () => {
    await gate;
    return new Response(BYTES);
  };
  const states: string[] = [];
  const u = new Updater((s) => states.push(s.phase));
  // An update on offer (as a check on the installed app would leave it).
  Object.assign(u, { state: { phase: "available", version: "0.9.5", size: SETUP.size }, manifest: { app: { version: "0.9.5", platforms: { windows: SETUP } } }, manifestChannel: "stable" });
  const install = u.downloadAndInstall();
  await new Promise((r) => setTimeout(r, 10));
  u.pruneStaleFiles(); // the 20-second tidy-up lands mid-download
  release();
  expect(await install).toMatchObject({ phase: "ready", version: "0.9.5" });
  const installer = join(temp, "ds5-configurator-update", "DS5Dongle-OLED-Edition-Configurator-0.9.5-win-x64-setup.exe");
  expect(existsSync(installer)).toBe(true);

  rmSync(installer); // something else cleaned Temp
  u.restart();
  expect(u.getState()).toMatchObject({ phase: "failed", during: "install" });
  expect((u.getState() as { detail: string }).detail).toContain("desktop.errors.main.updateMissing");
  expect(spawned).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});
