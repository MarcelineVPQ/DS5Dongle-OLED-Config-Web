// The controller's status under the drawing, in two pairs: power and link
// (battery, signal), then the lights on the controller (lightbar, player
// LEDs and pairing slot). Sticks and triggers aren't repeated here: the
// drawing moves with them and the data below has their numbers.
import { useTranslation } from "react-i18next";
import type { BridgeIdentity } from "../../protocol/bridgeClient";
import { playerNumber } from "../../protocol/bridgeClient";
import { signalQuality } from "../format";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";

interface Props {
  id: BridgeIdentity;
  rssi: number | null;
  // The lightbar's mode (from the dongle's settings) and its live color;
  // clicking the tile opens the lightbar settings.
  lightbarMode: number | null;
  lightbar: [number, number, number] | null;
  onLightbar: () => void;
}

const BARS = { excellent: 4, good: 3, fair: 2, weak: 1 } as const;

export default function LiveStrip({ id, rssi, lightbarMode, lightbar, onLightbar }: Props) {
  const { t } = useTranslation();
  const quality = rssi === null ? null : signalQuality(rssi);
  const player = playerNumber(id.playerLeds);
  const mode = LIGHTBAR_MODES.find((m) => m.value === lightbarMode);
  return (
    <div className="live-strip">
      <div className="live-tile">
        <BatteryIcon level={id.battery} charging={id.charging} />
        <span className="live-tile-value">{id.battery !== null ? `${id.battery}%` : "—"}</span>
        <span className="live-tile-label">{id.charging ? t("desktop.controller.charging", "charging") : t("desktop.controller.battery", "Battery")}</span>
      </div>
      <div className="live-tile">
        <span className="live-bars" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={quality && n <= BARS[quality] ? "on" : ""} style={{ height: `${n * 25}%` }} />
          ))}
        </span>
        <span className="live-tile-value">{quality ? t(`desktop.overview.signalQ.${quality}`, quality) : "—"}</span>
        <span className="live-tile-label">{t("desktop.overview.signal", "Signal")}</span>
      </div>
      <button type="button" className="live-tile live-tile-button" onClick={onLightbar} title={t("desktop.live.part.lightbar", "Lightbar")}>
        <span className="live-swatch" aria-hidden="true" style={lightbar ? { background: `rgb(${lightbar.join(", ")})`, color: `rgb(${lightbar.join(", ")})` } : undefined} />
        <span className="live-tile-value">{mode ? t(`desktop.lightbar.modes.${mode.key}`, mode.label) : "—"}</span>
        <span className="live-tile-label">{t("desktop.live.part.lightbar", "Lightbar")}</span>
      </button>
      <div className="live-tile">
        <span className="live-pleds" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={id.playerLeds & (1 << n) ? "on" : ""} />
          ))}
        </span>
        <span className="live-tile-value">{player ? `${t("desktop.live.player", "Player")} ${player}` : "—"}</span>
        <span className="live-tile-label">
          {t("desktop.overview.slot", "Pairing slot")} {id.currentSlot}
        </span>
      </div>
    </div>
  );
}

function BatteryIcon({ level, charging }: { level: number | null; charging: boolean }) {
  const fill = level === null ? 0 : Math.max(0, Math.min(100, level));
  return (
    <svg viewBox="0 0 44 22" className={`live-battery${fill <= 20 ? " low" : ""}`} aria-hidden="true">
      <rect x="1" y="1" width="38" height="20" rx="4" className="shell" />
      <rect x="40" y="7" width="3" height="8" rx="1" className="shell-tip" />
      <rect x="4" y="4" width={(32 * fill) / 100} height="14" rx="2" className="level" />
      {charging && <path d="M22 3 L15 12 H20 L17 19 L25 9 H20 Z" className="bolt" />}
    </svg>
  );
}
