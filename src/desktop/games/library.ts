// The Games library's own data (per game, kept on this PC by the main process
// in userData/game-library-2.json; libraryStore.ts says why not the older
// apps' game-library.json): the controller profile, and the player's
// own rating, review, DualSense feature checks and notes (shared later, by
// the player's choice, through the community repo).
import { z } from "zod";

// Saved button layouts: named remap tables kept in one library ("Southpaw",
// "Racing"), so a layout is made once and used by any game's profile (by its
// id). Edit it in one place and every game using it follows.
export const LayoutIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const ButtonLayoutSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  table: z.array(z.union([z.number().int().min(0).max(15), z.literal(0xff)])).length(16),
  // DualSense Edge Fn L/R and paddles L/R (protocol 1.9): a button, 0xFE off, 0xFF itself.
  extra: z
    .array(z.union([z.number().int().min(0).max(15), z.literal(0xfe), z.literal(0xff)]))
    .length(4)
    .optional(),
  updated: z.number(),
});
export type ButtonLayout = z.infer<typeof ButtonLayoutSchema>;

// A stick response curve (protocol 1.10), as src/protocol/stickCurve.ts has
// it (that module isn't part of the main process's build, so the type list is
// repeated here; a unit test keeps the two the same).
export const PROFILE_CURVE_TYPES = ["linear", "precise", "steady", "aggressive", "digital", "custom"] as const;
const CurveByte = z.number().int().min(0).max(255);
export const ProfileCurveSchema = z
  .strictObject({
    type: z.enum(PROFILE_CURVE_TYPES),
    points: z.array(z.tuple([CurveByte, CurveByte])).length(4),
  })
  // Custom points non-decreasing, as the firmware accepts them.
  .refine((c) => c.type !== "custom" || c.points.every((p, i) => i === 0 || (p[0] >= c.points[i - 1][0] && p[1] >= c.points[i - 1][1])));

// What a game profile can change on the dongle (in its RAM only, while the
// game runs or its profile is edited; never written to the dongle's flash).
// Format 2 (`format: 2`): a setting left out means "use my normal setting".
// Profiles made before it (no `format`) hold every config setting, and one
// strength for both grips when the right grip is missing; they load and keep
// working as they did (profileValues.ts upgrades them).
export const ProfileSettingsSchema = z.strictObject({
  format: z.literal(2).optional(),
  hapticsGain: z.number().min(1).max(6).optional(),
  // Right grip (protocol 1.6).
  hapticsGainRight: z.number().min(1).max(6).optional(),
  autoHapticsEnable: z.number().int().min(0).max(3).optional(),
  autoHapticsGain: z.number().int().min(0).max(200).optional(),
  autoHapticsLowpass: z.number().int().min(0).max(3).optional(),
  speakerVolume: z.number().min(-100).max(12).optional(),
  lightbarMode: z.number().int().min(0).max(8).optional(),
  lbFavR: z.array(z.number().int().min(0).max(255)).length(4).optional(),
  lbFavG: z.array(z.number().int().min(0).max(255)).length(4).optional(),
  lbFavB: z.array(z.number().int().min(0).max(255)).length(4).optional(),
  btMicEnable: z.boolean().optional(),
  // The haptics/speaker audio buffer (Haptics panel), samples.
  audioBufferLength: z.number().int().min(16).max(128).optional(),
  // Protocol 1.13: weaker adaptive triggers (0 = the game's own), the speaker
  // amp's pre-gain (0 = the game's own), games kept from changing the volume.
  triggerReduce: z.number().int().min(0).max(10).optional(),
  speakerGain: z.number().int().min(0).max(7).optional(),
  lockVolume: z.boolean().optional(),
  // Protocol 1.16: the controller's mic level (0 = the PC's, 1..64).
  micLevel: z.number().int().min(0).max(64).optional(), // MIC_LEVEL_MAX (protocol/config.ts; not in the main process build)
  // A saved button layout (protocol 1.8: applied for the game only, never
  // to flash); absent = the player's normal buttons.
  buttonLayout: LayoutIdSchema.optional(),
  // Stick response curves for the game (protocol 1.10: applied for the game
  // only, never to flash); a stick left out keeps the player's saved curve.
  stickCurves: z.strictObject({ left: ProfileCurveSchema.optional(), right: ProfileCurveSchema.optional() }).optional(),
});
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
// The dongle config fields a profile can set (the layout and the stick curves
// are applied separately). Dongle-wide settings (idle disconnect, the Pico's
// LED and screen, USB polling and controller mode) and app-only ones (theme,
// backgrounds, custom colors) aren't part of a game's profile.
export const PROFILE_FIELDS = [
  "hapticsGain",
  "hapticsGainRight",
  "autoHapticsEnable",
  "autoHapticsGain",
  "autoHapticsLowpass",
  "speakerVolume",
  "lightbarMode",
  "lbFavR",
  "lbFavG",
  "lbFavB",
  "btMicEnable",
  "audioBufferLength",
  "triggerReduce",
  "speakerGain",
  "lockVolume",
  "micLevel",
] as const satisfies ReadonlyArray<keyof ProfileSettings>;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

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
  // The player says the game has HDR on PC (games not on our list): the
  // Games page then offers to turn HDR on for it (Linux).
  hdr: z.boolean().optional(),
});
export type Mine = z.infer<typeof MineSchema>;

export const GameRecordSchema = z.strictObject({
  title: z.string().max(300),
  profile: z.strictObject({ settings: ProfileSettingsSchema, updated: z.number() }).optional(),
  mine: MineSchema.optional(),
});
export type GameRecord = z.infer<typeof GameRecordSchema>;

// A game key from the scan (`steam-1a2b3c4d:steam:1091500`): no paths.
export const GameKeySchema = z.string().regex(/^(steam|heroic|lutris|gog|epic)-[0-9a-f]{8}:(steam|epic|gog|amazon|sideload|lutris):[\w.-]{1,200}$/);

export const LibraryFileSchema = z.strictObject({
  version: z.literal(1),
  games: z.record(GameKeySchema, GameRecordSchema),
  // The dongle settings to put back when the game ends (persisted, so an app
  // that was closed mid-game restores them next time).
  restore: z.strictObject({ gameKey: GameKeySchema, settings: ProfileSettingsSchema }).optional(),
  layouts: z.record(LayoutIdSchema, ButtonLayoutSchema).optional(),
});
export type LibraryFile = z.infer<typeof LibraryFileSchema>;
export const EMPTY_LIBRARY: LibraryFile = { version: 1, games: {} };
