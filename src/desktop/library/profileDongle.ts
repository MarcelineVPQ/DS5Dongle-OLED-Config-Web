// Putting a game profile on the dongle and taking it off again, RAM only:
// the config is applied without saving (0xF6 0x01, never 0x02), the button
// layout as a temporary remap (0x11) with the Edge's extras temporary (0x13),
// the stick curves temporary (0x14); 0x12 ends the layout, extras and curves
// together, back to what's in flash. Each part only goes to firmware that
// reports it (feature bits); older firmware gets the rest of the profile.
import type { Ds5BridgeClient, BridgeIdentity } from "../../protocol/bridgeClient";
import { FEATURES2, supportsFeature2 } from "../../protocol/bridgeClient";
import type { ConfigBody } from "../../protocol/config";
import type { LibraryFile, ProfileSettings } from "../games/library";
import { profileConfig, profileCurves, withSettings, type GameCurves } from "./profileValues";

export interface ProfileCaps {
  layouts: boolean; // temporary remaps (protocol 1.8)
  edgeExtras: boolean; // the Edge's Fn buttons and paddles (1.9)
  curves: boolean; // stick curves (1.10)
  slot: number; // the pairing slot in use (curves are per slot)
}

export function profileCaps(identity: BridgeIdentity | null): ProfileCaps {
  return {
    layouts: supportsFeature2(identity, 8, FEATURES2.temporaryRemap),
    edgeExtras: supportsFeature2(identity, 9, FEATURES2.remapExtra),
    curves: supportsFeature2(identity, 10, FEATURES2.stickCurves),
    slot: identity?.currentSlot ?? 0,
  };
}

export interface GameParts {
  layout: { table: number[]; extra?: number[] } | null;
  curves: GameCurves | null;
}

// The profile's button layout (if it still exists) and stick curves.
export function gamePartsOf(library: LibraryFile, s: ProfileSettings): GameParts {
  const layout = s.buttonLayout ? (library.layouts?.[s.buttonLayout] ?? null) : null;
  const curves = profileCurves(s); // 4 points each (ProfileCurveSchema)
  return { layout, curves: curves[0] || curves[1] ? curves : null };
}

// The game's layout and curves (null: the saved ones). Whatever a previous
// game left on goes first (0x12, RAM only), then only what this profile has.
export async function putGameParts(client: Ds5BridgeClient, caps: ProfileCaps, parts: GameParts | null): Promise<void> {
  if (!caps.layouts && !caps.curves) return;
  await client.revertRemap();
  if (!parts) return;
  if (parts.layout && caps.layouts) {
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
    const back = await o.applyConfig(withSettings(o.config, o.normal)).catch(() => false);
    if (back && o.client) await putGameParts(o.client, o.caps, null).catch(() => undefined); // whatever went on of the parts (RAM only)
    throw new ProfileNotApplied(back ? "normal" : "profile", cause);
  }
}

export async function restoreNormal(o: { client: Ds5BridgeClient | null; caps: ProfileCaps; applyConfig: ApplyConfig; config: ConfigBody; normal: ProfileSettings }): Promise<void> {
  if (!(await o.applyConfig(withSettings(o.config, o.normal)))) throw new Error("restore failed");
  if (o.client) await putGameParts(o.client, o.caps, null);
}
