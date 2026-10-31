// Two update checks on different channels must not race (bug hunt A1, 0.9.5):
// a slow Development-channel check that answered after Back to stable won, so
// the banner offered (and automatic updates could install) a development
// build on the stable channel. Only the newest check's answer counts, and
// only while its channel is still the one chosen.
import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ fetch: (async () => new Response("")) as (url: string) => Promise<Response> }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.9.5-dev.18", releaseSingleInstanceLock: () => undefined, getPath: () => "/nonexistent" },
  net: { fetch: (url: string) => net.fetch(url) },
}));

const FEED = "http://127.0.0.1:8765/latest.json";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signed = (t: string) => sign(null, Buffer.from(t), privateKey).toString("base64");
const dl = (v: string) => ({ url: `http://127.0.0.1:8765/DS5Dongle-OLED-Edition-Configurator-${v}-linux-x86_64.AppImage`, size: 10, sha256: "0".repeat(64) });
const STABLE = JSON.stringify({ channel: "stable", app: { version: "0.9.5", platforms: { linux: dl("0.9.5") } } });
const DEV = JSON.stringify({ channel: "dev", app: { version: "0.9.6-dev.1", platforms: { linux: dl("0.9.6-dev.1") } } });

let Updater: typeof import("../../electron/main/updater").Updater;
const saved = { appimage: process.env.APPIMAGE, platform: process.platform };
beforeAll(async () => {
  process.env.DS5_UPDATE_MANIFEST = FEED;
  process.env.DS5_UPDATE_PUBKEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  // A Linux AppImage that can replace itself, so the check answers "available".
  Object.defineProperty(process, "platform", { value: "linux" });
  process.env.APPIMAGE = "/nonexistent/x.AppImage";
  ({ Updater } = await import("../../electron/main/updater"));
});
afterAll(() => {
  Object.defineProperty(process, "platform", { value: saved.platform });
  if (saved.appimage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = saved.appimage;
});

// The dev feed answers only when released (a slow network); stable at once.
function slowDevFeed(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  net.fetch = async (url) => {
    const dev = url.includes("latest-dev.json");
    if (dev) await gate;
    const body = dev ? DEV : STABLE;
    return new Response(url.endsWith(".sig") ? signed(body) : body);
  };
  return release;
}

it("a slow Development-channel check that answers after Back to stable is dropped", async () => {
  const releaseDev = slowDevFeed();
  let channel: "dev" | "stable" = "dev";
  const u = new Updater(
    () => undefined,
    () => channel,
  );
  const first = u.check(); // the scheduled check, on the Development channel
  channel = "stable"; // Back to stable: the setting, then its own check
  expect(await u.backToStable()).toMatchObject({ phase: "available", version: "0.9.5" });
  releaseDev();
  await first;
  expect(u.getState()).toMatchObject({ phase: "available", version: "0.9.5" });
  expect(u.autoInstallable()).toBe(true);
});

it("a check whose channel changed with no new check offers nothing (not the old channel's build)", async () => {
  const releaseDev = slowDevFeed();
  let channel: "dev" | "stable" = "dev";
  const u = new Updater(
    () => undefined,
    () => channel,
  );
  const first = u.check();
  channel = "stable"; // automatic checks off: the switch doesn't check again
  releaseDev();
  expect(await first).toEqual({ phase: "idle" });
  expect(u.autoInstallable()).toBe(false);
});

it("an offer from the old channel is never installed automatically, and Install looks again on the new one", async () => {
  const releaseDev = slowDevFeed();
  releaseDev();
  let channel: "dev" | "stable" = "dev";
  const u = new Updater(
    () => undefined,
    () => channel,
  );
  expect(await u.check()).toMatchObject({ phase: "available", version: "0.9.6-dev.1" });
  channel = "stable";
  expect(u.autoInstallable()).toBe(false);
  // Install on the stable channel: a fresh check, which offers stable's version instead.
  expect(await u.downloadAndInstall()).toMatchObject({ phase: "available", version: "0.9.5" });
});
