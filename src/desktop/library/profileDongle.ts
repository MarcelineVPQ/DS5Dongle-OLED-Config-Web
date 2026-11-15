// Putting a game profile on the dongle and taking it off again, RAM only:
// the config is applied without saving (0xF6 0x01, never 0x02), the button
// layout as a temporary remap (0x11) with the Edge's extras temporary (0x13),
// the stick curves temporary (0x14); 0x12 ends the layout, extras and curves
// together, back to what's in flash; a Tension set (1.23) is chosen for now
// (0x20 temporary) and the board's saved choice comes back after (0x20 0xFE).
// Protocol 1.24 (docs/design/button-layouts-2026-11.md §1): the game's button
// layout is a whole layout: the board's own copy runs for now (0x20
// temporary) when it is on the board, else it is sent for now (0x22), else
// its Press part goes as the temporary table with no board layout running
// meanwhile (the game page says what doesn't come along).
// Each part only goes to firmware that
// reports it (feature bits); older firmware gets the rest of the profile.
import type { Ds5BridgeClient, BridgeIdentity } from "../../protocol/bridgeClient";
import { CommandError, FEATURES2, FEATURES5, supportsFeature2, supportsFeature5, supportsSetButtons, supportsTension } from "../../protocol/bridgeClient";
import { emptyButtonPart, legacyFromPart } from "../../protocol/buttons";
import { crc32, encodeSetWire, setValid, type TensionSet } from "../../protocol/tension";
import { layoutSet } from "../live/layoutEditor";
import { KeyedError } from "../../errorText";
import type { ConfigBody } from "../../protocol/config";
import type { LibraryFile, ProfileSettings } from "../games/library";
import { profileConfig, profileCurves, withSettings, type GameCurves } from "./profileValues";

export interface ProfileCaps {
  layouts: boolean; // temporary remaps (protocol 1.8)
  edgeExtras: boolean; // the Edge's Fn buttons and paddles (1.9)
  curves: boolean; // stick curves (1.10)
  tension: boolean; // a Tension slot for the game (1.23)
  boardLayouts: boolean; // whole layouts on the board (1.24, [58] bit 0)
  forNow: boolean; // a layout sent for now (1.24, [58] bit 6, 0x22)
  slot: number; // the pairing slot in use (curves are per slot)
}

export function profileCaps(identity: BridgeIdentity | null): ProfileCaps {
  return {
    layouts: supportsFeature2(identity, 8, FEATURES2.temporaryRemap),
    edgeExtras: supportsFeature2(identity, 9, FEATURES2.remapExtra),
    curves: supportsFeature2(identity, 10, FEATURES2.stickCurves),
    tension: supportsTension(identity),
    boardLayouts: supportsSetButtons(identity),
    forNow: supportsSetButtons(identity) && supportsFeature5(identity, FEATURES5.setForNow),
    slot: identity?.currentSlot ?? 0,
  };
}

export interface GameParts {
  layout: { table: number[]; extra?: number[] } | null;
  // 1.24: the layout whole (trigger effects + buttons), as the board keeps it.
  set: TensionSet | null;
  curves: GameCurves | null;
  tension: number | null; // 1.23: the board's slot of trigger effects
}

// The profile's button layout (if it still exists) and stick curves.
export function gamePartsOf(library: LibraryFile, s: ProfileSettings): GameParts {
  const layout = s.buttonLayout ? (library.layouts?.[s.buttonLayout] ?? null) : null;
  const curves = profileCurves(s); // 4 points each (ProfileCurveSchema)
  return { layout, set: layout ? layoutSet(layout) : null, curves: curves[0] || curves[1] ? curves : null, tension: s.tensionSet ?? null };
}

// The game's layout and curves (null: the saved ones). Whatever a previous
// game left on goes first (0x12, RAM only), then only what this profile has.
export async function putGameParts(client: Ds5BridgeClient, caps: ProfileCaps, parts: GameParts | null): Promise<void> {
  if (!caps.layouts && !caps.curves && !caps.tension) return;
  if (caps.layouts || caps.curves) await client.revertRemap();
  const set = caps.boardLayouts && parts?.set && setValid(parts.set) ? parts.set : null;
  if (caps.tension && !set) await chooseGameSet(client, parts?.tension ?? null);
  if (!parts) return;
  if (set) await putGameLayout(client, caps, set);
  else if (parts.layout && caps.layouts) {
    await client.applyRemapTemporary(parts.layout.table);
    if (parts.layout.extra && caps.edgeExtras) await client.applyRemapExtra(parts.layout.extra, true);
  }
  if (parts.curves && caps.curves) {
    // A stick the profile leaves alone keeps its saved curve (the dongle sets both).
    const saved = !parts.curves[0] || !parts.curves[1] ? (await client.readStickCurves())?.saved : undefined;
    const left = parts.curves[0] ?? saved?.[0];
    const right = parts.curves[1] ?? saved?.[1];
    if (left && right) await client.applyStickCurves(caps.slot, left, right, true);
  }
}

