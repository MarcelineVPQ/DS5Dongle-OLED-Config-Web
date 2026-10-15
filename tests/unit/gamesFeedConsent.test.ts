// Owner decision (2026-10-15): with "Check for updates automatically" off the
// app fetches nothing at startup, the Games scan's Proton lookup included (the
// rail's background scan runs at startup once Games is allowed). With it on,
// the scan shares the update check's one fetch. Installing Proton (the user
// pressed it) fetches. Wired as index.ts wires it, over a fake network.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedCache, protonFeed } from "../../electron/main/updateFeed";
import { firmwareFeed } from "../../electron/main/firmwareSource";
import { GamesService } from "../../electron/main/games/service";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import type { UpdateChannel } from "../../src/desktop/api";
import { Manifest } from "../../src/update/manifest";
import { asLinux } from "../support/platform";

asLinux();

let home: string;
let realHome: string | undefined;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-feed-consent-")));
  realHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const feedFor = (ch: UpdateChannel) =>
  Manifest.parse({
    channel: ch,
    app: { version: "9.9.9", platforms: {} },
    proton: { name: "GE-Proton11-7.2-DualSense", tarball: { url: "https://github.com/x/p.tar.gz", size: 1, sha256: "a".repeat(64) } },
  });

function service(automatic: boolean) {
  const net = vi.fn(async (ch: UpdateChannel) => feedFor(ch)); // the feed + .sig
  const feed = new FeedCache(net);
  const games = new GamesService({
    userData: join(home, "userdata"),
    allowed: () => true,
    fetchManifest: protonFeed(
      feed,
      firmwareFeed(
        feed,
        () => automatic,
        () => "stable",
      ),
    ),
    download: () => Promise.reject(new Error("not reached")),
    onProtonProgress: () => undefined,
    notDetected: () => new Set(),
    hdrMarked: () => new Set(),
    launchers: { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true },
    probes: { audioCards: async () => [], hdr: async () => NO_HDR_SYSTEM },
  });
  return { net, feed, games };
}

describe("the Games scan's Proton lookup", () => {
  it("automatic checks off: scans never reach the network; Install does", async () => {
    const { net, games } = service(false);
    await games.scan(); // the rail's background scan at startup
    await games.scan(); // the Games page opened
    expect(net).not.toHaveBeenCalled();
    await games.installLatestProton(); // no launcher here: fails after the feed, which is the point
    expect(net).toHaveBeenCalledExactlyOnceWith("stable");
  });

  it("automatic checks on: the scan shares the update check's one fetch", async () => {
    const { net, feed, games } = service(true);
    await Promise.all([feed.get("stable", 0), games.scan()]); // the check and the startup scan
    await games.scan();
    expect(net).toHaveBeenCalledOnce();
  });
});
