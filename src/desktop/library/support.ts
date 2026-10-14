// DualSense support tier for a game page: like ProtonDB's tiers, but about the
// controller's features through the dongle. "verified" = we played it on the
// dongle (the game test passes); the rest comes from the known-games table
// and this PC's setup state. Community reports (phase 2) will add "works" /
// "broken" from players.
import type { DualSenseSupport, GameEntry } from "../games/types";
import { normalizeTitle } from "../games/knownGames";

export type Tier = "verified" | "works" | "needs-setup" | "partial" | "broken" | "unknown";
export type FeatureState = "yes" | "no" | "unknown";
export interface Features {
  triggers: FeatureState;
  haptics: FeatureState;
  speaker: FeatureState;
  mic: FeatureState;
  lightbar: FeatureState;
}

// Tested on the dongle (2026: v0.7.0 game pass, 0.8.x checks). Partial =
// works, but the game itself leaves a feature out on PC.
const TESTED: Array<[string, Tier, Partial<Features>]> = [
  ["Cyberpunk 2077", "verified", { triggers: "yes", haptics: "yes", speaker: "yes", lightbar: "yes" }],
  ["UNCHARTED: Legacy of Thieves Collection", "verified", { triggers: "yes", haptics: "yes", speaker: "yes" }],
  ["The Last of Us Part I", "verified", { triggers: "yes", haptics: "yes", speaker: "yes" }],
  ["Marvel's Spider-Man Remastered", "verified", { triggers: "yes", haptics: "yes", speaker: "yes" }],
  ["Indiana Jones and the Great Circle", "verified", { triggers: "yes", haptics: "yes" }],
  ["Ghostrunner", "verified", { triggers: "yes", haptics: "yes" }],
  ["Avatar: Frontiers of Pandora", "verified", { triggers: "yes", haptics: "yes" }],
  ["STAR WARS Galactic Racer", "verified", { triggers: "yes", haptics: "yes", speaker: "yes" }],
  ["Ghost of Tsushima", "partial", { triggers: "yes", haptics: "no" }],
  ["FINAL FANTASY VII REMAKE INTERGRADE", "partial", { triggers: "yes", haptics: "no" }],
  ["DEATH STRANDING 2: ON THE BEACH", "partial", { triggers: "no", haptics: "yes" }],
];
const TESTED_BY_TITLE = new Map(TESTED.map(([t, tier, f]) => [normalizeTitle(t), { tier, features: f }]));

const fromSupport = (s: DualSenseSupport): Partial<Features> =>
  s === "triggers" ? { triggers: "yes", haptics: "yes" } : s === "haptics" ? { triggers: "no", haptics: "yes" } : s === "xinput" ? { triggers: "no", haptics: "no" } : {};

export function supportOf(game: GameEntry): { tier: Tier; features: Features; tested: boolean } {
  const tested = TESTED_BY_TITLE.get(normalizeTitle(game.title));
  const features: Features = { triggers: "unknown", haptics: "unknown", speaker: "unknown", mic: "unknown", lightbar: "unknown", ...fromSupport(game.support), ...tested?.features };
  const needsSetup = game.fixes.length > 0 || game.runnerMissing;
  let tier: Tier;
  if (tested) tier = needsSetup ? "needs-setup" : tested.tier;
  else if (game.support === "triggers" || game.support === "haptics") tier = needsSetup ? "needs-setup" : "works";
  else if (game.support === "xinput") tier = "partial";
  else tier = "unknown";
  return { tier, features, tested: !!tested };
}

// Game-specific fixes we shipped, shown on the game's page ("Fixed in 0.8.2:
// …") and used to flag feedback given before them. Add an entry with the
// release that fixes a game; `note` is an i18n key under desktop.library.fix.
export interface GameFix {
  title: string;
  app: string; // the DS5 Dongle release with the fix
  note: string;
}
export const GAME_FIXES: GameFix[] = [];

export function fixesFor(title: string): GameFix[] {
  const n = normalizeTitle(title);
  // loop: NOT-WORTH — GAME_FIXES is empty today (N = 0); per game page render
  return GAME_FIXES.filter((f) => normalizeTitle(f.title) === n);
}

// "0.9.0-beta.2" -> numbers [0, 9, 0] (missing or non-numeric parts are 0) and a prerelease flag.
const parts = (v: string) => {
  const [core, ...pre] = v.replace(/^v/, "").split("-");
  // loop: NOT-WORTH — N = 3 version parts; only when feedback has a rating
  const nums = core.split(".").map((p) => Number.parseInt(p, 10));
  // loop: NOT-WORTH — N = 3 version parts; only when feedback has a rating
  return { nums: [0, 1, 2].map((i) => (Number.isFinite(nums[i]) ? nums[i] : 0)), pre: pre.length > 0 };
};
export function versionLess(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  // loop: NOT-WORTH — N = 3 version parts
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i];
  // Same numbers: a prerelease (0.9.0-beta) comes before the release (0.9.0).
  return x.pre && !y.pre;
}

// Why the player's feedback may be out of date: the game updated since, or
// we shipped a fix for it since.
export type Stale = { kind: "game-update"; at?: number } | { kind: "our-fix"; app: string } | null;
export function staleness(ratedOn: { app: string; build?: string; gameUpdated?: number } | undefined, now: { buildId?: string; lastUpdated?: number }, fixes: GameFix[]): Stale {
  if (!ratedOn) return null;
  // loop: NOT-WORTH — fixes for one game, N = 0 today
  const fix = fixes.find((f) => versionLess(ratedOn.app, f.app));
  if (fix) return { kind: "our-fix", app: fix.app };
  if (ratedOn.build && now.buildId && ratedOn.build !== now.buildId) return { kind: "game-update", at: now.lastUpdated };
  if (!ratedOn.build && ratedOn.gameUpdated && now.lastUpdated && now.lastUpdated > ratedOn.gameUpdated) return { kind: "game-update", at: now.lastUpdated };
  return null;
}