// How a game's whole layout reaches the board (1.24): its copy on the board,
// else sent for now, else its Press part as the temporary table.
export type GameLayoutRoute = "board" | "forNow" | "table";
export async function gameLayoutRoute(client: Ds5BridgeClient, caps: ProfileCaps, set: TensionSet): Promise<{ route: GameLayoutRoute; slot: number }> {
  const list = await client.readTensionList();
  const crc = crc32(encodeSetWire(set));
  // loop: NOT-WORTH — N = 8 slots, once per game start
  const slot = list ? list.crcs.findIndex((c, i) => list.used[i] && c === crc) : -1;
  return { route: slot >= 0 ? "board" : caps.forNow ? "forNow" : "table", slot };
}

async function putGameLayout(client: Ds5BridgeClient, caps: ProfileCaps, set: TensionSet): Promise<void> {
  const { route, slot } = await gameLayoutRoute(client, caps, set);
  if (route === "board") return chooseGameSet(client, slot);
  if (route === "forNow") return client.runLayoutForNow(set);
  // No board layout runs meanwhile, so the table is what the game gets (§3.7).
  await client.chooseTension("none", true);
  const legacy = legacyFromPart(set.buttons ?? emptyButtonPart());
  if (caps.layouts) await client.applyRemapTemporary(legacy.table);
  if (caps.edgeExtras) await client.applyRemapExtra(legacy.extra, true);
}

// The game's set for now only, or (null) back to the board's saved choice.
// A set deleted since the profile picked it: the board answers INVALID, said
// in plain words (the profile's notice names the fix: pick another set).
async function chooseGameSet(client: Ds5BridgeClient, slot: number | null): Promise<void> {
  try {
    await client.chooseTension(slot ?? "saved", slot !== null);
  } catch (cause) {
    // error: SHOWN — desktop.tension.errors.setGone, in the profile's notice (desktop.profile.applyFailed / partlyOn with its reason)
    if (cause instanceof CommandError && cause.result === "invalid" && slot !== null) throw new KeyedError("desktop.tension.errors.setGone", { slot }, { cause });
    throw cause;
  }
}

// applyConfig: puts a config in the dongle's RAM (the bridge hook's applyBody).
type ApplyConfig = (c: ConfigBody) => Promise<boolean>;

// A profile that didn't go on, and what the dongle's RAM holds after it:
// "normal" (the normal values went back on) or "profile" (they couldn't: the
// game's config may be on without its layout or curves). The app must never
// show the normal mode, whose Save to dongle writes RAM to flash, over a
// game's config.
export class ProfileNotApplied extends Error {
  constructor(
    readonly left: "normal" | "profile",
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ProfileNotApplied";
  }
}

export async function applyGameProfile(o: {
  client: Ds5BridgeClient | null;
  caps: ProfileCaps;
  applyConfig: ApplyConfig;
  config: ConfigBody;
  normal: ProfileSettings;
  profile: ProfileSettings;
  parts: GameParts;
}): Promise<void> {
  try {
    if (!(await o.applyConfig(profileConfig(o.config, o.normal, o.profile)))) throw new Error("apply failed");
    if (o.client) await putGameParts(o.client, o.caps, o.parts);
  } catch (cause) {
    // The game's config may be on (it landed before the layout or curves
    // failed, or a transfer failed after it landed): the normal values go back.
    // error: SHOWN — desktop.profile.partlyOn (false: the profile may still be on, which the thrown error says)
    const back = await o.applyConfig(withSettings(o.config, o.normal)).catch(() => false);
    // error: NOT-WORTH — taking off whatever went on of the parts (RAM only) while the real error is thrown below
    if (back && o.client) await putGameParts(o.client, o.caps, null).catch(() => undefined);
    throw new ProfileNotApplied(back ? "normal" : "profile", cause);
  }
}

export async function restoreNormal(o: { client: Ds5BridgeClient | null; caps: ProfileCaps; applyConfig: ApplyConfig; config: ConfigBody; normal: ProfileSettings }): Promise<void> {
  if (!(await o.applyConfig(withSettings(o.config, o.normal)))) throw new Error("restore failed");
  if (o.client) await putGameParts(o.client, o.caps, null);
}
