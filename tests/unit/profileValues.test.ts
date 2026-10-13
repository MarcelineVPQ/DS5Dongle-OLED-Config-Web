import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ConfigBody } from "../../src/protocol/config";
import { LibraryFileSchema, PROFILE_FIELDS, ProfileSettingsSchema, type ProfileSettings } from "../../src/desktop/games/library";
import {
  captureProfile,
  clearGroup,
  gameFields,
  gameGroups,
  layoutForButtons,
  profileConfig,
  profileCurves,
  profileDiffers,
  profileToSave,
  pruneProfile,
  PROFILE_GROUPS,
  sameGameCurves,
  settingsFrom,
  shownValues,
  upgradeProfile,
  withSettings,
} from "../../src/desktop/library/profileValues";

// A profile as 0.9.4 / 0.9.5-dev.4 stored it: every config field, no format.
const V1: ProfileSettings = {
  hapticsGain: 2,
  autoHapticsEnable: 2,
  autoHapticsGain: 120,
  autoHapticsLowpass: 1,
  speakerVolume: 0,
  lightbarMode: 8,
  lbFavR: [255, 0, 0, 255],
  lbFavG: [0, 255, 0, 255],
  lbFavB: [0, 0, 255, 255],
  btMicEnable: true,
  buttonLayout: "l-racing",
};
const normalConfig: ConfigBody = { ...DEFAULT_CONFIG, hapticsGain: 1.5, hapticsGainRight: 1.5, audioBufferLength: 64 };
const normal = settingsFrom(normalConfig);

describe("game profile values (format 2: left out = my normal setting)", () => {
  it("covers every profile field, and nothing app-only or dongle-wide", () => {
    const schemaKeys = Object.keys(ProfileSettingsSchema.shape).filter((k) => !["format", "buttonLayout", "stickCurves"].includes(k));
    expect([...PROFILE_FIELDS].sort()).toEqual(schemaKeys.sort());
    expect(
      Object.keys(settingsFrom(DEFAULT_CONFIG))
        .filter((k) => k !== "format")
        .sort(),
    ).toEqual([...PROFILE_FIELDS].sort());
    for (const k of ["inactiveTime", "disablePicoLed", "pollingRateMode", "controllerMode", "currentSlot", "screenBrightness"]) expect(PROFILE_FIELDS as readonly string[]).not.toContain(k);
    // Every field is in exactly one game-page group.
    expect(PROFILE_GROUPS.flatMap((g) => g.fields).sort()).toEqual([...PROFILE_FIELDS].sort());
  });

  it("loads old profiles and restore points, and new partial ones", () => {
    expect(ProfileSettingsSchema.safeParse(V1).success).toBe(true);
    expect(ProfileSettingsSchema.safeParse({ format: 2, speakerVolume: 6 }).success).toBe(true);
    expect(ProfileSettingsSchema.safeParse({ format: 3 }).success).toBe(false);
    expect(ProfileSettingsSchema.safeParse({ format: 2, audioBufferLength: 8 }).success).toBe(false);
    const file = { version: 1, games: { "steam-1a2b3c4d:steam:1": { title: "X", profile: { settings: V1, updated: 1 } } }, restore: { gameKey: "steam-1a2b3c4d:steam:1", settings: V1 } };
    expect(LibraryFileSchema.safeParse(file).success).toBe(true);
  });

  it("an old profile keeps working as before: every value set, one strength for both grips", () => {
    const u = upgradeProfile(V1);
    expect(u.format).toBe(2);
    expect(u.hapticsGainRight).toBe(2);
    const c = profileConfig(normalConfig, normal, V1);
    expect(c.hapticsGain).toBe(2);
    expect(c.hapticsGainRight).toBe(2);
    expect(c.autoHapticsEnable).toBe(2);
    // Not in old profiles: the normal value.
    expect(c.audioBufferLength).toBe(64);
  });

  it("a setting the profile leaves out is the normal one, not the previous game's", () => {
    const previousGame = { ...normalConfig, speakerVolume: 9, audioBufferLength: 128 };
    const c = profileConfig(previousGame, normal, { format: 2, hapticsGain: 4 });
    expect(c.speakerVolume).toBe(normal.speakerVolume);
    expect(c.audioBufferLength).toBe(64);
    expect(c.hapticsGain).toBe(4);
    expect(c.hapticsGainRight).toBe(1.5); // format 2: the right grip left out is normal
    // Fields that aren't the profile's stay as they are (dongle-wide settings).
    expect(withSettings({ ...normalConfig, inactiveTime: 45 }, normal).inactiveTime).toBe(45);
  });

  it("only what differs from normal is this game's own", () => {
    expect(gameFields(V1, normal)).toEqual(["hapticsGain", "hapticsGainRight", "autoHapticsEnable", "autoHapticsGain"]);
    expect(gameGroups(V1, normal)).toEqual(["grips", "autoHaptics"]);
    // Without the normal settings (no dongle) every value set counts.
    expect(gameFields({ format: 2, speakerVolume: 3 }, null)).toEqual(["speakerVolume"]);
    // float32 round trips aren't differences.
    expect(gameFields({ format: 2, hapticsGain: 1.5000000001 }, normal)).toEqual([]);
    const pruned = pruneProfile(V1, normal);
    expect(pruned).toEqual({ format: 2, hapticsGain: 2, hapticsGainRight: 2, autoHapticsEnable: 2, autoHapticsGain: 120, buttonLayout: "l-racing" });
    expect(ProfileSettingsSchema.safeParse(pruned).success).toBe(true);
  });

  it("captures the controller view's edits into the profile, keeping its layout and curves", () => {
    const curves = {
      left: {
        type: "precise" as const,
        points: [
          [0, 0],
          [64, 32],
          [128, 96],
          [255, 255],
        ] as [number, number][],
      },
    };
    const profile: ProfileSettings = { format: 2, speakerVolume: 6, buttonLayout: "l-x", stickCurves: curves };
    const onDongle = { ...profileConfig(normalConfig, normal, profile), audioBufferLength: 96, lightbarMode: 6 };
    expect(profileDiffers(onDongle, normal, profile)).toBe(true);
    const saved = captureProfile(onDongle, normal, profile);
    expect(saved).toEqual({ format: 2, speakerVolume: 6, audioBufferLength: 96, lightbarMode: 6, buttonLayout: "l-x", stickCurves: curves });
    expect(profileDiffers(onDongle, normal, saved)).toBe(false);
    // Put back to the normal value in the controller view: the normal setting again.
    expect(captureProfile({ ...onDongle, speakerVolume: normal.speakerVolume! }, normal, saved).speakerVolume).toBeUndefined();
  });

  it("goes back to the normal setting per group, and shows normal values where the profile has none", () => {
    const p = clearGroup(V1, "autoHaptics");
    expect(p.autoHapticsEnable).toBeUndefined();
    expect(p.autoHapticsGain).toBeUndefined();
    expect(p.hapticsGain).toBe(2);
    expect(shownValues({ format: 2, speakerVolume: 4 }, normal)).toMatchObject({ speakerVolume: 4, hapticsGain: 1.5, audioBufferLength: 64 });
  });
});

