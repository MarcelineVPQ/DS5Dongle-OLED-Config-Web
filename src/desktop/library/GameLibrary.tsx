// The Games tab as a library (like Steam's): games on the left, grouped
// (Playing, With profile, All games) with search and filters; Home (launcher
// setup and fixes, the old Games page) or one game's page on the right.
// Home stays mounted while a game is open, so switching back doesn't rescan.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LauncherIcon, hasLauncherIcon } from "./LauncherIcon";
import { readPref, usePref, writePref } from "../storage";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { APP_KINDS, type AppKind, type GameEntry, type GameInfo, type GamesReport } from "../games/types";
import { artUrl } from "../games/types";
import type { LibraryFile } from "../games/library";
import GamePage from "./GamePage";
import { GameTile } from "./GameTile";
import { supportOf } from "./support";

type Filter = "all" | "profile" | "dualsense" | "attention";
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

interface Props {
  report: GamesReport | null;
  home: ReactNode;
  bridge: UseDs5BridgeResult;
  onRescan: () => void;
  library: LibraryFile;
  onLibrary: (file: LibraryFile) => void;
  running: string | null;
}

export default function GameLibrary({ report, home, bridge, onRescan, library, onLibrary, running }: Props) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [details, setDetails] = useState<Record<string, GameInfo>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = usePref<Sort>(SORT_KEY, "name", SORTS);
  const [hiddenKinds, setKindShown] = useHiddenKinds();
  // The categories this library has, with counts (the Show menu lists only these).
  const kindCounts = useMemo(() => {
    const m = new Map<AppKind, number>();
    for (const g of report?.games ?? []) m.set(kindOfGame(g), (m.get(kindOfGame(g)) ?? 0) + 1);
    return APP_KINDS.filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
  }, [report]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (report) void desktop.gamesDetails().then(setDetails, () => undefined);
  }, [desktop, report]);

  const games = useMemo(() => {
    const by = (g: GameEntry) => (sort === "recent" ? (details[g.key]?.lastPlayed ?? 0) : sort === "played" ? (details[g.key]?.playtimeMin ?? 0) : 0);
    return [...(report?.games ?? [])].sort((a, b) => by(b) - by(a) || a.title.localeCompare(b.title));
  }, [report, sort, details]);
  // Home's shelf: the most recently played games with artwork.
  const recent = useMemo(
    () =>
      (report?.games ?? [])
        .filter((g) => !hiddenKinds.has(kindOfGame(g)) && details[g.key]?.lastPlayed && (details[g.key].art.includes("cover") || details[g.key].art.includes("header")))
        .sort((a, b) => (details[b.key].lastPlayed ?? 0) - (details[a.key].lastPlayed ?? 0))
        .slice(0, 8),
    [report, details, hiddenKinds],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return games.filter((g) => {
      if (q && !g.title.toLowerCase().includes(q)) return false;
      if (hiddenKinds.has(kindOfGame(g))) return false;
      if (filter === "profile") return !!library.games[g.key]?.profile;
      if (filter === "dualsense") return g.support === "triggers" || g.support === "haptics";
      if (filter === "attention") return g.fixes.length > 0 || g.runnerMissing;
      return true;
    });
  }, [games, query, filter, library, hiddenKinds]);
  const playing = visible.filter((g) => g.key === running);
  const withProfile = visible.filter((g) => g.key !== running && library.games[g.key]?.profile);
  const rest = visible.filter((g) => g.key !== running && !library.games[g.key]?.profile);
  const game = games.find((g) => g.key === selected) ?? null;

  // ↑/↓ through the list (in the order shown), Home/End to the ends.
  const order = [...playing, ...withProfile, ...rest].map((g) => g.key);
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
        <button type="button" data-key={g.key} className={`lib-row${selected === g.key ? " sel" : ""}`} aria-current={selected === g.key} onClick={() => setSelected(g.key)}>
          {details[g.key]?.art.includes("icon") ? (
            <img src={artUrl(g.key, "icon")} alt="" />
          ) : details[g.key]?.art.includes("cover") ? (
            <img src={artUrl(g.key, "cover")} alt="" />
          ) : (
            <span className="lib-glyph" title={t(`desktop.library.storeName.${g.store}`)}>
              {hasLauncherIcon(g.store) ? <LauncherIcon id={g.store} /> : hasLauncherIcon(g.launcher) ? <LauncherIcon id={g.launcher} /> : STORE_GLYPH[g.store]}
            </span>
          )}
          <span className="lib-title" title={g.title}>
            {g.title}
          </span>
          {g.kind && <span className="lib-kind">{t(`desktop.library.kind.${g.kind}`)}</span>}
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
  const group = (label: string, list: GameEntry[]) =>
    list.length > 0 && (
      <>
        <li className="lib-group">
          {label} ({list.length})
        </li>
        {list.map(row)}
      </>
    );

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
        <div className="lib-filters" role="group" aria-label={t("desktop.library.filter")}>
          {(["all", "profile", "dualsense", "attention"] as const).map((f) => (
            <button key={f} type="button" className={`dk-chip${filter === f ? " ok" : ""}`} aria-pressed={filter === f} title={t(`desktop.library.filterHint.${f}`)} onClick={() => setFilter(f)}>
              {t(`desktop.library.filters.${f}`)}
            </button>
          ))}
        </div>
        <label className="lib-sort">
          <span>{t("desktop.library.sort")}</span>
          <select className="dk-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`desktop.library.sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {kindCounts.length > 1 && (
          <details className="lib-show">
            <summary className="dk-btn" title={t("desktop.library.showHint")}>
              {t("desktop.library.show")}
              {hiddenKinds.size > 0 && ` · ${t("desktop.library.hiddenCount", { count: kindCounts.filter(([k]) => hiddenKinds.has(k)).length })}`}
            </summary>
            <div className="lib-show-menu">
              {kindCounts.map(([k, n]) => (
                <label key={k} className="lib-show-item">
                  <input type="checkbox" checked={!hiddenKinds.has(k)} onChange={(e) => setKindShown(k, e.target.checked)} />
                  {t(`desktop.library.kinds.${k}`)} ({n})
                </label>
              ))}
            </div>
          </details>
        )}
        <ul className="lib-list" ref={listRef} onKeyDown={onListKey}>
          {group(t("desktop.library.groupPlaying"), playing)}
          {group(t("desktop.library.groupProfile"), withProfile)}
          {group(t("desktop.library.groupAll"), rest)}
          {report && visible.length === 0 && <li className="dk-hint lib-empty">{t("desktop.library.noMatch")}</li>}
        </ul>
      </aside>
      <div className="lib-main">
        <div hidden={game !== null} className="lib-home-pane">
          {report && (
            <section className="lib-shelf-wrap">
              <p className="lib-summary">
                {t("desktop.library.summary", {
                  games: report.games.length,
                  dualsense: report.games.filter((g) => g.support === "triggers" || g.support === "haptics").length,
                  profiles: report.games.filter((g) => library.games[g.key]?.profile).length,
                })}
              </p>
              {recent.length > 0 && (
                <>
                  <h2 className="lib-shelf-title">{t("desktop.library.recent")}</h2>
                  <ul className="lib-shelf">
                    {recent.map((g) => (
                      <li key={g.key}>
                        <GameTile game={g} info={details[g.key]} running={g.key === running} hasProfile={!!library.games[g.key]?.profile} onOpen={() => setSelected(g.key)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {home}
          {report && visible.length > 0 && (
            <section className="lib-shelf-wrap">
              <h2 className="lib-shelf-title">
                {t("desktop.library.groupAll")} ({visible.length}){visible.length < games.length && <span className="dk-hint"> · {t("desktop.library.gridFiltered")}</span>}
              </h2>
              <ul className="lib-grid">
                {visible.map((g) => (
                  <li key={g.key}>
                    <GameTile game={g} info={details[g.key]} running={g.key === running} hasProfile={!!library.games[g.key]?.profile} onOpen={() => setSelected(g.key)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
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
