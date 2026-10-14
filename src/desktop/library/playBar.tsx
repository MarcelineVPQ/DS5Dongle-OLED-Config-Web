// Play and the play stats, shared by a game's page (its bar under the art)
// and Games → Home (the Continue playing tiles): one Play button, one way to
// run a launcher action, one way to say when and how long a game was played.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "../controls";
import type { GameAction, GameEntry, GameInfo } from "../games/types";

function hours(min: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return min < 60 ? t("desktop.library.minutes", { count: min }) : t("desktop.library.hours", { count: Math.round(min / 6) / 10 });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="gp-stat">
      <span className="gp-stat-label">{label}</span>
      <span className="gp-stat-value" title={value}>
        {value}
      </span>
    </div>
  );
}

// Last played (while it runs, the Play button says so instead) and play time.
export function PlayStats({ info, running }: { info: GameInfo | undefined; running: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="gp-stats">
      {!running && <Stat label={t("desktop.library.lastPlayed")} value={info?.lastPlayed ? new Date(info.lastPlayed * 1000).toLocaleDateString() : t("desktop.library.never")} />}
      <Stat label={t("desktop.library.playTime")} value={info?.playtimeMin ? hours(info.playtimeMin, t) : "—"} />
    </div>
  );
}

// Runs a launcher action for a game (built in the main process from the
// scan); `failed` names one that couldn't be opened, for a few seconds.
export function useGameAction(game: GameEntry): { run: (action: GameAction) => Promise<void>; failed: GameAction | null } {
  const [failed, setFailed] = useState<GameAction | null>(null);
  const run = async (action: GameAction) => {
    setFailed(null);
    try {
      if (!(await window.desktop!.gameAction({ gameKey: game.key, action }))) {
        setFailed(action);
        setTimeout(() => setFailed((f) => (f === action ? null : f)), 6000);
      }
    } catch {
      setFailed(action);
    }
    // Launching takes the launcher a moment; keep the button busy briefly.
    await new Promise((resolve) => setTimeout(resolve, action === "play" ? 3000 : 600));
  };
  return { run, failed };
}

// ▶ Play, or ● Running while the game runs (then it can't be started again).
export function PlayButton({ game, running, run }: { game: GameEntry; running: boolean; run: (action: GameAction) => Promise<void> }) {
  const { t } = useTranslation();
  const launcher = t(`desktop.library.launcherName.${game.launcher}`);
  return (
    <BusyButton className="dk-btn primary gp-play" disabled={running} onClick={() => run("play")} title={t("desktop.library.action.playHint", { launcher })}>
      {running ? `● ${t("desktop.library.running")}` : `▶ ${t("desktop.library.action.play")}`}
    </BusyButton>
  );
}
