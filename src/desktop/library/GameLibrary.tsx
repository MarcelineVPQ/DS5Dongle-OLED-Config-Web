// The Games tab as a library (like Steam's): on the left an index of the
// games, a plain A–Z list (◆ a profile) with search; then Home or one game's
// page, each with its accordion at the right like every page. Home's main
// view: Continue playing (the games played last, with Play), the Library (the
// filters with their counts, sort and Show, over the cover grid) and, after
// it, This computer; its sections are game setup (GamesPage.tsx). The list
// and the grid follow the same search, filter and Show; the list stays A–Z,
// the grid takes the sort. Narrow (the panel a drawer), the list is the
// library: the grid and its sort aren't shown (IA audit Q6).
// Home stays mounted while a game is open, so switching back doesn't rescan;
// a deep link into Home's sections (the rail's Games count) shows Home again.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MenuButton } from "../MenuButton";
import { Check } from "lucide-react";
import { SplitView } from "../accordion/Section";
import { revealSection, type Accordion } from "../accordion/useAccordion";
import type { Waiting } from "./waiting";
import { protonApplies } from "../games/platform";
import { LauncherIcon, hasLauncherIcon } from "./LauncherIcon";
import { readPref, useFlagPref, usePref, writePref } from "../storage";
import { GLASS_KEY } from "../glass/glassPref";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { APP_KINDS, ART_SHOWN, type AppKind, artUrl, type GameEntry, type GameInfo, type GamesReport } from "../games/types";
import type { LibraryFile } from "../games/library";
import GamePage from "./GamePage";
import { GameTile } from "./GameTile";
import { ContinuePlaying, continueCount } from "./ContinuePlaying";
import { supportOf } from "./support";
import { sharedTitleKeys } from "./sharedTitles";
import { logged } from "../../errorText";

const FILTERS = ["all", "profile", "dualsense", "attention"] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ["name", "recent", "played"] as const;
type Sort = (typeof SORTS)[number];
const SORT_KEY = "ds5.librarySort";
const HIDDEN_KEY = "ds5.libraryHiddenKinds";
export const kindOfGame = (g: GameEntry): AppKind => g.kind ?? "game";

// Categories the player unticked in "Show" (everything shows by default).
function useHiddenKinds(): [Set<AppKind>, (kind: AppKind, shown: boolean) => void] {
  const [hidden, setHidden] = useState<Set<AppKind>>(() => {
    const saved = (readPref(HIDDEN_KEY) ?? "").split(",");
    return new Set(APP_KINDS.filter((k) => saved.includes(k)));
  });
  const toggle = (kind: AppKind, shown: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (shown) next.delete(kind);
      else next.add(kind);
      writePref(HIDDEN_KEY, [...next].join(","));
      return next;
    });
  return [hidden, toggle];
}

// Home's accordion (game setup): its state, the panel's title, a note above
// the sections and the sections themselves (null until the first scan); and
// the readouts at the top of Home's main view (This computer, a MainBlock),
// with its last deep link (a link to it shows Home too).
export interface HomePanel {
  acc: Accordion;
  title: string;
  sub: string;
  top?: ReactNode;
  sections: ReactNode;
  blocks?: ReactNode;
  blockLink?: unknown;
  // The recommended changes waiting (library/waiting.ts): "Games that need
  // setup" counts the games, This computer's chip its own changes.
  waiting: Waiting;
}

interface Props {
  report: GamesReport | null;
  home: HomePanel;
  bridge: UseDs5BridgeResult;
  onRescan: () => void;
  library: LibraryFile;
  onLibrary: (file: LibraryFile) => void;
  running: string | null;
  // Open this game's page once (back from editing its profile); a new
  // request object each time, so the same game can be asked for again.
  openGame?: { key: string } | null;
}

