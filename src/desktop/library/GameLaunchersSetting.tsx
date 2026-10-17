// "Read my game launchers": whether Games may read the game launchers (its
// first-visit consent). It lives in Games → Home → Launchers, the place it
// acts on (IA audit Q5); App settings → Privacy says whether it's on and
// links there. Turning it off asks first (a notice in the section), since the
// library and per-game controller profiles hide until it's back on (Games
// then shows its consent card); turning it on is the same as allowing it there.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton, Toggle } from "../controls";
import Notice from "../Notice";
import { shown } from "../shownError";
import { logged } from "../../errorText";
import { onGamesAllowed, setGamesAllowed } from "../games/consent";
import { protonApplies } from "../games/platform";

// Whether Games may read the game launchers (null until known): App settings
// → Privacy's status.
export function useGamesAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // lifetime: OK — cleanup: drops a late read, unsubscribes the games-allowed event
  useEffect(() => {
    let live = true;
    window.desktop
      ?.getSettings()
      .then((s) => live && setAllowed(s.gamesScanAllowed))
      .catch(logged("reading the Games consent for App settings (the section stays hidden)"));
    // lifetime: OK — off() in the effect cleanup
    const off = onGamesAllowed(setAllowed);
    return () => {
      live = false;
      off();
    };
  }, []);
  return allowed;
}

export function GameLaunchersSetting({ allowed }: { allowed: boolean }) {
  const { t } = useTranslation();
  const [confirmOff, setConfirmOff] = useState(false);
  const reads = t("desktop.games.readLaunchersSub", { what: t(protonApplies() ? "desktop.games.consentLaunchers" : "desktop.games.consentLaunchersWindows") });
  const offText = t("desktop.games.readLaunchersOff");
  return (
    <>
      {confirmOff && (
        <Notice
          role="alert"
          action={
            <>
              <button type="button" className="dk-btn" onClick={() => setConfirmOff(false)}>
                {t("desktop.common.cancel")}
              </button>
              <BusyButton
                className="dk-btn danger"
                onClick={async () => {
                  await setGamesAllowed(false).catch(shown("desktop.errors.settingNotSaved"));
                  setConfirmOff(false);
                }}
              >
                {t("desktop.games.readLaunchersTurnOff")}
              </BusyButton>
            </>
          }
        >
          <span>{offText}</span>
        </Notice>
      )}
      <Toggle
        label={t("desktop.games.readLaunchers")}
        sub={`${reads} ${offText}`}
        value={allowed}
        disabled={confirmOff}
        onChange={(v) => (v ? setGamesAllowed(true).catch(shown("desktop.errors.settingNotSaved")) : setConfirmOff(true))}
      />
    </>
  );
}
