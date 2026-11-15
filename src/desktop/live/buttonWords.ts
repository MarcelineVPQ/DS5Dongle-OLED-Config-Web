// The words and short labels of a button layout (protocol 1.24): Sony's
// names for the buttons, what a target does in plain words, and the drawing's
// badges. Pure (no React), so the drawing, the section and the tests share it.
import type { useTranslation } from "react-i18next";
import { effectiveEntry, entryAt, hasExtras, itself, SOURCE, TARGET_KIND, changedSources, sameTarget, type ButtonPart, type Target } from "../../protocol/buttons";
import { keyName, MOD, MOD_KEYS, leftMods } from "../../protocol/keys";
import type { PartId } from "./parts";

type T = ReturnType<typeof useTranslation>["t"];

// Each source's part on the drawing (TENSION_BUTTONS.md §3.3 order).
export const SOURCE_PART: readonly PartId[] = [
  "l2",
  "l1",
  "create",
  "dpad-up",
  "dpad-left",
  "dpad-down",
  "dpad-right",
  "stick-l",
  "r2",
  "r1",
  "options",
  "triangle",
  "circle",
  "cross",
  "square",
  "stick-r",
  "touchpad",
  "ps",
  "fn-l",
  "fn-r",
  "paddle-l",
  "paddle-r",
];
// loop: NOT-WORTH — N = 22 sources, once at load
export const PART_SOURCE: ReadonlyMap<PartId, number> = new Map(SOURCE_PART.map((p, s) => [p, s]));

export const sourceName = (t: T, source: number) => t(`desktop.live.part.${SOURCE_PART[source]}`);

// The short job on a badge and in the picker: Sony's glyphs, L1…, arrows for the directional buttons.
const SHORT: Record<number, string> = {
  [SOURCE.l2]: "L2",
  [SOURCE.l1]: "L1",
  [SOURCE.up]: "↑",
  [SOURCE.left]: "←",
  [SOURCE.down]: "↓",
  [SOURCE.right]: "→",
  [SOURCE.l3]: "L3",
  [SOURCE.r2]: "R2",
  [SOURCE.r1]: "R1",
  [SOURCE.triangle]: "△",
  [SOURCE.circle]: "○",
  [SOURCE.cross]: "✕",
  [SOURCE.square]: "□",
  [SOURCE.r3]: "R3",
  [SOURCE.ps]: "PS",
};
const SHORT_KEY: Record<number, string> = { [SOURCE.create]: "create", [SOURCE.options]: "options", [SOURCE.touchpad]: "touchpad" };
export const shortName = (t: T, button: number) => SHORT[button] ?? t(`desktop.buttons.badge.${SHORT_KEY[button]}`);

export const MOUSE_BUTTONS = ["left", "right", "middle", "back", "forward"] as const; // a = 1..5
export const MOTIONS = ["up", "down", "left", "right", "wheelUp", "wheelDown"] as const; // a = 0..5
export const GYRO_MODES = ["held", "offHeld", "switch"] as const; // a = 0..2

export const layerName = (t: T, part: ButtonPart, layer: number) => (layer === 0 ? t("desktop.layers.base") : part.layers[layer - 1]?.name || t("desktop.layers.defaultName", { n: layer }));

const modsText = (t: T, mask: number) =>
  // loop: NOT-WORTH — N = 4 modifiers, per target shown
  MOD_KEYS.filter((m) => (leftMods(mask) & MOD[m]) !== 0).map((m) => t(`desktop.buttons.mod.${m}`));
const keyText = (t: T, target: Target) => [...modsText(t, target.b), ...(target.a ? [keyName(target.a)] : [])].join(" + ");

// What a target does, in plain words ("Triangle", "Ctrl + F5", "Mouse left", "Vehicle (while held)").
export function targetName(t: T, part: ButtonPart, target: Target): string {
  switch (target.kind) {
    case TARGET_KIND.button:
      return sourceName(t, target.a);
    case TARGET_KIND.key:
      return t("desktop.buttons.target.keyText", { key: keyText(t, target) });
    case TARGET_KIND.mouseButton:
      return t(`desktop.buttons.mouse.${MOUSE_BUTTONS[target.a - 1] ?? "left"}`);
    case TARGET_KIND.mouseMove:
      return t(`desktop.buttons.move.${MOTIONS[target.a] ?? "up"}`);
    case TARGET_KIND.layer:
      return t("desktop.buttons.target.layerText", { name: layerName(t, part, target.a), mode: t(`desktop.buttons.layerMode.${target.b === 1 ? "switch" : "held"}`) });
    case TARGET_KIND.gyro:
      return t(`desktop.buttons.gyro.${GYRO_MODES[target.a] ?? "held"}`);
    default:
      return t("remap.disabled");
  }
}

// The short form on a badge ("△", "F5", "Mouse left", "Vehicle", "Off").
export function targetShort(t: T, part: ButtonPart, target: Target): string {
  switch (target.kind) {
    case TARGET_KIND.button:
      return shortName(t, target.a);
    case TARGET_KIND.key:
      return keyText(t, target);
    case TARGET_KIND.layer:
      return layerName(t, part, target.a);
    case TARGET_KIND.none:
      return t("desktop.layouts.off");
    default:
      return targetName(t, part, target);
  }
}

// A changed button's sentence in the Changed list: "Cross → Triangle".
export function changedLine(t: T, part: ButtonPart, layer: number, source: number): string {
  const e = entryAt(part, layer, source);
  const press = e?.press ?? itself(source);
  const to = press ? targetName(t, part, press) : t("desktop.layouts.extraSelf");
  return t("desktop.buttons.changedLine", { from: sourceName(t, source), to: hasExtras(e) ? `${to} …` : to });
}

// The drawing's badges for a layer (§2.1): changed buttons only, "→ △", a dot
// when the button does more than a Press; in a layer, same-as-base buttons
// show the base's badge dimmed; a button that enters a layer wears its colour.
export interface Badge {
  text: string;
  title: string;
  dim?: boolean;
  dot?: boolean;
  colour?: number; // a layer colour (0..5)
}
export function layoutBadges(t: T, part: ButtonPart, layer: number): Map<PartId, Badge> {
  const out = new Map<PartId, Badge>();
  const own = new Set(changedSources(part, layer));
  const shown = layer === 0 ? own : new Set([...own, ...changedSources(part, 0)]);
  // loop: NOT-WORTH — N ≤ 22 changed buttons, when the layout or the tab changes (useMemo)
  for (const s of shown) {
    const e = effectiveEntry(part, layer, s);
    if (!e) continue;
    const press = e.press ?? itself(s);
    // A layer entry that is "itself" again shows as itself, plainly.
    if (layer > 0 && own.has(s) && press && !hasExtras(e) && sameTarget(press, itself(s) ?? press) && !entryAt(part, 0, s)) continue;
    // loop: NOT-WORTH — N = 4 rows
    const enters = [e.press, e.hold, e.double, e.withPs].find((x) => x?.kind === TARGET_KIND.layer);
    out.set(SOURCE_PART[s], {
      text: `→ ${press ? targetShort(t, part, press) : t("desktop.layouts.extraSelf")}`,
      title: changedLine(t, part, layer, s),
      dim: layer > 0 && !own.has(s),
      dot: hasExtras(e),
      colour: enters ? part.layers[enters.a - 1]?.colour : undefined,
    });
  }
  return out;
}
