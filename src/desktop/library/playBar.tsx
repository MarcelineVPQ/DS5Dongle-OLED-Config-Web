// Play and the play stats, shared by a game's page (its bar under the art)
// and Games → Home (the Continue playing tiles): one Play button, one way to
// run a launcher action, one way to say when and how long a game was played.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "../controls";
import type { GameAction, GameEntry, GameInfo } from "../games/types";
import Notice from "../Notice";

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
// scan); `failed` names one that couldn't be opened, until it's dismissed or
// the next action (an error never goes away on its own).
// error: SHOWN — desktop.library.action.failed (ActionFailed, until dismissed or the next action)
export function useGameAction(game: GameEntry): { run: (action: GameAction) => Promise<void>; failed: GameAction | null; clearFailed: () => void } {
  const [failed, setFailed] = useState<GameAction | null>(null);
  const run = async (action: GameAction) => {
    setFailed(null);
    try {
      if (!(await window.desktop!.gameAction({ gameKey: game.key, action }))) setFailed(action);
    } catch {
      // error: SHOWN — desktop.library.action.failed
      setFailed(action);
    }
    // Launching takes the launcher a moment; keep the button busy briefly.
    // lifetime: NOT-WORTH — one-shot 0.6-3 s that ends the busy button's wait; fires once
    await new Promise((resolve) => setTimeout(resolve, action === "play" ? 3000 : 600));
  };
  return { run, failed, clearFailed: () => setFailed(null) };
}

// The failed action's notice (game page and Games → Home's tiles).
export function ActionFailed({ action, onDismiss, className }: { action: GameAction | null; onDismiss: () => void; className?: string }) {
  const { t } = useTranslation();
  if (!action) return null;
  return (
    <Notice error className={className} role="alert" onDismiss={onDismiss}>
      {t("desktop.library.action.failed")}
    </Notice>
  );
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
