// @vitest-environment jsdom
// Dev-tools builds (DS5_DEV_TOOLS=1 or X.Y.Z-dev.N): the Developer card shows
// on any update channel, and the in-app update never silently replaces the
// build with a regular one (no automatic install; the offer says what it
// drops). Release builds never show the card and install as before.
import { generateKeyPairSync, sign } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import type { UpdateState } from "../../src/desktop/api";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";
import UpdateBanners from "../../src/desktop/UpdateBanners";
import { updateDropsDevTools } from "../../electron/main/updater";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const net = vi.hoisted(() => ({ fetch: (async () => new Response("")) as (url: string) => Promise<Response> }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.9.5-dev.12" },
  net: { fetch: (url: string) => net.fetch(url) },
}));

const FEED = "http://127.0.0.1:8765/latest.json";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const DL = { url: "http://127.0.0.1:8765/a", size: 1, sha256: "0".repeat(64) };
function serve(version: string) {
  const feed = JSON.stringify({ app: { version, platforms: { linux: DL, windows: DL, macos: DL } } });
  const sig = sign(null, Buffer.from(feed), privateKey).toString("base64");
  net.fetch = async (url) => new Response(url.endsWith(".sig") ? sig : feed);
}

// A fresh module graph with the build flag as a dev-tools or a release build sets it.
async function build(devTools: boolean) {
  vi.stubEnv("VITE_DEV_TOOLS", devTools ? "1" : "0");
  vi.resetModules();
  return {
    updater: await import("../../electron/main/updater"),
    panel: await import("../../src/desktop/live/PartPanel"),
    i18n: (await import("../../src/i18n")).default,
  };
}

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const env = { ...process.env };
beforeAll(() => {
  // A self-installing Linux AppImage, against the loopback test feed.
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.assign(process.env, { DS5_UPDATE_MANIFEST: FEED, DS5_UPDATE_PUBKEY: publicKey.export({ format: "der", type: "spki" }).toString("base64"), APPIMAGE: "/x/a.AppImage" });
});
afterAll(() => {
  Object.defineProperty(process, "platform", platform);
  process.env = env;
  vi.unstubAllEnvs();
});

describe("updateDropsDevTools", () => {
  it("only a dev-tools build offered a regular release", () => {
    expect(updateDropsDevTools(true, "0.9.6")).toBe(true);
    expect(updateDropsDevTools(true, "0.9.6-dev.1")).toBe(false);
    expect(updateDropsDevTools(false, "0.9.6")).toBe(false);
    expect(updateDropsDevTools(false, "0.9.6-dev.1")).toBe(false);
  });
});

describe("the updater in a dev-tools build", () => {
  it("offers a regular release with the note, never for automatic install", async () => {
    const { updater } = await build(true);
    serve("0.9.6");
    const u = new updater.Updater(() => undefined);
    expect(await u.check()).toMatchObject({ phase: "available", version: "0.9.6", dropsDevTools: true });
    expect(u.autoInstallable()).toBe(false);
  });
  it("installs the next development build automatically as before", async () => {
    const { updater } = await build(true);
    serve("0.9.5-dev.13");
    const u = new updater.Updater(() => undefined);
    const state = await u.check();
    expect(state).toMatchObject({ phase: "available", version: "0.9.5-dev.13" });
    expect((state as { dropsDevTools?: true }).dropsDevTools).toBeUndefined();
    expect(u.autoInstallable()).toBe(true);
  });
  it("a release build installs a release automatically as before", async () => {
    const { updater } = await build(false);
    serve("0.9.6");
    const u = new updater.Updater(() => undefined);
    expect(((await u.check()) as { dropsDevTools?: true }).dropsDevTools).toBeUndefined();
    expect(u.autoInstallable()).toBe(true);
  });
});

describe("the update banner", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fw = { state: { phase: "idle" }, dismiss: () => undefined, available: false, latest: null, problem: null, backToStable: false } as unknown as FirmwareUpdate;
  const render = (app: UpdateState) => {
    vi.stubGlobal("desktop", { platform: "linux", getFirmwareHold: () => Promise.resolve({ writing: false, restartQueued: false, quitQueued: false }), onFirmwareHold: () => () => undefined });
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(createElement(UpdateBanners, { app, fw, onShowFirmware: () => undefined, onFirmwareChanges: () => undefined })));
  };
  afterEach(() => act(() => root.unmount()));

  it("says a regular release drops the developer tools, and still offers it", () => {
    render({ phase: "available", version: "0.9.6", size: 1, dropsDevTools: true });
    expect(container.textContent).toContain(i18n.t("desktop.update.dropsDevTools"));
    expect(container.textContent).toContain(i18n.t("desktop.update.download"));
  });
  it("says nothing extra otherwise", () => {
    render({ phase: "available", version: "0.9.6", size: 1 });
    expect(container.textContent).not.toContain(i18n.t("desktop.update.dropsDevTools"));
  });
});

describe("the Developer card", () => {
  let root: Root;
  let container: HTMLDivElement;
  afterEach(() => act(() => root.unmount()));
  const show = async (devTools: boolean) => {
    vi.unstubAllGlobals();
    const { panel, i18n: t } = await build(devTools);
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(createElement(panel.DeveloperSettings)));
    return t.t("desktop.dev.title");
  };

  it("shows in a dev-tools build, whatever the update channel", async () => {
    const title = await show(true);
    expect(container.querySelector("h2")?.textContent).toBe(title);
  });
  it("never shows in a release build", async () => {
    await show(false);
    expect(container.childElementCount).toBe(0);
  });
});
