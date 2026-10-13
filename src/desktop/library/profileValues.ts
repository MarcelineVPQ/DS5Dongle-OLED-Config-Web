// A game profile's values against the player's normal settings (pure, so the
// rules are unit-tested). A profile holds only what this game changes: a
// setting it leaves out uses the normal setting ("use my normal setting").
// "Normal" is what the dongle had before a profile went on (the restore
// point), or the dongle's settings now when no profile is on.
import type { ConfigBody } from "../../protocol/config";
import { curvesEqual, type StickCurve } from "../../protocol/stickCurve";
import { PROFILE_FIELDS, type LibraryFile, type ProfileField, type ProfileSettings } from "../games/library";

// The profile-able values of a dongle config (format 2: every one set).
export function settingsFrom(c: ConfigBody): ProfileSettings {
  return {
    format: 2,
    hapticsGain: c.hapticsGain,
    hapticsGainRight: c.hapticsGainRight,
    autoHapticsEnable: c.autoHapticsEnable,
    autoHapticsGain: c.autoHapticsGain,
    autoHapticsLowpass: c.autoHapticsLowpass,
    speakerVolume: c.speakerVolume,
    lightbarMode: c.lightbarMode,
    lbFavR: [...c.lbFavR],
    lbFavG: [...c.lbFavG],
    lbFavB: [...c.lbFavB],
    btMicEnable: c.btMicEnable,
    audioBufferLength: c.audioBufferLength,
    triggerReduce: c.triggerReduce,
    speakerGain: c.speakerGain,
    lockVolume: c.lockVolume,
  };
}

// A profile from before format 2 meant one strength for both grips when it
// had no right grip; from format 2 a missing right grip is the normal one.
export function upgradeProfile(s: ProfileSettings): ProfileSettings {
  if (s.format === 2) return s;
  return { ...s, format: 2, ...(s.hapticsGain !== undefined ? { hapticsGainRight: s.hapticsGainRight ?? s.hapticsGain } : {}) };
}

// Floats come back from the dongle as float32 (1.3 -> 1.2999999...).
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  return JSON.stringify(a) === JSON.stringify(b);
}

// The config with the profile's values put on it (fields it leaves out keep
// the config's value).
export function withSettings(c: ConfigBody, s: ProfileSettings): ConfigBody {
  const out: Record<string, unknown> = { ...c };
  const u = upgradeProfile(s);
  for (const k of PROFILE_FIELDS) {
    const v = u[k];
    if (v !== undefined) out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out as unknown as ConfigBody; // ranges checked by ProfileSettingsSchema
}

// What goes on the dongle for a profile: the normal values, the profile's on top.
export const profileConfig = (c: ConfigBody, normal: ProfileSettings, profile: ProfileSettings): ConfigBody => withSettings(withSettings(c, normal), profile);

// The settings where this game has a value of its own (set, and not the same
// as the normal one). Without the normal settings (no dongle), every set one.
export function gameFields(profile: ProfileSettings, normal: ProfileSettings | null): ProfileField[] {
  const p = upgradeProfile(profile);
  const n = normal ? upgradeProfile(normal) : null;
  return PROFILE_FIELDS.filter((k) => p[k] !== undefined && (!n || n[k] === undefined || !sameValue(p[k], n[k])));
}

// What a profile keeps that isn't on the dongle's config.
export const nonConfigParts = (s: ProfileSettings | undefined): Partial<ProfileSettings> => ({
  ...(s?.buttonLayout ? { buttonLayout: s.buttonLayout } : {}),
  ...(s?.stickCurves ? { stickCurves: s.stickCurves } : {}),
});

// Only the values that differ from normal stay; the rest use the normal settings.
export function pruneProfile(profile: ProfileSettings, normal: ProfileSettings | null): ProfileSettings {
  const p = upgradeProfile(profile);
  const out: Record<string, unknown> = { format: 2 };
  for (const k of gameFields(p, normal)) out[k] = p[k];
  return { ...(out as ProfileSettings), ...nonConfigParts(p) };
}

// The controller view's settings saved into the profile ("Save to profile"):
// what differs from normal becomes this game's value; the layout and curves stay.
export const captureProfile = (config: ConfigBody, normal: ProfileSettings | null, profile: ProfileSettings | undefined): ProfileSettings =>
  pruneProfile({ ...settingsFrom(config), ...nonConfigParts(profile) }, normal);

// The dongle's settings aren't what the profile puts on (edits not saved to it).
export function profileDiffers(config: ConfigBody, normal: ProfileSettings | null, profile: ProfileSettings): boolean {
  const want = settingsFrom(normal ? profileConfig(config, normal, profile) : withSettings(config, profile));
  const now = settingsFrom(config);
  return PROFILE_FIELDS.some((k) => !sameValue(now[k], want[k]));
}

// The game page groups settings as its controls do; a group is this game's
// own when any of its fields is.
export const PROFILE_GROUPS = [
  { id: "grips", fields: ["hapticsGain", "hapticsGainRight"] },
  { id: "autoHaptics", fields: ["autoHapticsEnable", "autoHapticsGain", "autoHapticsLowpass"] },
  { id: "audioBuffer", fields: ["audioBufferLength"] },
  { id: "speaker", fields: ["speakerVolume"] },
  { id: "lightbar", fields: ["lightbarMode"] },
  { id: "favorites", fields: ["lbFavR", "lbFavG", "lbFavB"] },
  { id: "mic", fields: ["btMicEnable"] },
  { id: "triggers", fields: ["triggerReduce"] },
  { id: "speakerBoost", fields: ["speakerGain"] },
  { id: "volumeLock", fields: ["lockVolume"] },
] as const satisfies ReadonlyArray<{ id: string; fields: readonly ProfileField[] }>;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number]["id"];