// "Save to profile" saves the panels' drafts (buttons, curves) with the settings.
describe("profileToSave", () => {
  const precise = {
    type: "precise" as const,
    points: [
      [0, 0],
      [85, 60],
      [170, 140],
      [255, 255],
    ] as [[number, number], [number, number], [number, number], [number, number]],
  };
  const captured: ProfileSettings = { format: 2, speakerVolume: 3, buttonLayout: "l-old", stickCurves: { left: precise } };

  it("keeps the layout and curves when neither was edited", () => {
    expect(profileToSave(captured, { curves: null })).toEqual(captured);
  });

  it("points the profile at the layout the buttons went into", () => {
    expect(profileToSave({ format: 2 }, { buttonLayout: "l-new" })).toEqual({ format: 2, buttonLayout: "l-new" });
  });

  it("stores the curves draft, and drops them when both sticks went back to normal", () => {
    expect(profileToSave(captured, { curves: [undefined, precise] }).stickCurves).toEqual({ right: precise });
    expect(profileToSave(captured, { curves: [undefined, undefined] })).not.toHaveProperty("stickCurves");
  });

  it("compares curves drafts with what the profile holds", () => {
    expect(sameGameCurves(profileCurves(captured), [precise, undefined])).toBe(true);
    expect(sameGameCurves(profileCurves(captured), [undefined, undefined])).toBe(false);
    expect(sameGameCurves(profileCurves(undefined), [undefined, undefined])).toBe(true);
  });
});

describe("layoutForButtons", () => {
  const layouts = { "l-1": { name: "Racing", table: Array.from({ length: 16 }, (_, i) => i), updated: 1 } };

  it("saves into the game's own layout", () => {
    expect(layoutForButtons({ format: 2, buttonLayout: "l-1" }, layouts, "Some Game", "l-new")).toEqual({ id: "l-1", name: "Racing" });
  });

  it("makes a new layout named after the game when it has none (or it was deleted)", () => {
    expect(layoutForButtons({ format: 2 }, layouts, "Some Game", "l-new")).toEqual({ id: "l-new", name: "Some Game" });
    expect(layoutForButtons({ format: 2, buttonLayout: "l-gone" }, layouts, "x".repeat(50), "l-new")).toEqual({ id: "l-new", name: "x".repeat(40) });
  });
});
