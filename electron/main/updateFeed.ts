// The update feed (latest.json / latest-dev.json), fetched once and shared:
// the app's update check, the firmware card and the setup screen all ask
// here, so one check is one fetch of the feed and its .sig. No electron
// import, so the rules are tested (tests/unit/firmwareSource.test.ts,
// tests/integration/updateConsent.test.ts).
import type { DevChannelAnswer, FeedProblem, UpdateChannel } from "../../src/desktop/api";
import type { Manifest } from "../../src/update/manifest";

// A feed fetched this recently is reused by the firmware lookups (the update
// check itself always fetches, sharing a fetch that is already running).
export const FEED_REUSE_MS = 60_000;

// The feed isn't there (yet): no release has been published. Not a network error.
export class FeedMissingError extends Error {
  constructor() {
    super("No release has been published yet.");
  }
}

// Why a fetched feed was refused, so the page can say what really happened
// (a stale signature is not "offline"). See FeedProblem.
export class FeedError extends Error {
  constructor(
    readonly problem: FeedProblem,
    message: string,
  ) {
    super(message);
  }
}

// The kind of a feed failure: a refused feed says so; anything else (a
// network error, a timeout) means the server couldn't be reached.
export function feedProblem(cause: unknown): FeedProblem {
  return cause instanceof FeedError ? cause.problem : "offline";
}

// The server answered with an HTTP error: rate-limited (429) or its status,
// never "offline" (the network worked).
export function httpProblem(status: number): FeedProblem {
  return status === 429 ? "rateLimited" : `http${status}`;
}

export class FeedCache {
  // cache: OK — key=channel; invalidated=FEED_REUSE_MS for lookups, every update check refetches, a failed fetch is dropped; bound=1 in flight
  private inflight: { channel: UpdateChannel; promise: Promise<Manifest> } | null = null;
  // cache: OK — key=channel (checked on read); invalidated=replaced by the next good fetch; bound=1 entry (the last verified feed, the offline fallback)
  private verified: { channel: UpdateChannel; at: number; manifest: Manifest } | null = null;

  constructor(
    private readonly fetch: (channel: UpdateChannel) => Promise<Manifest>,
    private readonly now: () => number = Date.now,
  ) {}

  // The feed of `channel`: one already in flight, one verified under
  // `maxAgeMs` ago, or a fresh fetch.
  get(channel: UpdateChannel, maxAgeMs: number): Promise<Manifest> {
    if (this.inflight?.channel === channel) return this.inflight.promise;
    const v = this.verified;
    if (v && v.channel === channel && this.now() - v.at < maxAgeMs) return Promise.resolve(v.manifest);
    // error: PASSES-ON — returned to get()'s caller (check(), firmwareFeed(), devChannelPreview() each have the verdict)
    const promise = this.fetch(channel)
      .then((manifest) => {
        this.verified = { channel, at: this.now(), manifest };
        return manifest;
      })
      .finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
    this.inflight = { channel, promise };
    return promise;
  }

  // The last verified feed of `channel`, without going online (never another channel's).
  last(channel: UpdateChannel): Manifest | null {
    return this.verified?.channel === channel ? this.verified.manifest : null;
  }
}

// The Proton build's feed for the Games page. A scan (asked = false) asks
// `lookup`, the firmware lookups' rules under the "Check for updates
// automatically" switch (firmwareFeed): with it off it never goes online (only
// the last feed the user fetched, or none), with it on it shares the check's
// fetch. Install (asked = true, the user pressed it) fetches.
export function protonFeed(feed: Pick<FeedCache, "get">, lookup: (asked: boolean) => Promise<{ manifest: Manifest | null; channel: UpdateChannel }>): (asked: boolean) => Promise<Manifest | null> {
  return async (asked) => {
    const { manifest, channel } = await lookup(false);
    return asked ? feed.get(channel, 0) : manifest;
  };
}

// What's in the newest development build, for the join dialog. With
// automatic checks off, only once the user presses the dialog's check button.
export async function devChannelPreview(feed: Pick<FeedCache, "get">, automatic: boolean, asked: boolean): Promise<DevChannelAnswer> {
  if (!asked && !automatic) return null;
  try {
    const m = await feed.get("dev", FEED_REUSE_MS);
    return { app: m.app.version, firmware: m.firmware?.version ?? null, notes: m.app.notes ?? null, notesUrl: m.app.notes_url ?? null };
  } catch (cause) {
    // error: SHOWN — desktop.channel.joinOffline (offline), desktop.channel.joinUnpublished, desktop.updateFeed.unsigned / .malformed (the problem says which)
    return { problem: cause instanceof FeedMissingError ? "unpublished" : feedProblem(cause) };
  }
}