export function gameGroups(profile: ProfileSettings, normal: ProfileSettings | null): ProfileGroup[] {
  const own = new Set<ProfileField>(gameFields(profile, normal));
  return PROFILE_GROUPS.filter((g) => g.fields.some((f) => own.has(f))).map((g) => g.id);
}

// Back to the normal setting for one group.
export function clearGroup(profile: ProfileSettings, group: ProfileGroup): ProfileSettings {
  const out: Record<string, unknown> = { ...upgradeProfile(profile) };
  for (const f of PROFILE_GROUPS.find((g) => g.id === group)?.fields ?? []) delete out[f];
  return out as ProfileSettings;
}

// The values the game page shows: the profile's, else the normal ones.
export const shownValues = (profile: ProfileSettings, normal: ProfileSettings): ProfileSettings => ({ ...upgradeProfile(normal), ...stripUndefined(upgradeProfile(profile)) });

function stripUndefined(s: ProfileSettings): ProfileSettings {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as ProfileSettings;
}

// Edits kept in a panel's own draft while a profile is on (the Buttons list,
// the stick curves): "Save to profile" saves them with the settings, in one
// save, so none is left behind.
export type GameCurves = [StickCurve | undefined, StickCurve | undefined]; // undefined = that stick's normal curve
// (The library checks a stored curve has its 4 points.)
export const profileCurves = (s: ProfileSettings | undefined): GameCurves => [s?.stickCurves?.left as StickCurve | undefined, s?.stickCurves?.right as StickCurve | undefined];
const sameCurve = (a: StickCurve | undefined, b: StickCurve | undefined) => (a && b ? curvesEqual(a, b) : a === b);
export const sameGameCurves = (a: GameCurves, b: GameCurves) => sameCurve(a[0], b[0]) && sameCurve(a[1], b[1]);

// Something changed for the active profile isn't saved into it yet (the
// bottom bar's "not saved yet"; Done asks first): the dongle's settings, the
// curves draft or the Buttons list's changes.
export function profileUnsaved(s: { config: ConfigBody; normal: ProfileSettings | null; profile: ProfileSettings; curvesDraft: GameCurves | null; buttonsChanged: boolean }): boolean {
  if (s.buttonsChanged || profileDiffers(s.config, s.normal, s.profile)) return true;
  return !!s.curvesDraft && !sameGameCurves(s.curvesDraft, profileCurves(s.profile));
}

// The layout a game's buttons are saved into: its own, else a new one named after the game.
export function layoutForButtons(settings: ProfileSettings | undefined, layouts: LibraryFile["layouts"], title: string, newId: string): { id: string; name: string } {
  const id = settings?.buttonLayout;
  const own = id ? layouts?.[id] : undefined;
  return id && own ? { id, name: own.name } : { id: newId, name: title.slice(0, 40) };
}

// What "Save to profile" stores: the captured settings, the curves draft (when
// changed) and the layout the buttons went into (when they changed).
export function profileToSave(captured: ProfileSettings, pending: { curves?: GameCurves | null; buttonLayout?: string }): ProfileSettings {
  const out = { ...captured };
  if (pending.buttonLayout) out.buttonLayout = pending.buttonLayout;
  if (pending.curves) {
    const [left, right] = pending.curves;
    if (left || right) out.stickCurves = { ...(left ? { left } : {}), ...(right ? { right } : {}) };
    else delete out.stickCurves;
  }
  return out;
}