export default function GameLibrary({ report, home, bridge, onRescan, library, onLibrary, running, openGame }: Props) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [details, setDetails] = useState<Record<string, GameInfo>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = usePref<Sort>(SORT_KEY, "name", SORTS);
  const [hiddenKinds, setKindShown] = useHiddenKinds();
  // The Glass look: the tiles' captions and Play bars as glass over their art.
  const [glass] = useFlagPref(GLASS_KEY);
  // The categories this library has, with counts (the Show menu lists only these).
  const kindCounts = useMemo(() => {
    const m = new Map<AppKind, number>();
    // loop: HOT-PATH-OK — N = games (hundreds); memoized on the scan report
    for (const g of report?.games ?? []) m.set(kindOfGame(g), (m.get(kindOfGame(g)) ?? 0) + 1);
    // loop: HOT-PATH-OK — N = 7 app kinds; memoized on the scan report
    return APP_KINDS.filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
  }, [report]);
  const listRef = useRef<HTMLUListElement>(null);
  // Adjusting state on a prop change during render (React's pattern), not in an effect.
  const [handledOpen, setHandledOpen] = useState<{ key: string } | null>(null);
  if (openGame && openGame !== handledOpen) {
    setHandledOpen(openGame);
    setSelected(openGame.key);
  }
  // A deep link into Home's sections or its main-view blocks shows Home.
  const [handledLink, setHandledLink] = useState(home.acc.revealed);
  if (home.acc.revealed !== handledLink) {
    setHandledLink(home.acc.revealed);
    setSelected(null);
  }
  const [handledBlockLink, setHandledBlockLink] = useState(home.blockLink);
  if (home.blockLink !== handledBlockLink) {
    setHandledBlockLink(home.blockLink);
    setSelected(null);
  }

  // lifetime: OK — acquires nothing (one IPC read of the game details)
  useEffect(() => {
    if (report) void desktop.gamesDetails().then(setDetails, logged("reading play time and art details (the tiles show without them)"));
  }, [desktop, report]);

  const games = useMemo(() => {
    const by = (g: GameEntry) => (sort === "recent" ? (details[g.key]?.lastPlayed ?? 0) : sort === "played" ? (details[g.key]?.playtimeMin ?? 0) : 0);
    // loop: HOT-PATH-OK — sort of the games (hundreds); memoized on report, sort and details
    return [...(report?.games ?? [])].sort((a, b) => by(b) - by(a) || a.title.localeCompare(b.title));
  }, [report, sort, details]);
  // Rows whose name another row also has (one game in two launchers) say their launcher.
  const shared = useMemo(() => sharedTitleKeys(report?.games ?? []), [report]);
  // Continue playing: the games played last (with artwork).
  const recent = useMemo(() => {
    // loop: HOT-PATH-OK — games (hundreds) filtered+sorted to 8; memoized on report and details
    const played = (report?.games ?? [])
      .filter((g) => !hiddenKinds.has(kindOfGame(g)) && details[g.key]?.lastPlayed && details[g.key].art.length > 0)
      .sort((a, b) => (details[b.key].lastPlayed ?? 0) - (details[a.key].lastPlayed ?? 0));
    return played.slice(0, continueCount(played.length));
  }, [report, details, hiddenKinds]);
  // Search and Show first; each filter's count is how many it would show.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    // loop: HOT-PATH-OK — N = games (hundreds); memoized, reruns per search keystroke or filter
    return games.filter((g) => (!q || g.title.toLowerCase().includes(q)) && !hiddenKinds.has(kindOfGame(g)));
  }, [games, query, hiddenKinds]);
  // loop: NOT-WORTH — N = games with a change waiting (tens); memoized on what's waiting
  const waitingGames = useMemo(() => new Set(home.waiting.games.map((w) => w.key)), [home.waiting]);
  const pcChanges = home.waiting.pc.length;
  const matches = (f: Filter, g: GameEntry) =>
    f === "profile" ? !!library.games[g.key]?.profile : f === "dualsense" ? g.support === "triggers" || g.support === "haptics" : f === "attention" ? waitingGames.has(g.key) : true;
  // loop: HOT-PATH-OK — N = visible games (hundreds); per library render (interaction)
  const visible = searched.filter((g) => matches(filter, g));
  // The sidebar: a plain A–Z list of what the search, filter and Show leave
  // (IA audit Q6: the filter chips do the grouping; ◆ marks a profile, the
  // running game says so). The grid keeps the chosen sort.
  // loop: HOT-PATH-OK — sort of the visible games (hundreds); per library render (interaction), like the filters above
  const side = [...visible].sort((a, b) => a.title.localeCompare(b.title));
  // loop: HOT-PATH-OK — N = games (hundreds); per library render (interaction)
  const game = games.find((g) => g.key === selected) ?? null;

  // ↑/↓ through the list (in the order shown), Home/End to the ends.
  // loop: HOT-PATH-OK — N = visible games (hundreds); per library render (interaction)
  const order = side.map((g) => g.key);
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || order.length === 0) return;
    e.preventDefault();
    const at = selected ? order.indexOf(selected) : -1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : e.key === "ArrowDown" ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1);
    setSelected(order[next]);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(order[next])}"]`)?.focus();
  };

  const row = (g: GameEntry) => {
    const s = supportOf(g);
    const status = g.fixes.length || g.runnerMissing ? "⚠" : s.tier === "verified" || s.tier === "works" ? "✓" : "";
    return (
      <li key={g.key}>
        <button type="button" data-key={g.key} data-store={g.store} className={`lib-row${selected === g.key ? " sel" : ""}`} aria-current={selected === g.key} onClick={() => setSelected(g.key)}>
          {details[g.key]?.art.includes("icon") ? (
            <img src={artUrl(g.key, "icon", ART_SHOWN.rowIcon())} alt="" />
          ) : details[g.key]?.art.includes("cover") ? (
            <img src={artUrl(g.key, "cover", ART_SHOWN.rowIcon())} alt="" />
          ) : (
            <span className="lib-glyph" title={t(`desktop.library.storeName.${g.store}`)}>
              {hasLauncherIcon(g.store) ? <LauncherIcon id={g.store} /> : hasLauncherIcon(g.launcher) ? <LauncherIcon id={g.launcher} /> : STORE_GLYPH[g.store]}
            </span>
          )}
          <span className="lib-title" title={g.title}>
            {g.title}
          </span>
          {(g.kind || shared.has(g.key)) && (
            <span className="lib-chips">
              {g.kind && (
                <span className="lib-kind" title={t(`desktop.library.kind.${g.kind}`)}>
                  {t(`desktop.library.kind.${g.kind}`)}
                </span>
              )}
              {shared.has(g.key) && (
                <span className="lib-kind" data-launcher={g.launcher} title={t(`desktop.library.launcherName.${g.launcher}`)}>
                  {t(`desktop.library.launcherName.${g.launcher}`)}
                </span>
              )}
            </span>
          )}
          {g.key === running && <span className="lib-playing">{t("desktop.library.running")}</span>}
          {library.games[g.key]?.profile && (
            <span className="lib-mark" title={t("desktop.library.hasProfile")}>
              ◆
            </span>
          )}
          {status && (
            <span className="lib-mark" title={status === "⚠" ? t("desktop.library.needsAttention") : t(`desktop.library.tier.${s.tier}`)}>
              {status}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="lib">
      <aside className="lib-side">
        <button type="button" className={`lib-home${selected === null ? " sel" : ""}`} onClick={() => setSelected(null)}>
          ⌂ {t("desktop.library.home")}
        </button>
        <input
          className="dk-input lib-search"
          type="search"
          placeholder={t("desktop.library.search")}
          aria-label={t("desktop.library.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {filter !== "all" && (
          <p className="dk-hint lib-filtered">
            {t("desktop.library.filteredBy", { filter: t(`desktop.library.filters.${filter}`) })}
            <button type="button" className="dk-btn dk-inline-btn" onClick={() => setFilter("all")}>
              {t("desktop.library.showAll")}
            </button>
          </p>
        )}
        <ul className="lib-list" ref={listRef} onKeyDown={onListKey}>
          {/* loop: HOT-PATH-OK — one sidebar row per visible game (hundreds); per library render */}
          {side.map(row)}
          {report && visible.length === 0 && <li className="dk-hint lib-empty">{t("desktop.library.noMatch")}</li>}
        </ul>
      </aside>
      <div className="lib-main">
        <div hidden={game !== null} className="lib-pane">
          <SplitView
            page="games"
            state={home.acc}
            title={home.title}
            sub={home.sub}
            top={home.top}
            main={
              <div className="lib-home-pane">
                {!report && <p className="dk-hint">{t(protonApplies() ? "desktop.games.scanning" : "desktop.games.scanningWindows")}</p>}
                {report && <ContinuePlaying games={recent} details={details} running={running} hasProfile={(g) => !!library.games[g.key]?.profile} onOpen={setSelected} glass={glass} />}
                {report && (
                  <section className="lib-section">
                    <div className="lib-toolbar">
                      <h2 className="lib-section-title">{t("desktop.library.libraryTitle")}</h2>
                      <div className="lib-filters" role="group" aria-label={t("desktop.library.filter")}>
                        {/* loop: HOT-PATH-OK — N = 4 filters */}
                        {FILTERS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className={`dk-chip${filter === f ? " ok" : ""}`}
                            aria-pressed={filter === f}
                            title={t(`desktop.library.filterHint.${f}`)}
                            onClick={() => setFilter(f)}
                          >
                            {t(`desktop.library.filters.${f}`)}
                            {/* loop: HOT-PATH-OK — 4 filters x searched games (hundreds); per library render */}
                            <span className="lib-count">{searched.filter((g) => matches(f, g)).length}</span>
                          </button>
                        ))}
                      </div>
                      {pcChanges > 0 && (
                        // Changes that aren't a game's (a launcher's default, the controller's audio): counted apart, so
                        // "Games that need setup" plus this add up to the rail's badge. Opens them in Recommended changes.
                        <button type="button" className="dk-chip warn lib-pc" title={t("desktop.library.pcChangesHint")} onClick={() => revealSection("games", "recommended")}>
                          <span className="dot" />
                          {t("desktop.library.pcChanges", { count: pcChanges })}
                        </button>
                      )}
                      <span className="dk-spacer" />
                      <label className="lib-sort">
                        <span>{t("desktop.library.sort")}</span>
                        <select className="dk-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                          {/* loop: HOT-PATH-OK — N = 3 sorts */}
                          {SORTS.map((s) => (
                            <option key={s} value={s}>
                              {t(`desktop.library.sorts.${s}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {kindCounts.length > 1 && (
                        // The Show menu: the app's one popup menu (MenuButton); each kind a checkbox item, the menu stays open while you tick.
                        <MenuButton
                          label={t("desktop.library.show")}
                          title={t("desktop.library.showHint")}
                          className="dk-btn lib-show"
                          align="end"
                          iconOnly={false}
                          content={
                            <>
                              {t("desktop.library.show")}
                              {/* loop: HOT-PATH-OK — N ≤ 7 app kinds */}
                              {hiddenKinds.size > 0 && ` · ${t("desktop.library.hiddenCount", { count: kindCounts.filter(([k]) => hiddenKinds.has(k)).length })}`}
                            </>
                          }
                        >
                          {
                            // loop: HOT-PATH-OK — N ≤ 7 app kinds
                            kindCounts.map(([k, n]) => {
                              const on = !hiddenKinds.has(k);
                              return (
                                <button key={k} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => setKindShown(k, !on)}>
                                  <Check size={14} aria-hidden="true" className={on ? undefined : "dk-menu-off"} />
                                  {t(`desktop.library.kinds.${k}`)} ({n})
                                </button>
                              );
                            })
                          }
                        </MenuButton>
                      )}
                    </div>
                    {visible.length > 0 ? (
                      <ul className="lib-grid">
                        {/* loop: HOT-PATH-OK — a tile element per game; GameTile is memo with a stable onOpen, so only changed tiles render (loop pass batch 4) */}
                        {visible.map((g) => (
                          <li key={g.key}>
                            <GameTile game={g} info={details[g.key]} running={g.key === running} hasProfile={!!library.games[g.key]?.profile} onOpen={setSelected} glass={glass} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dk-hint">{t("desktop.library.noMatch")}</p>
                    )}
                  </section>
                )}
                {/* This computer (a readout) after the library: browsing games is the page's task (IA audit G3). */}
                {home.blocks}
              </div>
            }
          >
            {home.sections}
          </SplitView>
        </div>
        {game && report && (
          <GamePage
            key={game.key}
            game={game}
            info={details[game.key]}
            record={library.games[game.key]}
            running={running === game.key}
            report={report}
            bridge={bridge}
            onLibrary={onLibrary}
            onRescan={onRescan}
          />
        )}
      </div>
    </div>
  );
}

const STORE_GLYPH: Record<string, string> = { steam: "S", epic: "E", gog: "G", amazon: "A", sideload: "▣", lutris: "L" };
