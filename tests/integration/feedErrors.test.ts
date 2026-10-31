// @vitest-environment jsdom
// A refused update feed is not "offline" (dev.10: a stale .sig read as
// "Are you online?" everywhere), and neither is a server's HTTP error or an
// error inside the app (pre-release review: no "offline?" guesses). The
// updater says why a check failed (no answer / rate-limited / HTTP status /
// unsigned / malformed) and every page that reports a check says it in those words: App settings' Check for updates, the setup screen, the
// Firmware section (Latest and Check for updates), the Development channel dialog and
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
import { keyedText } from "../../src/errorText";
import { firmwareFeed, latestFirmware } from "../../electron/main/firmwareSource";
import { PICO2_W } from "../../src/update/boardIdentity";
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
const GOOD = JSON.stringify({ channel: "stable", app: { version: "0.0.1", platforms: {} } });

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

  it("the server answered with an HTTP error: its status (or rate-limited), never offline", async () => {
    for (const [status, problem] of [
      [403, "http403"],
      [503, "http503"],
      [429, "rateLimited"],
    ] as const) {
      net.fetch = async () => new Response("", { status });
      expect(await check()).toMatchObject({ phase: "failed", problem });
    }
    // A server error on the .sig is the server's, not a refused signature.
    net.fetch = async (url) => (url.endsWith(".sig") ? new Response("", { status: 503 }) : new Response(GOOD));
    expect(await check()).toMatchObject({ phase: "failed", problem: "http503" });
  });

  it("a good feed still checks out", async () => {
    serve(GOOD, signed(GOOD));
    expect(await check()).toMatchObject({ phase: "up-to-date" });
  });
});

// The words each page shows, per problem.
const WORDS: Record<FeedProblem, { check: string; card: string; checked: string; join: string; proton: string }> = {
  offline: {
    check: "the update server didn't answer",
    card: "can't check (the update server didn't answer)",
    checked: "Couldn't check: the update server didn't answer",
    join: "The development feed's server didn't answer",
    proton: "Couldn't reach the update server",
  },
  rateLimited: { check: "limiting requests", card: "limiting requests", checked: "limiting requests", join: "limiting requests", proton: "limiting requests" },
  http503: { check: "(HTTP 503)", card: "answered HTTP 503", checked: "(HTTP 503)", join: "(HTTP 503)", proton: "(HTTP 503)" },
  internal: { check: "failed inside the app", card: "an error inside the app", checked: "failed inside the app", join: "failed inside the app", proton: "failed inside the app" },
  unsigned: {
    check: "didn't pass its security check",
    card: "failed its security check",
    checked: "didn't pass its security check",
    join: "didn't pass its security check",
    proton: "didn't pass its security check",
  },
  malformed: { check: "couldn't be read", card: "couldn't be read", checked: "couldn't be read", join: "couldn't be read", proton: "couldn't be read" },
  wrongChannel: {
    check: "carried another channel's builds",
    card: "carried another channel's builds",
    checked: "carried another channel's builds",
    join: "carried another channel's builds",
    proton: "carried another channel's builds",
  },
  olderFeed: { check: "older than one", card: "older than one", checked: "older than one", join: "older than one", proton: "older than one" },
};
const failure = (problem: FeedProblem) => (problem === "offline" ? new Error("net::ERR_INTERNET_DISCONNECTED") : new FeedError(problem, "raw feed error"));

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
      PICO2_W,
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

describe.each(["offline", "rateLimited", "http503", "unsigned", "malformed", "wrongChannel", "olderFeed"] as const)("a %s feed, on every page", (problem) => {
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

  it("the firmware card: Latest and Check for updates", async () => {
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
    await act(async () => button("Check for updates").click());
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
    // DualSense Proton's section (it carries the update's dot), opened unless it's open already.
    const head = container.querySelector<HTMLButtonElement>('[data-section="proton"] .dk-sec-toggle')!;
    if (head.getAttribute("aria-expanded") !== "true") await act(async () => head.click());
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Install "))!.click());
    await act(async () => button("Download and install").click());
    expect(text()).toContain(words.proton);
    expect(text()).not.toContain("raw feed error");
    expect(text()).not.toContain("ERR_INTERNET_DISCONNECTED");
    notOffline(text());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// The page's call into the app itself failed (IPC): an error inside the app,
// never "offline" (it was read as offline before the pre-release review).
describe("the app's own call fails", () => {
  it("App settings, the setup screen and the Development channel dialog say so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reject = () => Promise.reject(new Error("Error invoking remote method: BAD_REQUEST"));
    window.desktop = { checkForUpdates: reject, latestFirmware: reject, devChannelPreview: reject, usbAccessInstalled: async () => true } as unknown as DesktopApi;
    await act(async () => root.render(createElement(CheckNow, { firmwareInstalled: null, refreshFirmware: async () => ({ latest: null, problem: null }) })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain(WORDS.internal.check);
    expect(text()).not.toMatch(/online|offline/i);
    await act(async () => root.render(createElement(SetupScreen, { supported: false })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain(WORDS.internal.check);
    expect(text()).not.toMatch(/online|offline/i);
    await act(async () => root.render(createElement(DevChannelDialog, { automatic: true, onJoin: () => undefined, onCancel: () => undefined })));
    expect(text()).toContain(WORDS.internal.join);
    expect(text()).not.toMatch(/online|offline/i);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// Bug hunt A9 (0.9.5): a newer version with no build for this system (macOS
// before its build is published) read as "Are you online?", with an English detail.
describe("a newer version with no build for this system", () => {
  const NEWER = JSON.stringify({ channel: "stable", app: { version: "0.0.2", platforms: {} } });

  it("the check says so (keyed), and App settings and the setup screen show it, not 'online'", async () => {
    serve(NEWER, signed(NEWER));
    const state = await new Updater(() => undefined).check();
    expect(state).toEqual({ phase: "failed", detail: keyedText("desktop.updateFeed.noBuild"), problem: "noBuild" });
    window.desktop = { checkForUpdates: async () => state, latestFirmware: async () => ({ latest: null, problem: null }), usbAccessInstalled: async () => true } as unknown as DesktopApi;
    await act(async () => root.render(createElement(CheckNow, { firmwareInstalled: null, refreshFirmware: async () => ({ latest: null, problem: null }) })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain("no build of it for this system yet");
    expect(text()).not.toMatch(/online/i);
    await act(async () => root.render(createElement(SetupScreen, { supported: false })));
    await act(async () => button("Check for updates").click());
    expect(text()).toContain("no build of it for this system yet");
  });
});
