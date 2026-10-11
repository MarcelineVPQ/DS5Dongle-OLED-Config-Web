// The Games library's own data (per game, kept on this PC by the main process
// in userData/game-library.json): the controller profile, and the player's
// own rating, review, DualSense feature checks and notes (shared later, by
// the player's choice, through the community repo).
import { z } from "zod";

// What a game profile can change on the dongle (in its RAM only, while the
// game runs; never written to the dongle's flash).
export const ProfileSettingsSchema = z.strictObject({
  hapticsGain: z.number().min(1).max(6),
  autoHapticsEnable: z.number().int().min(0).max(3),
  autoHapticsGain: z.number().int().min(0).max(200),
  autoHapticsLowpass: z.number().int().min(0).max(3),
  speakerVolume: z.number().min(-100).max(12),
  lightbarMode: z.number().int().min(0).max(8),
  lbFavR: z.array(z.number().int().min(0).max(255)).length(4),
  lbFavG: z.array(z.number().int().min(0).max(255)).length(4),
  lbFavB: z.array(z.number().int().min(0).max(255)).length(4),
  btMicEnable: z.boolean(),
});
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
export const PROFILE_FIELDS = Object.keys(ProfileSettingsSchema.shape) as Array<keyof ProfileSettings>;

// Player feedback is structured, never free text: fixed statements a player
// ticks, so shared feedback (later) is counts per statement, with nothing to
// moderate. Notes are free text but private: they never leave this PC.
export const FEEDBACK_TAGS = [
  "triggers-work",
  "haptics-work",
  "speaker-works",
  "mic-works",
  "lightbar-works",
  "weak-vibration",
  "no-triggers",
  "rumble-only",
  "speaker-problems",
  "not-detected",
  "needs-steam-input-off",
  "disconnects",
] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export const MineSchema = z.strictObject({
  rating: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.enum(FEEDBACK_TAGS)).max(FEEDBACK_TAGS.length).optional(),
  // What the rating and feedback were given on: the app (which also pins
  // the firmware) and the game's build, so feedback from before a game
  // update or one of our fixes can be told apart (and flagged as stale).
  ratedOn: z
    .strictObject({
      app: z.string().regex(/^\d+\.\d+\.\d+$/),
      build: z.string().max(40).optional(),
      gameUpdated: z.number().optional(),
      at: z.number(),
    })
    .optional(),
  notes: z.string().max(5000).optional(),
});
export type Mine = z.infer<typeof MineSchema>;

export const GameRecordSchema = z.strictObject({
  title: z.string().max(300),
  profile: z.strictObject({ settings: ProfileSettingsSchema, updated: z.number() }).optional(),
  mine: MineSchema.optional(),
});
export type GameRecord = z.infer<typeof GameRecordSchema>;

// A game key from the scan (`steam-1a2b3c4d:steam:1091500`): no paths.
export const GameKeySchema = z.string().regex(/^(steam|heroic|lutris)-[0-9a-f]{8}:(steam|epic|gog|amazon|sideload|lutris):[\w.-]{1,200}$/);

export const LibraryFileSchema = z.strictObject({
  version: z.literal(1),
  games: z.record(GameKeySchema, GameRecordSchema),
  // The dongle settings to put back when the game ends (persisted, so an app
  // that was closed mid-game restores them next time).
  restore: z.strictObject({ gameKey: GameKeySchema, settings: ProfileSettingsSchema }).optional(),
});
export type LibraryFile = z.infer<typeof LibraryFileSchema>;
export const EMPTY_LIBRARY: LibraryFile = { version: 1, games: {} };
