// One game as a cover tile (Home's shelves and the All games grid), with
// overlays on the art: the store it comes from (bottom left) and what it
// supports (top right: adaptive triggers, HD haptics, a profile, needs
// setup). Every mark has a tooltip, so nothing is told by color alone.
import { AlertTriangle, AudioWaveform, Crosshair, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GameEntry, GameInfo } from "../games/types";
import { artUrl } from "../games/types";
import { LauncherIcon, hasLauncherIcon } from "./LauncherIcon";
import { supportOf } from "./support";

interface Props {
  game: GameEntry;
  info: GameInfo | undefined;
  running: boolean;
  hasProfile: boolean;
  onOpen: () => void;
}

export function GameTile({ game, info, running, hasProfile, onOpen }: Props) {
  const { t } = useTranslation();
  const s = supportOf(game);
  const art = info?.art.includes("cover") ? "cover" : info?.art.includes("header") ? "header" : null;
  const attention = game.fixes.length > 0 || game.runnerMissing;
  // No store mark (added to Heroic by hand): the launcher's mark instead.
  const markId = hasLauncherIcon(game.store) ? game.store : game.launcher;
  const store = hasLauncherIcon(game.store) ? t(`desktop.library.storeName.${game.store}`) : `${t(`desktop.library.launcherName.${game.launcher}`)} · ${t(`desktop.library.storeName.${game.store}`)}`;
  const marks = [
    s.features.triggers === "yes" && { key: "triggers", icon: <Crosshair size={13} />, label: t("desktop.library.featureName.triggers") },
    s.features.haptics === "yes" && { key: "haptics", icon: <AudioWaveform size={13} />, label: t("desktop.library.featureName.haptics") },
    hasProfile && { key: "profile", icon: <SlidersHorizontal size={13} />, label: t("desktop.library.hasProfile") },
    attention && { key: "attention", icon: <AlertTriangle size={13} />, label: t("desktop.library.needsAttention") },
  ].filter(Boolean) as Array<{ key: string; icon: JSX.Element; label: string }>;
  return (
    <button type="button" className="lib-tile" title={game.title} onClick={onOpen}>
      <span className="lib-tile-art">
        {art ? <img src={artUrl(game.key, art)} alt="" loading="lazy" /> : <span className="lib-tile-noart">{game.title}</span>}
        {running && <span className="lib-tile-badge">{t("desktop.library.running")}</span>}
        {marks.length > 0 && (
          <span className="lib-tile-marks">
            {marks.map((m) => (
              <span key={m.key} className={`lib-tile-mark${m.key === "attention" ? " warn" : ""}`} title={m.label} aria-label={m.label} role="img">
                {m.icon}
              </span>
            ))}
          </span>
        )}
        {hasLauncherIcon(markId) && (
          <span className="lib-tile-store" title={store}>
            <LauncherIcon id={markId} size={13} title={store} />
          </span>
        )}
        {game.kind && <span className="lib-tile-kind">{t(`desktop.library.kind.${game.kind}`)}</span>}
      </span>
      <span className="lib-tile-title">{game.title}</span>
    </button>
  );
}
