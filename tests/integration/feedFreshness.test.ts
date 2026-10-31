// @vitest-environment jsdom
// Feed channel binding and freshness (review S1, DESIGN_FIRMWARE_IDENTITY §2
// and §3, step 3): a signed feed is used only when it is the channel the app
// asked for and no older than one already verified on that channel (feed
// against feed, no expiry); Back to stable installs only newest_stable.
// Schema 1 feeds (today's, no issued_at) keep working until republished.
import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { keyedText } from "../../src/errorText";
import { Manifest } from "../../src/update/manifest";
import { feedProblemText } from "../../src/desktop/useUpdates";
import { FeedError, checkFeed, feedSeenInMemory } from "../../electron/main/updateFeed";

const net = vi.hoisted(() => ({ fetch: (async () => new Response("")) as (url: string) => Promise<Response> }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.9.6-dev.2", releaseSingleInstanceLock: () => undefined, getPath: () => "/nonexistent" },
  net: { fetch: (url: string) => net.fetch(url) },
}));

const FEED = "http://127.0.0.1:8765/latest.json";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signed = (t: string) => sign(null, Buffer.from(t), privateKey).toString("base64");
const dl = (v: string) => ({ url: `http://127.0.0.1:8765/DS5Dongle-OLED-Edition-Configurator-${v}-linux-x86_64.AppImage`, size: 10, sha256: "0".repeat(64) });
const T1 = "2026-11-02T18:04:11Z";
const T2 = "2026-11-03T09:00:00Z";

// A feed for `channel`: schema 2 when `issuedAt` is given, else schema 1.
function feed(channel: string, version: string, issuedAt?: string, newestStable = "0.9.5"): string {
  const v2 = issuedAt ? { schema: 2, issued_at: issuedAt, newest_stable: newestStable } : {};
  return JSON.stringify({ ...v2, channel, app: { version, platforms: { linux: dl(version) } } });
}
// Serves `body` (and its signature) for every request.
function serve(body: string) {
  net.fetch = async (url) => new Response(url.endsWith(".sig") ? signed(body) : body);
}

