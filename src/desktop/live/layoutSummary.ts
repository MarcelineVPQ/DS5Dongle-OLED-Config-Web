// What a button layout changes, in words ("Cross → Circle · L1 → Off"), for
// the layouts list and a game profile's layout picker.
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED } from "../../protocol/remap";

export const buttonLabel = (i: number) => REMAP_BUTTON_OPTIONS[i]?.label ?? String(i);

export function layoutChanges(table: number[], off: string): Array<{ from: string; to: string }> {
  return table.flatMap((target, source) => (target === source ? [] : [{ from: buttonLabel(source), to: target === REMAP_DISABLED ? off : buttonLabel(target) }]));
}

export function layoutSummary(table: number[], off: string, none: string): string {
  const changes = layoutChanges(table, off);
  return changes.length ? changes.map((c) => `${c.from} → ${c.to}`).join(" · ") : none;
}
