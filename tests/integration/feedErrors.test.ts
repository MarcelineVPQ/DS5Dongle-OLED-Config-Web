// @vitest-environment jsdom
// A refused update feed is not "offline" (dev.10: a stale .sig read as
// "Are you online?" everywhere). The updater says why a check failed
// (network / unsigned / malformed) and every page that reports a check says
// it in those words: App settings' Check for updates, the setup screen, the
// firmware card (Latest and Check now), the Development channel dialog and
// the Games page's Proton install.
import { generateKeyPairSync, sign } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import type { DesktopApi, FeedProblem, FirmwareLookup, UpdateState } from "../../src/desktop/api";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";
import { FeedCache, FeedError, devChannelPreview } from "../../electron/main/updateFeed";
import { firmwareFeed, latestFirmware } from "../../electron/main/firmwareSource";
import SetupScreen from "../../src/desktop/SetupScreen";
import FirmwarePage from "../../src/desktop/pages/FirmwarePage";
import { CheckNow, DevChannelDialog } from "../../src/desktop/pages/AppSettingsPage";
import GamesPage from "../../src/desktop/pages/GamesPage";
import { GamesService } from "../../electron/main/games/service";
import { fakeBridge } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const net = vi.hoisted(() => ({ fetch: (async () => new Response("")) as (url: string) => Promise<Response> }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.0.1" },
  net: { fetch: (url: string) => net.fetch(url) },
}));

const FEED = "http://127.0.0.1:8765/latest.json";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signed = (text: string) => sign(null, Buffer.from(text), privateKey).toString("base64");
const GOOD = JSON.stringify({ app: { version: "0.0.1", platforms: {} } });

// The real Updater against a loopback test feed signed with a test key.
let Updater: typeof import("../../electron/main/updater").Updater;
beforeAll(async () => {
  process.env.DS5_UPDATE_MANIFEST = FEED;
  process.env.DS5_UPDATE_PUBKEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  ({ Updater } = await import("../../electron/main/updater"));
});

// Serves the feed and its .sig; `null` = the request fails (no network).
function serve(feed: string | null, sig: string | null) {
  net.fetch = async (url) => {
    const body = url.endsWith(".sig") ? sig : feed;
    if (body === null) throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    return new Response(body);
  };
}

describe("the updater says why a feed check failed", () => {
  const check = () => new Updater(() => undefined).check();

  it("no network: offline", async () => {
    serve(null, null);
    expect(await check()).toMatchObject({ phase: "failed", problem: "offline" });
  });

  it("a stale or missing signature: unsigned, not offline", async () => {
    serve(GOOD, signed(GOOD.replace("0.0.1", "0.0.2")));
    expect(await check()).toMatchObject({ phase: "failed", problem: "unsigned" });
    net.fetch = async (url) => (url.endsWith(".sig") ? new Response("", { status: 404 }) : new Response(GOOD));
    expect(await check()).toMatchObject({ phase: "failed", problem: "unsigned" });
  });

  it("signed but unreadable: malformed", async () => {
    serve("{not json", signed("{not json"));
    expect(await check()).toMatchObject({ phase: "failed", problem: "malformed" });
    const wrong = JSON.stringify({ app: 1 });
    serve(wrong, signed(wrong));
    expect(await check()).toMatchObject({ phase: "failed", problem: "malformed" });
  });

  it("a good feed still checks out", async () => {
    serve(GOOD, signed(GOOD));
    expect(await check()).toMatchObject({ phase: "up-to-date" });
  });
});

// The words each page shows, per problem.
const WORDS: Record<FeedProblem, { check: string; card: string; checked: string; join: string; proton: string }> = {
  offline: { check: "Are you online?", card: "can't check (offline)", checked: "can't be reached (offline?)", join: "Can't reach the development feed", proton: "Couldn't reach the update server" },
  unsigned: {
    check: "didn't pass its security check",
    card: "failed its security check",
    checked: "didn't pass its security check",
    join: "didn't pass its security check",
    proton: "didn't pass its security check",
  },
  malformed: { check: "couldn't be read", card: "couldn't be read", checked: "couldn't be read", join: "couldn't be read", proton: "couldn't be read" },
};
const failure = (problem: FeedProblem) => (problem === "offline" ? new Error("net::ERR_INTERNET_DISCONNECTED") : new FeedError(problem, "refused"));

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.desktop;
});

