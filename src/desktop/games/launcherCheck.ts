// The running launchers a review names, and changes a launcher took back.
//
// A scan's `running` can be minutes old (Home stays mounted; a launcher may
// have started since), so a review asks the main process again when it
// opens: the notice "Heroic will be closed…" is then right the first time.
// The main process checks once more before writing and refuses when a
// launcher it wasn't told about runs (the page then names it and asks again).
import { useEffect, useState } from "react";
import type { CloseProblem, Fix, GamesReport, LauncherId, RestartList } from "./types";

// Running launchers, checked again whenever `key` changes (the caller makes
// one per review opened and per scan; null: no review open). Undefined while
// the check runs; null when there's no answer (the scan's answer stays; the
// main process checks again anyway).
export function useFreshRunning(key: string | null): LauncherId[] | null | undefined {
  const [running, setRunning] = useState<{ key: string; list: LauncherId[] | null } | null>(null);
  // lifetime: OK — cleanup: drops a late answer (holds no resource)
  useEffect(() => {
    if (key === null || !window.desktop) return;
    let live = true;
    // error: NOT-WORTH — unknown (null): Apply's own check in the main process still names a running launcher (desktop.games.launcherStarted)
    window.desktop.gamesRunningLaunchers().then(
      (list) => live && setRunning({ key, list }),
      () => live && setRunning({ key, list: null }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  if (key === null || !window.desktop) return null;
  return running?.key === key ? running.list : undefined;
}

// Running launchers that own these changes: the page says they'll be closed
// and reopened, and names them in the request (the main process closes only
// those). `running`: a fresh check (useFreshRunning), else the scan's answer.
export function restartFor(report: GamesReport, fixes: Fix[], running?: LauncherId[] | null): RestartList {
  // loop: HOT-PATH-OK — N = one game's fixes (≤ ~5)
  const owners = new Set<string>(fixes.map((f) => f.launcher));
  // loop: HOT-PATH-OK — N = 3 launchers
  const now = running ? new Set(running) : new Set(report.launchers.filter((l) => l.running).map((l) => l.id));
  // loop: HOT-PATH-OK — N = 3 launchers
  return (["steam", "heroic", "lutris"] as const).filter((id) => now.has(id) && owners.has(id));
}

// A launcher the page didn't name runs (started since the check): nothing was
// written; the review now names it, and Apply asks again.
// error: SHOWN — desktop.games.launcherStarted (an input here; the text comes from useRestartText)
export const startedSinceCheck = (r: { blockedBy?: LauncherId[]; problem?: CloseProblem }) => !!r.blockedBy?.length && !r.problem;

// ---- A change the launcher wrote back ----
// A launcher that keeps a game's settings in memory can save its old copy
// over ours. A change applied this session that a later scan recommends
// again was taken back: the page says which launcher did it.
const RECENT_MS = 15 * 60_000;
// cache: OK — key=fix id; invalidated=cleared on Undo, entries older than RECENT_MS are ignored, not removed; bound=distinct fix ids applied this session
const applied = new Map<string, number>(); // fix id → when it was applied

export function rememberApplied(ids: string[], now = Date.now()): void {
  for (const id of ids) applied.set(id, now);
}

// After an Undo the changes are back on purpose.
export function forgetApplied(): void {
  applied.clear();
}

// Launchers (Steam, Heroic, Lutris) whose files lost a change applied in the last minutes.
export function overwrittenBy(fixes: Fix[], now = Date.now()): LauncherId[] {
  const out = new Set<LauncherId>();
  // loop: HOT-PATH-OK — N = one game's fixes (≤ ~5)
  for (const f of fixes) {
    const at = applied.get(f.id);
    if (at !== undefined && now - at < RECENT_MS && (f.launcher === "steam" || f.launcher === "heroic" || f.launcher === "lutris")) out.add(f.launcher);
  }
  return [...out];
}
