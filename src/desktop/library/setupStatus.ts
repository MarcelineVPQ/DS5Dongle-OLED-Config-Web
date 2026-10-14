// Setup at a glance, on a game's page and on Games → Home: what needs the
// player (shown open, first on the page) and what already passed (one "All
// set" line that opens to the details). A fully set-up game, or computer,
// shows one line, not a wall of checkmarks.
import { protonApplies } from "../games/platform";
import { hdrSystemReqs, type HdrReq } from "../games/hdrSetup";
import { allFixes, type GameEntry, type GamesReport } from "../games/types";

export interface SetupStatus {
  attention: boolean; // anything for the player to do: shown open
  hdrOk: boolean; // every HDR requirement ✓ (or not an HDR game): its checklist folds into the passed list
  passed: number; // ✓ lines in the folded list
}

export function setupStatus(game: Pick<GameEntry, "fixes" | "gamepad" | "mode">, hdrReqs: HdrReq[]): SetupStatus {
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

// This computer's HDR checklist (Home). gamescope from the Flatpak extension
// only when every launcher found that runs Proton is a Flatpak.
export function systemHdrReqs(report: GamesReport): HdrReq[] {
  const protonLaunchers = report.launchers.filter((l) => l.found && (l.id === "steam" || l.id === "heroic" || l.id === "lutris"));
  const flatpak = protonLaunchers.length > 0 && protonLaunchers.every((l) => l.flatpak);
  return hdrSystemReqs(report.system.hdr, { ourProton: report.ourProton.name, flatpak });
}

// Games → Home: each part that needs the player shows open at the top (with
// its action); with none, Home is one "Everything is set up" line and the
// library gets the room.
export interface HomeStatus {
  attention: boolean; // any of the below
  fixes: boolean; // a recommended change the player hasn't declined
  proton: boolean; // our Proton missing, or a newer build to install (Linux)
  system: boolean; // a ✗ in This computer: pro-audio, no controller access, an environment variable (Linux)
  hdr: boolean; // an HDR ✗ while the library has an HDR game (Linux; without one, HDR off isn't a problem)
}

export function homeStatus(report: GamesReport, declined: ReadonlySet<string>): HomeStatus {
  const linux = protonApplies();
  const s = report.system;
  const fixes = allFixes(report).some((f) => !declined.has(f.id));
  const proton = linux && (!report.ourProton.name || (report.ourProton.updateAvailable && !!report.ourProton.latest));
  const system = linux && (s.proAudio || s.hidrawAccess === false || s.envWarnings.length > 0);
  const hdr = linux && report.games.some((g) => g.hdr !== undefined) && !systemHdrReqs(report).every((r) => r.ok);
  return { attention: fixes || proton || system || hdr, fixes, proton, system, hdr };
}
