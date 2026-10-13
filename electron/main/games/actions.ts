// Game page actions: launch a game, or open its launcher pages and folders.
// Everything here is built in the main process from the last scan (a game
// key, never a URL or a path from the page): the launcher's own link scheme
// for launching and its settings pages, the scanned folders for opening.
import { basename, isAbsolute } from "node:path";
import { GAME_ACTIONS, type GameAction, type GameEntry, type LauncherId } from "../../../src/desktop/games/types";
import { FLATPAK_ID, type ReopenPlan } from "./processes";

// Heroic's runner names for its stores.
const HEROIC_RUNNER: Record<string, string> = { epic: "legendary", gog: "gog", amazon: "nile", sideload: "sideload" };

// The launcher link for a URL action, or null when that launcher has none.
export function actionUrl(game: Pick<GameEntry, "launcher" | "store" | "id">, action: GameAction, lutrisSlug?: string): string | null {
  const id = encodeURIComponent(game.id);
  if (game.launcher === "steam") {
    if (!/^\d+$/.test(game.id)) return null;
    if (action === "play") return `steam://rungameid/${id}`;
    if (action === "properties") return `steam://gameproperties/${id}`;
    if (action === "steamInput") return `steam://controllerconfig/${id}`;
    if (action === "libraryPage") return `steam://nav/games/details/${id}`;
    return null;
  }
  if (game.launcher === "heroic" && action === "play") {
    const runner = HEROIC_RUNNER[game.store];
    return runner ? `heroic://launch?appName=${id}&runner=${runner}` : null;
  }
  // GOG Galaxy: its game page (it has no plain launch link); Epic: launch.
  if (game.launcher === "gog" && /^\d+$/.test(game.id)) return action === "libraryPage" ? `goggalaxy://openGameView/${id}` : null;
  if (game.launcher === "epic" && /^[\w.-]+$/.test(game.id)) return action === "play" ? `com.epicgames.launcher://apps/${id}?action=launch&silent=true` : null;
  if (game.launcher === "lutris" && action === "play" && lutrisSlug && /^[\w.-]+$/.test(lutrisSlug)) return `lutris:rungame/${lutrisSlug}`;
  return null;
}

// Which actions a game has (for the page's buttons).
export function availableActions(game: Pick<GameEntry, "launcher" | "store" | "id">, has: { installDir: boolean; prefixDir: boolean; lutrisSlug?: string }): GameAction[] {
  return GAME_ACTIONS.filter((a) => (a === "installFolder" ? has.installDir : a === "prefixFolder" ? has.prefixDir : actionUrl(game, a, has.lutrisSlug) !== null));
}

// ---- ▶ Play with the launcher staying in the background ----
//
// Opening a game's link starts a launcher that isn't running with its whole
// window. So when the game's launcher is closed, ▶ Play starts it the way
// its own shortcuts do, with the game and without the window: Steam with
// `-silent` (the tray), Heroic with `--no-gui` (Heroic's desktop and Steam
// shortcuts; it quits again when the game ends). A launcher that is already
// running gets the plain link (null here): we never pass Heroic's `gui=false`,
// which hides a window the player has open. Lutris's rungame link never shows
// its window (running or not), Epic's link has `silent=true`, so they keep
// the link too.

export interface QuietPlaySystem {
  platform: NodeJS.Platform;
  running(): Set<LauncherId> | Promise<Set<LauncherId>>;
  flatpak: boolean; // the game's launcher install is the Flatpak one
  heroicHandler(): Promise<string[] | null>; // Linux: the heroic:// handler's Exec words
  exists(path: string): boolean;
  steamExe(): string | null; // Windows: <SteamPath>\steam.exe
  heroicExe(): string | null; // Windows: the installed Heroic.exe
}

// The words of a desktop entry's Exec value (quoting per the Desktop Entry
// spec), without field codes (%U, %f…).
export function execWords(exec: string): string[] {
  const words: string[] = [];
  for (const m of exec.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]);
  return words.filter((w) => !/^%[a-zA-Z]$/.test(w));
}

// Heroic's program from its link handler's Exec: the Flatpak, or a native
// or AppImage program by its absolute path, checked to be Heroic's (its file
// name) and to exist; otherwise `heroic` on PATH. Never its arguments.
export function heroicProgram(exec: string[] | null, exists: (path: string) => boolean): ReopenPlan {
  const [prog = "", ...rest] = exec ?? [];
  if (basename(prog) === "flatpak" && rest.includes(FLATPAK_ID.heroic)) return { cmd: "flatpak", args: ["run", FLATPAK_ID.heroic] };
  if (isAbsolute(prog) && !prog.startsWith("/tmp/") && /^heroic(([-_.][^/]*)?\.appimage)?$/i.test(basename(prog)) && exists(prog)) return { cmd: prog, args: [] };
  return { cmd: "heroic", args: [] };
}

/** How ▶ Play starts a launcher that isn't running, in the background with
 * the game (fixed argv: the program, its flag and the link we built), or
 * null to open the link as before. */
export async function quietPlay(launcher: LauncherId, url: string, sys: QuietPlaySystem): Promise<ReopenPlan | null> {
  if (launcher !== "steam" && launcher !== "heroic") return null;
  if ((await sys.running()).has(launcher)) return null;
  const flag = launcher === "steam" ? "-silent" : "--no-gui";
  if (sys.platform === "win32") {
    const exe = launcher === "steam" ? sys.steamExe() : sys.heroicExe();
    return exe ? { cmd: exe, args: [flag, url] } : null;
  }
  if (sys.platform !== "linux") return null;
  if (sys.flatpak) return { cmd: "flatpak", args: ["run", FLATPAK_ID[launcher], flag, url] };
  const program = launcher === "steam" ? { cmd: "steam", args: [] } : heroicProgram(await sys.heroicHandler(), sys.exists);
  return { cmd: program.cmd, args: [...program.args, flag, url] };
}
