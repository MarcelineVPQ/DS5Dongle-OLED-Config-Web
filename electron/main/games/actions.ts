// Game page actions: launch a game, or open its launcher pages and folders.
// Everything here is built in the main process from the last scan (a game
// key, never a URL or a path from the page): the launcher's own link scheme
// for launching and its settings pages, the scanned folders for opening.
import { GAME_ACTIONS, type GameAction, type GameEntry } from "../../../src/desktop/games/types";

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
  if (game.launcher === "lutris" && action === "play" && lutrisSlug && /^[\w.-]+$/.test(lutrisSlug)) return `lutris:rungame/${lutrisSlug}`;
  return null;
}

// Which actions a game has (for the page's buttons).
export function availableActions(game: Pick<GameEntry, "launcher" | "store" | "id">, has: { installDir: boolean; prefixDir: boolean; lutrisSlug?: string }): GameAction[] {
  return GAME_ACTIONS.filter((a) => (a === "installFolder" ? has.installDir : a === "prefixFolder" ? has.prefixDir : actionUrl(game, a, has.lutrisSlug) !== null));
}
