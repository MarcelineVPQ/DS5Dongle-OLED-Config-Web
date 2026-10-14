// Developer card → Fake games (dev builds only): Games shows a made-up library
// (electron/main/games/fake/) instead of scanning the launchers, to work on
// the Games pages without Steam, Heroic, Lutris, a board or a controller. The
// switch restarts the page (like Simulate board) so Games, its rail count and
// the Controller page's art all read the new library; the running game and
// the fake computer's HDR setup change at once.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FAKE_GAMES_HDR, type DevFakeGamesChange, type DevFakeGamesState, type FakeGamesHdr } from "../api";
import { Row, Toggle } from "../controls";
import { DEV_TOOLS_BUILT } from "../devPreview";
import { logged } from "../../errorText";
import { causeText, shown } from "../shownError";

export default function FakeGames() {
  const { t } = useTranslation();
  const [state, setState] = useState<DevFakeGamesState | null>(null);
  const api = DEV_TOOLS_BUILT ? window.desktop?.devFakeGames : undefined;
  // lifetime: OK — acquires nothing; the cleanup drops a late answer (unmount)
  useEffect(() => {
    if (!api) return;
    let live = true;
    api({}).then((s) => live && setState(s), logged("reading the Fake games state for the Developer card (the switch shows off)"));
    return () => {
      live = false;
    };
  }, [api]);
  if (!api) return null;
  const change = (c: DevFakeGamesChange): void => {
    // error: SHOWN — desktop.errors.actionFailed (the Developer card has no status line)
    api(c).then(setState, (cause: unknown) => shown("desktop.errors.actionFailed", { reason: causeText(cause) })(cause));
  };
  const status = state?.status ?? null;
  return (
    <>
      <Toggle
        label={t("desktop.dev.fakeGames")}
        sub={t("desktop.dev.fakeGamesHint")}
        value={!!state?.on}
        onChange={(on) =>
          // error: SHOWN — desktop.errors.actionFailed (the Developer card has no status line)
          api({ on }).then(
            () => location.reload(), // Games, its rail count and the art read the other library
            // error: SHOWN — desktop.errors.actionFailed (the Developer card has no status line)
            (cause: unknown) => shown("desktop.errors.actionFailed", { reason: causeText(cause) })(cause),
          )
        }
      />
      {status && (
        <>
          <Row label={t("desktop.dev.fakeRunning")} sub={t("desktop.dev.fakeRunningHint")}>
            <select className="dk-select" aria-label={t("desktop.dev.fakeRunning")} value={status.running ?? ""} onChange={(e) => change({ running: e.target.value || null })}>
              <option value="">{t("desktop.dev.fakeRunningNone")}</option>
              {/* loop: NOT-WORTH — 20 fake games, Developer card only (dev builds) */}
              {status.games.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.title}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("desktop.dev.fakeHdr")} sub={t("desktop.dev.fakeHdrHint")}>
            <select className="dk-select" aria-label={t("desktop.dev.fakeHdr")} value={status.hdr} onChange={(e) => change({ hdr: e.target.value as FakeGamesHdr })}>
              {/* loop: NOT-WORTH — 3 HDR setups, Developer card only */}
              {FAKE_GAMES_HDR.map((h) => (
                <option key={h} value={h}>
                  {t(`desktop.dev.fakeHdrState.${h}`)}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}
    </>
  );
}
