// A game page's Setup at a glance: what needs the player (shown open, first
// on the page) and what already passed (one "All set" line that opens to the
// ✓ list). A fully set-up game shows one line, not a wall of checkmarks.
import { protonApplies } from "../games/platform";
import type { HdrReq } from "../games/hdrSetup";
import type { GameEntry } from "../games/types";

export interface SetupStatus {
  attention: boolean; // anything for the player to do: shown open
  hdrOk: boolean; // every HDR requirement ✓ (or not an HDR game): its checklist folds into the passed list
  passed: number; // ✓ lines in the folded list
}

export function setupStatus(game: Pick<GameEntry, "fixes" | "gamepad" | "mode">, hdrReqs: HdrReq[]): SetupStatus {
  // loop: HOT-PATH-OK — N ≈ 6 HDR requirements; per game page render
  const hdrOk = hdrReqs.every((r) => r.ok);
  const attention = game.fixes.length > 0 || game.gamepad === "no-build" || game.mode?.state === "own" || !hdrOk;
  const passed = (game.gamepad === "set" ? 1 : 0) + (game.mode?.state === "set" ? 1 : 0) + (hdrOk ? hdrReqs.length : 0);
  return { attention, hdrOk, passed };
}

// "Controller not detected" as a mark in Setup (it decides whether the
// standard-gamepad fix is offered): Proton games we don't already know.
// Where it shows there, the rating's feedback list leaves it out.
export function canMarkNotDetected(game: Pick<GameEntry, "support" | "launcher">): boolean {
  const native = game.support === "triggers" || game.support === "haptics";
  return protonApplies() && !native && game.support !== "xinput" && (game.launcher === "steam" || game.launcher === "heroic" || game.launcher === "lutris");
}
