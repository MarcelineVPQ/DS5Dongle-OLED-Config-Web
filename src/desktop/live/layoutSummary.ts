// What a button layout changes, in words ("Cross → Circle · L1 → Off"), for
// the layouts list and a game profile's layout picker.
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED } from "../../protocol/remap";

export const buttonLabel = (i: number) => REMAP_BUTTON_OPTIONS[i]?.label ?? String(i);

export function layoutChanges(table: number[], off: string, extra?: { values: number[]; names: string[] }): Array<{ from: string; to: string }> {
  // loop: HOT-PATH-OK — N = 16 slots per layout, per render of the layouts list
  const base = table.flatMap((target, source) => (target === source ? [] : [{ from: buttonLabel(source), to: target === REMAP_DISABLED ? off : buttonLabel(target) }]));
  // The Edge's Fn buttons and paddles (0xFF itself, 0xFE off).
  // loop: HOT-PATH-OK — N = 4 Edge buttons per layout
  const edge = (extra?.values ?? []).flatMap((v, i) => (v === 0xff ? [] : [{ from: extra!.names[i], to: v === 0xfe ? off : buttonLabel(v) }]));
  return [...base, ...edge];
}

export function layoutSummary(table: number[], off: string, none: string, extra?: { values: number[]; names: string[] }): string {
  const changes = layoutChanges(table, off, extra);
  // loop: HOT-PATH-OK — N ≤ 20 changes per layout
  return changes.length ? changes.map((c) => `${c.from} → ${c.to}`).join(" · ") : none;
}
