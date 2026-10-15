import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { choose, firmwareBytes, firmwareFeed, installFeed, latestFirmware, readBundled, type FirmwareSourceDeps } from "../../electron/main/firmwareSource";
import { CorruptDownloadError } from "../../electron/main/download";
import { FEED_REUSE_MS, FeedCache } from "../../electron/main/updateFeed";
import type { UpdateChannel } from "../../src/desktop/api";
import { Manifest, type Download } from "../../src/update/manifest";

let res: string;
const uf2 = new Uint8Array([1, 2, 3, 4]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function bundle(version: string, hash = sha(uf2)) {
  mkdirSync(join(res, "firmware"), { recursive: true });
  writeFileSync(join(res, "firmware/ds5-bridge-oled.uf2"), uf2);
  writeFileSync(join(res, "firmware/firmware.json"), JSON.stringify({ version, file: "ds5-bridge-oled.uf2", sha256: hash }));
}

const fwBytes = new Uint8Array([9]);
const published = (version: string, bytes = fwBytes, url = "https://github.com/x/fw.uf2") => ({ version, notes_url: "https://github.com/x", uf2: { url, size: bytes.byteLength, sha256: sha(bytes) } });
type Pub = ReturnType<typeof published>;
const feedOf = (pub: Pub | null) => Manifest.parse({ channel: "stable", app: { version: "0.8.0", platforms: {} }, ...(pub ? { firmware: pub } : {}) });
const deps = (pub: Pub | null): FirmwareSourceDeps => ({
  bundled: () => readBundled(res),
  manifest: async () => (pub ? { manifest: feedOf(pub), problem: null, channel: "stable" } : { manifest: null, problem: "offline" as const, channel: "stable" }),
  freshFeed: async () => feedOf(pub),
  download: async () => fwBytes,
});

beforeEach(() => {
  res = mkdtempSync(join(tmpdir(), "ds5-fw-"));
});
afterEach(() => rmSync(res, { recursive: true, force: true }));

describe("firmware source", () => {
  it("uses the bundled firmware offline, and when the published one isn't newer", async () => {
    bundle("v0.8.0-oled-edition");
    expect(await latestFirmware(deps(null))).toEqual({ latest: { version: "v0.8.0-oled-edition", source: "bundled" }, problem: "offline" });
    const shown = (await latestFirmware(deps(published("v0.8.0-oled-edition")))).latest!;
    expect(await firmwareBytes(deps(published("v0.8.0-oled-edition")), shown)).toEqual({ ok: true, version: "v0.8.0-oled-edition", bytes: uf2 });
    expect(choose(readBundled(res), published("v0.7.0-oled-edition"))).toBe("bundled");
  });

  it("prefers a strictly newer published firmware", async () => {
    bundle("v0.8.0-oled-edition");
    const shown = (await latestFirmware(deps(published("v0.8.1-oled-edition")))).latest!;
    expect(shown).toMatchObject({ source: "online", sha256: sha(fwBytes), channel: "stable" });
    expect(await firmwareBytes(deps(published("v0.8.1-oled-edition")), shown)).toEqual({ ok: true, version: "v0.8.1-oled-edition", bytes: fwBytes });
  });

  it("falls back to the feed when nothing is bundled (builds from source)", async () => {
    expect(readBundled(res)).toBeNull();
    expect((await latestFirmware(deps(published("v0.8.0-oled-edition")))).latest?.source).toBe("online");
    expect(await latestFirmware(deps(null))).toEqual({ latest: null, problem: "offline" });
  });

  it("refuses a damaged bundled file", async () => {
    bundle("v0.8.0-oled-edition", "f".repeat(64));
    await expect(firmwareBytes(deps(null), { version: "v0.8.0-oled-edition", source: "bundled" })).rejects.toThrow(/desktop\.errors\.main\.bundledDamaged/);
  });

  it("ignores a malformed bundle description", () => {
    mkdirSync(join(res, "firmware"), { recursive: true });
    writeFileSync(join(res, "firmware/firmware.json"), JSON.stringify({ version: "x", file: "../../etc/passwd", sha256: "a".repeat(64) }));
    expect(readBundled(res)).toBeNull();
  });
});

// Install takes exactly the entry the user was shown and confirmed, never the
// feed of an earlier check or of the other channel (cache pass, Batch 1).
describe("installing the firmware shown", () => {
  const v1 = published("v0.9.0-oled-edition", new Uint8Array([1, 1]), "https://github.com/x/stable.uf2");
  const dev = published("v0.9.1-dev.2-oled-edition", new Uint8Array([2, 2]), "https://github.com/x/dev.uf2");
  const feeds: Record<UpdateChannel, Pub | null> = { stable: v1, dev };
  const live = (overrides: Partial<Record<UpdateChannel, Pub | null>> = {}, bytes?: Uint8Array) => {
    const now = { ...feeds, ...overrides };
    const download = vi.fn(async (uf2: { url: string }) => bytes ?? (uf2.url.endsWith("dev.uf2") ? new Uint8Array([2, 2]) : new Uint8Array([1, 1])));
    const freshFeed = vi.fn(async (ch: UpdateChannel) => feedOf(now[ch]));
    return {
      download,
      freshFeed,
      deps: (channel: UpdateChannel): FirmwareSourceDeps => ({ bundled: () => null, manifest: async () => ({ manifest: feedOf(now[channel]), problem: null, channel }), freshFeed, download }),
    };
  };

  it("after a channel switch, Install downloads the entry shown (from its own channel's feed)", async () => {
    const f = live();
    const shown = (await latestFirmware(f.deps("dev"))).latest!;
    expect(shown).toMatchObject({ version: dev.version, channel: "dev" });
    // The setting is back on Stable by the time Install is pressed.
    const r = await firmwareBytes(f.deps("stable"), shown);
    expect(r).toEqual({ ok: true, version: dev.version, bytes: new Uint8Array([2, 2]) });
    expect(f.freshFeed).toHaveBeenCalledWith("dev");
    expect(f.download).toHaveBeenCalledWith(dev.uf2);
  });

  it("refuses when the feed changed since (a stale offer can't be installed)", async () => {
    const f0 = live();
    const shown = (await latestFirmware(f0.deps("stable"))).latest!;
    const newer = published("v0.9.2-oled-edition", new Uint8Array([3]), "https://github.com/x/new.uf2");
    const f = live({ stable: newer });
    expect(await firmwareBytes(f.deps("stable"), shown)).toEqual({ ok: false, reason: "changed" });
    expect(f.download).not.toHaveBeenCalled();
    // Same version, rebuilt (another hash): also refused.
    const rebuilt = live({ stable: published(v1.version, new Uint8Array([7, 7])) });
    expect(await firmwareBytes(rebuilt.deps("stable"), shown)).toEqual({ ok: false, reason: "changed" });
    expect(rebuilt.download).not.toHaveBeenCalled();
    // An online entry without its hash/channel is never trusted.
    expect(await firmwareBytes(f0.deps("stable"), { version: v1.version, source: "online" })).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses a file whose hash doesn't match the entry shown", async () => {
    const f = live({}, new Uint8Array([6, 6]));
    const shown = (await latestFirmware(f.deps("stable"))).latest!;
    expect(await firmwareBytes(f.deps("stable"), shown)).toEqual({ ok: false, reason: "mismatch" });
    // The verified download's own checksum failure is the same answer.
    const corrupt = live();
    corrupt.download.mockRejectedValueOnce(new CorruptDownloadError());
    expect(await firmwareBytes(corrupt.deps("stable"), shown)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("a bundled offer installs the bundled build, without going online", async () => {
    bundle("v0.8.0-oled-edition");
    const f = live();
    const r = await firmwareBytes({ ...f.deps("stable"), bundled: () => readBundled(res) }, { version: "v0.8.0-oled-edition", source: "bundled" });
    expect(r).toEqual({ ok: true, version: "v0.8.0-oled-edition", bytes: uf2 });
    expect(f.freshFeed).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
  });
});

// "Check for updates automatically" off: the firmware lookups never go online
// unless the user asks; on: one fetch serves the whole check.
describe("the firmware feed under the automatic-checks switch", () => {
  const manifest = feedOf(published("v0.9.0-oled-edition"));

  it("off: no fetch without a click; a click fetches; the result is kept for later lookups", async () => {
    const net = vi.fn(async () => manifest);
    const feed = new FeedCache(net);
    const lookup = firmwareFeed(
      feed,
      () => false,
      () => "stable",
    );
    expect(await lookup(false)).toEqual({ manifest: null, problem: "disabled", channel: "stable" });
    expect(net).not.toHaveBeenCalled();
    expect((await lookup(true)).manifest).toEqual(manifest);
    expect(net).toHaveBeenCalledOnce();
    expect((await lookup(false)).manifest).toEqual(manifest);
    expect(net).toHaveBeenCalledOnce();
  });

  it("on: lookups during and right after a check share its one fetch", async () => {
    const net = vi.fn(async () => manifest);
    const feed = new FeedCache(net);
    const lookup = firmwareFeed(
      feed,
      () => true,
      () => "stable",
    );
    const check = feed.get("stable", 0); // the update check
    await Promise.all([lookup(false), lookup(false), check]);
    await lookup(false);
    expect(net).toHaveBeenCalledOnce();
  });

  it("offline falls back to the last feed of the same channel only", async () => {
    let fail = false;
    const net = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return manifest;
    });
    const feed = new FeedCache(net, () => 0);
    let channel: UpdateChannel = "stable";
    const lookup = firmwareFeed(
      feed,
      () => true,
      () => channel,
    );
    await feed.get("stable", 0);
    fail = true;
    channel = "dev";
    expect(await lookup(true)).toEqual({ manifest: null, problem: "offline", channel: "dev" });
    channel = "stable";
    expect((await lookup(true)).manifest).toEqual(manifest);
  });

  // Cache pass batch 1: Install downloads from the feed the offer came from.
  it("Install right after the offer downloads that very feed's entry, without fetching again", async () => {
    let now = 0;
    let pub = published("v0.9.0-oled-edition");
    const net = vi.fn(async (ch: UpdateChannel) => Manifest.parse({ channel: ch, app: { version: "0.8.0", platforms: {} }, firmware: pub }));
    const feed = new FeedCache(net, () => now);
    const download = vi.fn(async (_uf2: Download) => fwBytes);
    const d: FirmwareSourceDeps = {
      bundled: () => null,
      manifest: firmwareFeed(
        feed,
        () => false,
        () => "stable",
      ),
      freshFeed: installFeed(feed),
      download,
    };
    const offer = await latestFirmware(d, true); // Check now
    const offered = await net.mock.results[0].value;
    now = FEED_REUSE_MS - 1;
    expect(await firmwareBytes(d, offer.latest!)).toMatchObject({ ok: true, version: "v0.9.0-oled-edition" });
    expect(net).toHaveBeenCalledOnce();
    expect(download.mock.calls[0][0]).toBe(offered.firmware.uf2); // the same feed object, not a refetch
    // An older offer is checked against the feed as it is now (never installed from a stale one).
    now = FEED_REUSE_MS * 3;
    pub = published("v0.9.1-oled-edition", new Uint8Array([7]));
    expect(await firmwareBytes(d, offer.latest!)).toEqual({ ok: false, reason: "changed" });
    expect(net).toHaveBeenCalledTimes(2);
    expect(net).toHaveBeenLastCalledWith("stable");
  });
});
