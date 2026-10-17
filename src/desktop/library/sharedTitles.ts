// The same game installed through two launchers (Ghostrunner from Heroic's
// GOG and from Lutris) gives two list rows with one name: those rows also
// carry their launcher's name, so they can be told apart. The name is
// compared as shown (case and surrounding spaces ignored).
import type { GameEntry } from "../games/types";

const nameKey = (title: string) => title.trim().toLocaleLowerCase();

// The keys of the games whose name another game in the list also has.
export function sharedTitleKeys(games: readonly Pick<GameEntry, "key" | "title">[]): Set<string> {
  const count = new Map<string, number>();
  // loop: HOT-PATH-OK — N = games (hundreds), two passes; memoized on the scan report
  for (const g of games) count.set(nameKey(g.title), (count.get(nameKey(g.title)) ?? 0) + 1);
  // loop: HOT-PATH-OK — N = games (hundreds), one filter and map; memoized on the scan report
  return new Set(games.filter((g) => (count.get(nameKey(g.title)) ?? 0) > 1).map((g) => g.key));
}
