// Home's first row: the games played last, with Play right on them. The
// newest is the big one (its wide art and logo, like its own page's header,
// with when and how long it was played); the next ones are smaller, beside
// it. Opening a tile opens the game's page; Play starts it in its launcher.
import { useTranslation } from "react-i18next";
import type { GameEntry, GameInfo } from "../games/types";
import { artUrl, type ArtKind } from "../games/types";
import { TileOverlays, type TileProps } from "./GameTile";
import { PlayButton, PlayStats, useGameAction } from "./playBar";

// 1 to 3 games: the big one and up to two stacked; 5: the big one and a 2 × 2 block.
export const continueCount = (played: number) => (played >= 5 ? 5 : Math.min(played, 3));

export function ContinuePlaying({
  games,
  details,
  running,
  hasProfile,
  onOpen,
}: {
  games: GameEntry[];
  details: Record<string, GameInfo>;
  running: string | null;
  hasProfile: (g: GameEntry) => boolean;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (games.length === 0) return null;
  const [lead, ...rest] = games;
  const tile = (g: GameEntry) => ({ game: g, info: details[g.key], running: g.key === running, hasProfile: hasProfile(g), onOpen: () => onOpen(g.key) });
  return (
    <section className="lib-section">
      <h2 className="lib-section-title">{t("desktop.library.continue")}</h2>
      <div className={`lib-continue${rest.length === 0 ? " solo" : ""}`}>
        <LeadTile {...tile(lead)} />
        {rest.length > 0 && (
          <ul className={`lib-continue-rest${rest.length > 2 ? " two" : ""}`}>
            {/* loop: HOT-PATH-OK — N ≤ 8 recent games; Home render on library change */}
            {rest.map((g) => (
              <li key={g.key}>
                <SmallTile {...tile(g)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// loop: HOT-PATH-OK — N ≤ 3 art kinds per tile
const first = (info: GameInfo | undefined, kinds: ArtKind[]) => kinds.find((k) => info?.art.includes(k)) ?? null;

function LeadTile({ game, info, running, hasProfile, onOpen }: TileProps) {
  const { t } = useTranslation();
  const { run, failed } = useGameAction(game);
  const art = first(info, ["hero", "header", "cover"]);
  const logo = art === "hero" && info?.art.includes("logo");
  return (
    <div className="lib-tile lib-continue-tile lead">
      {/* The game page's header, as a button that opens the page. */}
      <button
        type="button"
        className={`gp-hero lib-continue-art${art ? "" : " plain"}`}
        style={art ? { backgroundImage: `url("${artUrl(game.key, art)}")` } : undefined}
        title={game.title}
        onClick={onOpen}
      >
        {logo ? <img className="gp-logo" src={artUrl(game.key, "logo")} alt={game.title} /> : <span className="gp-title">{game.title}</span>}
        <TileOverlays game={game} running={running} hasProfile={hasProfile} />
      </button>
      <div className="gp-bar lib-continue-bar">
        {info?.actions?.includes("play") && <PlayButton game={game} running={running} run={run} />}
        <PlayStats info={info} running={running} />
      </div>
      {failed && <p className="dk-hint gp-action-failed lib-continue-failed">{t("desktop.library.action.failed")}</p>}
    </div>
  );
}

function SmallTile({ game, info, running, hasProfile, onOpen }: TileProps) {
  const { t } = useTranslation();
  const { run, failed } = useGameAction(game);
  const art = first(info, ["header", "hero", "cover"]);
  return (
    <div className="lib-tile lib-continue-tile">
      <button type="button" className="lib-continue-art" title={game.title} onClick={onOpen}>
        {art ? <img src={artUrl(game.key, art)} alt="" loading="lazy" /> : <span className="lib-tile-noart">{game.title}</span>}
        <TileOverlays game={game} running={running} hasProfile={hasProfile} />
      </button>
      <div className="lib-continue-bar">
        <span className="lib-tile-title" title={game.title}>
          {game.title}
        </span>
        {info?.actions?.includes("play") && <PlayButton game={game} running={running} run={run} />}
      </div>
      {failed && <p className="dk-hint gp-action-failed lib-continue-failed">{t("desktop.library.action.failed")}</p>}
    </div>
  );
}