// The main process's real feed rules over a feed that fails with `problem`.
function fakeMain(problem: FeedProblem) {
  const feed = new FeedCache(async () => {
    throw failure(problem);
  });
  const lookup = (asked: boolean): Promise<FirmwareLookup> =>
    latestFirmware(
      {
        bundled: () => null,
        manifest: firmwareFeed(
          feed,
          () => true,
          () => "stable",
        ),
        freshFeed: (ch) => feed.get(ch, 0),
        download: async () => new Uint8Array(),
      },
      asked,
    );
  window.desktop = {
    checkForUpdates: async (): Promise<UpdateState> => ({ phase: "failed", detail: "x", problem }),
    latestFirmware: (asked = false) => lookup(asked),
    devChannelPreview: (asked: boolean) => devChannelPreview(feed, true, asked),
    usbAccessInstalled: async () => true,
  } as unknown as DesktopApi;
  return lookup;
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const text = () => container.textContent ?? "";

describe.each(["offline", "unsigned", "malformed"] as const)("a %s feed, on every page", (problem) => {
  const words = WORDS[problem];
  const notOffline = (s: string) => problem === "offline" || expect(s).not.toMatch(/online|offline/i);

  it("App settings → Check for updates", async () => {
    const lookup = fakeMain(problem);
    await act(async () => root.render(createElement(CheckNow, { firmwareInstalled: "v9.0.0-oled-edition", refreshFirmware: () => lookup(true) })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain(words.check);
    notOffline(text());
  });

  it("the setup screen's Check for updates", async () => {
    fakeMain(problem);
    await act(async () => root.render(createElement(SetupScreen, { supported: false })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain(words.check);
    notOffline(text());
  });

  it("the firmware card: Latest and Check now", async () => {
    const lookup = fakeMain(problem);
    const r = await lookup(true);
    expect(r.problem).toBe(problem);
    const fw = {
      latest: null,
      problem: r.problem,
      available: false,
      backToStable: false,
      state: { phase: "idle" },
      start: async () => undefined,
      refreshLatest: () => lookup(true),
      dismiss: () => undefined,
    } as FirmwareUpdate;
    const bridge = { client: null, firmwareVersion: "v9.0.0-oled-edition", identity: null } as unknown as UseDs5BridgeResult;
    await act(async () => root.render(createElement(FirmwarePage, { bridge, fw })));
    expect(text()).toContain(words.card);
    await act(async () => button("Check now").click());
    expect(text()).toContain(words.checked);
    notOffline(text());
  });

  it("the Development channel dialog", async () => {
    fakeMain(problem);
    await act(async () => root.render(createElement(DevChannelDialog, { automatic: true, onJoin: () => undefined, onCancel: () => undefined })));
    expect(text()).toContain(words.join);
    notOffline(text());
  });

  it("Games → Home: installing Proton (raw error text only in the log)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new GamesService({
      userData: mkdtempSync(join(tmpdir(), "ds5-feed-")),
      allowed: () => true,
      fetchManifest: () => Promise.reject(failure(problem)),
      download: () => Promise.reject(new Error("not reached")),
      onProtonProgress: () => undefined,
      notDetected: () => new Set(),
      hdrMarked: () => new Set(),
    });
    const report = homeReport("attention");
    report.ourProton = { ...report.ourProton, updateAvailable: true };
    const base = homeDesktop("attention", [], report);
    const overrides: Record<string, unknown> = { installProton: () => service.installLatestProton(), onProtonProgress: () => () => undefined };
    window.desktop = new Proxy(overrides, { get: (o, p: string) => (p in o ? o[p] : base[p]) }) as unknown as DesktopApi;
    await act(async () =>
      root.render(
        createElement(GamesPage, {
          allowed: true,
          onAllowedChange: () => undefined,
          bridge: fakeBridge(),
          profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
        }),
      ),
    );
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Install "))!.click());
    await act(async () => button("Download and install").click());
    expect(text()).toContain(words.proton);
    expect(text()).not.toContain("refused");
    expect(text()).not.toContain("ERR_INTERNET_DISCONNECTED");
    notOffline(text());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
