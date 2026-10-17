// Setup at a glance, on a game's page and on Games → Home: what needs the
// player (the section's yellow dot, open on a first visit) and what already
// passed (one "All set" line that opens to the details). A fully set-up game,
// or computer, shows one line, not a wall of checkmarks. A game's HDR
// checklist is its own section (hdrOk), not part of Setup.
import { protonApplies } from "../games/platform";
import { hdrSystemReqs, type HdrReq } from "../games/hdrSetup";
import { allFixes, type GameEntry, type GamesReport } from "../games/types";

export interface SetupStatus {
  attention: boolean; // anything in Setup for the player to do: its yellow dot
  hdrOk: boolean; // every HDR requirement ✓ (or not an HDR game); else HDR's yellow dot
  passed: number; // ✓ lines in Setup's folded list
}

export function setupStatus(game: Pick<GameEntry, "fixes" | "gamepad" | "mode">, hdrReqs: HdrReq[]): SetupStatus {
  // loop: HOT-PATH-OK — N ≈ 6 HDR requirements; per game page render
  const hdrOk = hdrReqs.every((r) => r.ok);
  const attention = game.fixes.length > 0 || game.gamepad === "no-build" || game.mode?.state === "own";
  const passed = (game.gamepad === "set" ? 1 : 0) + (game.mode?.state === "set" ? 1 : 0);
  return { attention, hdrOk, passed };
}

// This computer's HDR checklist (Home). gamescope from the Flatpak extension
// only when every launcher found that runs Proton is a Flatpak.
export function systemHdrReqs(report: GamesReport): HdrReq[] {
  // loop: HOT-PATH-OK — N ≤ 4 launchers; Home and game page render
  const protonLaunchers = report.launchers.filter((l) => l.found && (l.id === "steam" || l.id === "heroic" || l.id === "lutris"));
  // loop: HOT-PATH-OK — N ≤ 3 Proton launchers
  const flatpak = protonLaunchers.length > 0 && protonLaunchers.every((l) => l.flatpak);
  return hdrSystemReqs(report.system.hdr, { ourProton: report.ourProton.name, flatpak });
}

// Games → Home: which sections need the player (their yellow dots; the
// panel's line says "Needs attention" while any does).
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
  // loop: HOT-PATH-OK — fixes found by the scan, tens at most; Home render
  const fixes = allFixes(report).some((f) => !declined.has(f.id));
  const proton = linux && (!report.ourProton.name || (report.ourProton.updateAvailable && !!report.ourProton.latest));
  const system = linux && (s.proAudio || s.hidrawAccess === false || s.envWarnings.length > 0);
  // loop: HOT-PATH-OK — games (hundreds) until one has HDR, then ≤ 4 HDR checks; Home render
  const hdr = linux && report.games.some((g) => g.hdr !== undefined) && !systemHdrReqs(report).every((r) => r.ok);
  return { attention: fixes || proton || system || hdr, fixes, proton, system, hdr };
}