let Updater: typeof import("../../electron/main/updater").Updater;
const saved = { appimage: process.env.APPIMAGE, platform: process.platform };
beforeAll(async () => {
  process.env.DS5_UPDATE_MANIFEST = FEED;
  process.env.DS5_UPDATE_PUBKEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  // A Linux AppImage that can replace itself, so a check can answer "available".
  Object.defineProperty(process, "platform", { value: "linux" });
  process.env.APPIMAGE = "/nonexistent/x.AppImage";
  ({ Updater } = await import("../../electron/main/updater"));
  await i18n.changeLanguage("en");
});
afterAll(() => {
  Object.defineProperty(process, "platform", { value: saved.platform });
  if (saved.appimage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = saved.appimage;
});

const parsed = (text: string) => Manifest.parse(JSON.parse(text));
const problemOf = (run: () => unknown) => {
  try {
    run();
  } catch (cause) {
    return cause instanceof FeedError ? cause.problem : "not a FeedError";
  }
  return null;
};

describe("checkFeed: the rule", () => {
  it("refuses another channel's feed (its own reason, not offline)", () => {
    expect(problemOf(() => checkFeed(parsed(feed("dev", "0.9.6-dev.3")), "stable", undefined))).toBe("wrongChannel");
    expect(problemOf(() => checkFeed(parsed(feed("stable", "0.9.5", T1)), "dev", T1))).toBe("wrongChannel");
  });

  it("remembers the first issued_at seen, then only a newer one", () => {
    expect(checkFeed(parsed(feed("stable", "0.9.5", T1)), "stable", undefined)).toBe(T1);
    expect(checkFeed(parsed(feed("stable", "0.9.5", T2)), "stable", T1)).toBe(T2);
  });

  it("accepts the same issued_at again (an unchanged feed)", () => {
    expect(checkFeed(parsed(feed("stable", "0.9.5", T1)), "stable", T1)).toBe(T1);
  });

  it("refuses a feed older than one already verified", () => {
    expect(problemOf(() => checkFeed(parsed(feed("stable", "0.9.5", T1)), "stable", T2))).toBe("olderFeed");
  });

  it("schema 1 (no issued_at) is accepted while nothing newer was seen; after a schema 2 feed it is an older copy", () => {
    expect(checkFeed(parsed(feed("stable", "0.9.4")), "stable", undefined)).toBeUndefined();
    expect(problemOf(() => checkFeed(parsed(feed("stable", "0.9.4")), "stable", T1))).toBe("olderFeed");
  });
});

describe("the feed schema", () => {
  it("requires channel, and issued_at + newest_stable from schema 2", () => {
    expect(Manifest.safeParse({ app: { version: "0.9.5", platforms: {} } }).success).toBe(false);
    expect(Manifest.safeParse({ channel: "stable", app: { version: "0.9.5", platforms: {} } }).success).toBe(true);
    expect(Manifest.safeParse({ schema: 2, channel: "stable", newest_stable: "0.9.5", app: { version: "0.9.5", platforms: {} } }).success).toBe(false);
    expect(Manifest.safeParse({ schema: 2, channel: "stable", issued_at: "yesterday", newest_stable: "0.9.5", app: { version: "0.9.5", platforms: {} } }).success).toBe(false);
    expect(parsed(feed("stable", "0.9.5", T1))).toMatchObject({ schema: 2, issued_at: T1, newest_stable: "0.9.5" });
  });
});

describe("the updater", () => {
  it("stores the first issued_at seen per channel, and refuses an older copy afterwards", async () => {
    const seen = feedSeenInMemory();
    const u = new Updater(
      () => undefined,
      () => "dev",
      seen,
    );
    serve(feed("dev", "0.9.6-dev.3", T2));
    expect(await u.check()).toMatchObject({ phase: "available", version: "0.9.6-dev.3" });
    expect(seen.get("dev")).toBe(T2);
    expect(seen.get("stable")).toBeUndefined();
    serve(feed("dev", "0.9.6-dev.3", T1));
    expect(await u.check()).toMatchObject({ phase: "failed", problem: "olderFeed" });
    expect(seen.get("dev")).toBe(T2);
    serve(feed("dev", "0.9.6-dev.3", T2));
    expect(await u.check()).toMatchObject({ phase: "available" });
  });

  it("refuses a feed for another channel", async () => {
    serve(feed("stable", "0.9.7"));
    const u = new Updater(
      () => undefined,
      () => "dev",
    );
    expect(await u.check()).toMatchObject({ phase: "failed", problem: "wrongChannel" });
  });

  it("still accepts today's schema 1 feeds", async () => {
    serve(feed("dev", "0.9.6-dev.3"));
    const u = new Updater(
      () => undefined,
      () => "dev",
    );
    expect(await u.check()).toMatchObject({ phase: "available", version: "0.9.6-dev.3" });
  });

  it("Back to stable installs newest_stable, and only when the stable feed's version is it", async () => {
    serve(feed("stable", "0.9.5", T1, "0.9.5"));
    const ok = new Updater(() => undefined);
    expect(await ok.backToStable()).toMatchObject({ phase: "available", version: "0.9.5" });
    serve(feed("stable", "0.9.4", T1, "0.9.5"));
    const behind = new Updater(() => undefined);
    expect(await behind.backToStable()).toEqual({ phase: "failed", detail: keyedText("desktop.updateFeed.stableMismatch"), problem: "stableMismatch" });
  });

  it("Back to stable with a schema 1 feed: the stable feed's version, as before", async () => {
    serve(feed("stable", "0.9.4"));
    const u = new Updater(() => undefined);
    expect(await u.backToStable()).toMatchObject({ phase: "available", version: "0.9.4" });
  });
});

describe("each refusal's words", () => {
  const t = i18n.getFixedT("en");
  it.each([
    ["wrongChannel", "desktop.updateFeed.wrongChannel", "carried another channel's builds"],
    ["olderFeed", "desktop.updateFeed.olderFeed", "older than one this app already checked"],
    ["stableMismatch", "desktop.updateFeed.stableMismatch", "doesn't match the newest stable release"],
  ] as const)("%s says %s", (problem, key, words) => {
    const text = feedProblemText(t, problem, "desktop.setup.checkFailed");
    expect(text).toBe(t(key));
    expect(text).toContain(words);
    expect(text).not.toMatch(/online|offline|dongle/i);
    for (const lng of ["de", "es", "fr", "ja", "pt-BR", "zh-CN"]) expect(i18n.getFixedT(lng)(key), `${lng} ${key}`).not.toBe(t(key));
  });
});
