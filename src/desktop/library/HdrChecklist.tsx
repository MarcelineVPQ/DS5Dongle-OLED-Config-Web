// HDR in games (Linux): the requirements as a ✓ / ✗ list, each ✗ with what to
// install or turn on, and "Set it up yourself" (what Turn on HDR does, by
// hand, with this computer's real screen mode and a line to copy). Shown on
// Home -> This computer (the system part) and on each HDR game's page.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HEROIC_GAMESCOPE_OPTIONS, LUTRIS_GAMESCOPE_FLAGS, lineScreen, WSI_ENV, manualSteamLine, type HdrReq } from "../games/hdrSetup";
import type { GameEntry, HdrSystem } from "../games/types";

export function HdrChecklist({ reqs }: { reqs: HdrReq[] }) {
  const { t } = useTranslation();
  return (
    <ul className="hdr-check">
      {/* loop: HOT-PATH-OK — N ≈ 6 HDR requirements; renders on page open or rescan */}
      {reqs.map((r) => (
        <li key={r.id}>
          <span className={r.ok ? "hdr-ok" : "hdr-no"} aria-label={t(r.ok ? "desktop.hdrCheck.yes" : "desktop.hdrCheck.no")}>
            {r.ok ? "✓" : "✗"}
          </span>
          <span>{t(`desktop.hdrCheck.${r.key}`, { ...r.params, runner: r.params?.runner || t("desktop.hdrCheck.defaultRunner") })}</span>
        </li>
      ))}
    </ul>
  );
}

// A line to copy: selectable text plus a Copy button (execCommand on the
// selected text, so no clipboard permission is needed).
function CopyLine({ text }: { text: string }) {
  const { t } = useTranslation();
  const box = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    box.current?.select();
    setCopied(document.execCommand("copy"));
  };
  return (
    <div className="hdr-line">
      <textarea ref={box} className="dk-textarea dk-mono" readOnly rows={2} value={text} onFocus={(e) => e.currentTarget.select()} aria-label={t("desktop.hdrManual.lineLabel")} />
      <button type="button" className="dk-btn" onClick={copy}>
        {copied ? t("desktop.hdrManual.copied") : t("desktop.hdrManual.copy")}
      </button>
    </div>
  );
}

// What Turn on HDR does, by hand, for one game (Steam: with its current launch options left to the player).
export function HdrManual({ game, sys, ourProton }: { game: GameEntry; sys: HdrSystem; ourProton: string | null }) {
  const { t } = useTranslation();
  const screen = lineScreen(sys);
  const size = screen ?? { width: 3840, height: 2160 };
  const p = {
    proton: ourProton ?? t("desktop.hdrManual.noProton"),
    screen: screen?.name ?? t("desktop.hdrManual.yourScreen"),
    mode: `${size.width}×${size.height}`,
    width: String(size.width),
    height: String(size.height),
  };
  const launcher = game.launcher === "heroic" || game.launcher === "lutris" ? game.launcher : "steam";
  return (
    <details className="gp-legend hdr-manual">
      <summary>{t("desktop.hdrManual.title")}</summary>
      <p className="dk-hint">{t("desktop.hdrManual.intro")}</p>
      {!screen && <p className="dk-hint">{t("desktop.hdrManual.noMode")}</p>}
      <ol className="dk-review">
        <li>{t(`desktop.hdrManual.${launcher}.proton`, p)}</li>
        {launcher === "steam" && (
          <li>
            {t("desktop.hdrManual.steam.line", p)}
            <CopyLine text={manualSteamLine(size)} />
          </li>
        )}
        {launcher === "heroic" && (
          <>
            <li>
              {t("desktop.hdrManual.heroic.gamescope", p)}
              <CopyLine text={HEROIC_GAMESCOPE_OPTIONS.join(" ")} />
            </li>
            <li>{t("desktop.hdrManual.heroic.env", { env: WSI_ENV })}</li>
          </>
        )}
        {launcher === "lutris" && (
          <>
            <li>
              {t("desktop.hdrManual.lutris.gamescope", p)}
              <CopyLine text={LUTRIS_GAMESCOPE_FLAGS} />
            </li>
            <li>{t("desktop.hdrManual.lutris.env", { env: WSI_ENV })}</li>
          </>
        )}
        <li>{t("desktop.hdrManual.inGame")}</li>
      </ol>
      <p className="dk-hint">{t("desktop.hdrManual.guide")}</p>
    </details>
  );
}
