// Which firmware the app offers: the build bundled inside the app (every
// release ships with the firmware it was built and tested with, so a new
// dongle can be set up offline) or a newer one published in the update feed.
// The renderer never chooses; it asks for "the firmware" and gets the bytes,
// verified here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { FirmwareDownload, FirmwareLookup, LatestFirmware, UpdateChannel } from "../../src/desktop/api";
import { isNewer, type Download, type Manifest } from "../../src/update/manifest";
import { feedImages, fitsBoard, newestFor, PICO2_W_IMAGE, type BoardIdentity } from "../../src/update/boardIdentity";
import { CorruptDownloadError } from "./download";
import { KeyedError } from "../../src/errorText";
import { FEED_REUSE_MS, FeedMissingError, feedProblem, type FeedCache } from "./updateFeed";

export const FIRMWARE_MAX_BYTES = 8 * 1024 * 1024;

// resources/firmware/firmware.json, written by the release workflow.
const BundleInfo = z.object({
  version: z.string().max(64),
  file: z.string().regex(/^[\w.-]+\.uf2$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface Bundled {
  version: string;
  path: string;
  sha256: string;
}

export function readBundled(resourcesDir: string): Bundled | null {
  try {
    const dir = join(resourcesDir, "firmware");
    const info = BundleInfo.parse(JSON.parse(readFileSync(join(dir, "firmware.json"), "utf8")));
    return { version: info.version, path: join(dir, info.file), sha256: info.sha256 };
  } catch {
    // error: NOT-WORTH — development builds have no bundled firmware: the published one is used
    return null; // development builds have no bundled firmware
  }
}

export function loadBundled(b: Bundled): Uint8Array {
  const bytes = new Uint8Array(readFileSync(b.path));
  if (bytes.byteLength > FIRMWARE_MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== b.sha256) {
    throw new KeyedError("desktop.errors.main.bundledDamaged");
  }
  return bytes;
}

type Published = NonNullable<Manifest["firmware"]>;

// The published firmware only when it is strictly newer than the bundled one.
export function choose(bundled: Bundled | null, published: Published | null): "bundled" | "online" | null {
  if (published && (!bundled || isNewer(published.version, bundled.version))) return "online";
  return bundled ? "bundled" : null;
}

export interface FirmwareSourceDeps {
  bundled: () => Bundled | null;
  // The feed, or why there's none: "unpublished" (nothing released yet),
  // "offline", "unsigned" / "malformed" (the feed was refused), or "disabled"
  // (automatic checks are off and nobody asked).
  // `asked`: the user pressed a check button. See firmwareFeed().
  // error: SHOWN — desktop.firmware.offline (FirmwarePage: unpublished / offline under Latest, checkedNone / checkedOffline after Check now)
  manifest: (asked: boolean) => Promise<{ manifest: Manifest | null; problem: FirmwareLookup["problem"]; channel: UpdateChannel }>;
  // One channel's feed for Install (installFeed): the feed the offer came
  // from while it is fresh, else fetched again.
  freshFeed: (channel: UpdateChannel) => Promise<Manifest>;
  // Downloads one published file, verified against its own size + SHA-256.
  download: (uf2: Download) => Promise<Uint8Array>;
}

// The feed for the firmware lookups, under the "Check for updates
// automatically" switch: with it off, nothing goes online until the user asks
// (a check button); the last feed the user fetched is still shown.
export function firmwareFeed(feed: Pick<FeedCache, "get" | "last">, automatic: () => boolean, channel: () => UpdateChannel): FirmwareSourceDeps["manifest"] {
  return async (asked) => {
    const ch = channel();
    if (!asked && !automatic()) {
      const last = feed.last(ch);
      return { manifest: last, problem: last ? null : "disabled", channel: ch };
    }
    try {
      return { manifest: await feed.get(ch, FEED_REUSE_MS), problem: null, channel: ch };
    } catch (cause) {
      // error: SHOWN — desktop.firmware.offline / .unsigned / .malformed (problem on the Firmware card; the last feed verified answers when there's one)
      if (cause instanceof FeedMissingError) return { manifest: null, problem: "unpublished", channel: ch };
      // The last one verified for this channel, if any.
      const last = feed.last(ch);
      return last ? { manifest: last, problem: null, channel: ch } : { manifest: null, problem: feedProblem(cause), channel: ch };
    }
  };
}

// The feed Install downloads from: the very feed the offer came from while it
// is under FEED_REUSE_MS old (Check now, then Install: no second fetch), else
// that channel's feed fetched again, so an older offer is checked against the
// feed as it is now. Never another channel's (firmwareBytes asks for the
// channel the offer names).
export const installFeed =
  (feed: Pick<FeedCache, "get">): FirmwareSourceDeps["freshFeed"] =>
  (channel) =>
    feed.get(channel, FEED_REUSE_MS);

// Only an image built for `board` (DESIGN_FIRMWARE_IDENTITY §2): the newest
// feed entry for it, or the bundled build (the Pico 2 W image) when that board
// is a Pico 2 W. A feed with images, none for this board: "noBoardImage",
// never another board's image.
export async function latestFirmware(deps: FirmwareSourceDeps, board: BoardIdentity, asked = false): Promise<FirmwareLookup> {
  const bundled = fitsBoard(PICO2_W_IMAGE, board) ? deps.bundled() : null;
  const { manifest, problem, channel } = await deps.manifest(asked);
  const images = manifest ? feedImages(manifest) : [];
  const published = newestFor(images, board);
  const source = choose(bundled, published);
  const newestStable = manifest?.newest_stable;
  if (source === "online")
    return { latest: { version: published!.version, notesUrl: published!.notes_url, source, sha256: published!.uf2.sha256, channel, board: board.board, newestStable }, problem: null };
  if (source === "bundled") return { latest: { version: bundled!.version, source, board: board.board, newestStable }, problem };
  return { latest: null, problem: problem ?? (images.length > 0 ? "noBoardImage" : "unpublished") };
}

// The firmware the user was shown and confirmed, nothing else: the bundled
// build, or exactly that feed entry (version + SHA-256, from that channel's
// feed). If the feed has moved on since, nothing is downloaded; the user
// checks again and sees the new offer first.
export async function firmwareBytes(deps: FirmwareSourceDeps, shown: LatestFirmware): Promise<FirmwareDownload> {
  if (shown.source === "bundled") {
    const bundled = deps.bundled();
    if (!bundled || bundled.version !== shown.version || shown.board !== PICO2_W_IMAGE.board) return { ok: false, reason: "changed" };
    return { ok: true, version: bundled.version, bytes: loadBundled(bundled) };
  }
  if (!shown.sha256 || !shown.channel) return { ok: false, reason: "changed" };
  // loop: NOT-WORTH — N ≤ 32 feed images, once per Install
  const fw = feedImages(await deps.freshFeed(shown.channel)).find((image) => image.board === shown.board && image.version === shown.version && image.uf2.sha256 === shown.sha256);
  if (!fw) return { ok: false, reason: "changed" };
  let bytes: Uint8Array;
  try {
    bytes = await deps.download(fw.uf2);
  } catch (cause) {
    if (cause instanceof CorruptDownloadError) return { ok: false, reason: "mismatch" };
    throw cause;
  }
  // Checked again against the entry shown, whatever the download did.
  if (createHash("sha256").update(bytes).digest("hex") !== shown.sha256) return { ok: false, reason: "mismatch" };
  return { ok: true, version: shown.version, bytes };
}
