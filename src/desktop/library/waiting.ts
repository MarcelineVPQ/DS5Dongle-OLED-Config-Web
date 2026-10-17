// The recommended changes still waiting (not declined), split by what they
// are for: each game's own, and this computer's (a launcher's default, the
// controller's audio: anything without a game). One split for every place
// that counts or names them, so the numbers never contradict: the rail's
// Games badge (games + this computer), Library's "Games that need setup"
// chip (games only), its This computer chip, the rail's tooltip and
// Recommended changes' groups. Pure, so the rules are tested without the app.
import type { TFunction } from "i18next";
import { shownText } from "../shownError";
import type { Fix, GamesReport, Msg } from "../games/types";

export interface WaitingGame {
  key: string;
  title: string;
  labels: Msg[];
}

export interface Waiting {
  games: WaitingGame[]; // in the scan's order
  pc: Msg[]; // this computer's: launchers first, then the system's
}

export const NO_WAITING: Waiting = { games: [], pc: [] };

// A change still waiting: recommended, and the player hasn't unticked it.
export const isWaiting = (f: Fix, declined: ReadonlySet<string>): boolean => f.recommended && !declined.has(f.id);

export function waitingChanges(r: GamesReport, declined: ReadonlySet<string>): Waiting {
  // loop: HOT-PATH-OK — one game's or launcher's fixes (a few); once per scan or untick
  const labels = (fixes: Fix[]) => fixes.filter((f) => isWaiting(f, declined)).map((f) => f.label);
  // loop: HOT-PATH-OK — N = games (hundreds) x their fixes (a few); once per scan or untick
  const games = r.games.map((g) => ({ key: g.key, title: g.title, labels: labels(g.fixes) })).filter((g) => g.labels.length > 0);
  // loop: NOT-WORTH — N ≤ 3 launchers; once per scan or untick
  return { games, pc: [...r.launchers.flatMap((l) => labels(l.fixes)), ...labels(r.system.fixes)] };
}

// The rail's Games badge: one per game with a change waiting, plus each of
// this computer's changes (the two chips in Library add up to it).
export const waitingTotal = (w: Waiting): number => w.games.length + w.pc.length;

// A main-process message (Msg, games/types.ts) in the user's language; params may be messages too.
export function msgText(t: TFunction, m: Msg): string {
  // loop: NOT-WORTH — a message's params (≤ 4); per message shown
  const params = Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, typeof v === "string" ? shownText(v) : msgText(t, v)]));
  return t(`desktop.games.msg.${m.key}`, { ...params, interpolation: { escapeValue: false } });
}

// The counts in words, like Library's chips: "8 games · This computer: 2
// changes" (Recommended changes' header while something waits).
export function waitingSplit(t: TFunction, w: Waiting): string {
  const parts = [w.games.length > 0 && t("desktop.games.waiting.games", { count: w.games.length }), w.pc.length > 0 && t("desktop.library.pcChanges", { count: w.pc.length })];
  // loop: NOT-WORTH — N = 2 parts
  return parts.filter(Boolean).join(" · ");
}

// How many changes the tooltip names before "+N more".
export const WAITING_NAMED = 3;

// What's waiting, by name, in one line: the rail's Games tooltip and its
// badge's. A game's one change by its label (which names the game), a game
// with more as "Game: N changes"; then this computer's, each by its label.
export function waitingText(t: TFunction, w: Waiting): string {
  const entries = [
    // loop: NOT-WORTH — N = games with a change waiting; per tooltip text
    ...w.games.map((g) => (g.labels.length === 1 ? msgText(t, g.labels[0]) : t("desktop.games.waiting.game", { game: g.title, count: g.labels.length, interpolation: { escapeValue: false } }))),
    // loop: NOT-WORTH — N = this computer's changes (≤ ~5); per tooltip text
    ...w.pc.map((m) => msgText(t, m)),
  ];
  const named = entries.slice(0, WAITING_NAMED);
  const more = entries.length - named.length;
  const list = named.join(t("desktop.games.waiting.separator"));
  return t("desktop.games.waiting.task", { list: more > 0 ? `${list} ${t("desktop.games.waiting.more", { count: more })}` : list, interpolation: { escapeValue: false } });
}
