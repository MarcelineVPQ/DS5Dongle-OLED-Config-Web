// The controller's status under the drawing, in two pairs: power and link
// (battery with its charge or cable, signal with its dB), then the lights on
// the controller (lightbar, player indicator). Each fact once on the page:
// the voltage and charge history are Controller info's, the pairing slot is
// the panel's sub-line. Sticks and triggers aren't repeated here: the
// drawing moves with them and the data below has their numbers.
import { useTranslation } from "react-i18next";
import type { BridgeIdentity } from "../../protocol/bridgeClient";
import { playerNumber } from "../../protocol/bridgeClient";
import { type ChargeState, litPlayerLights, type PlayerLightWiring } from "../../protocol/controllerInfo";
import { signalQuality } from "../format";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";

interface Props {
  id: BridgeIdentity;
  playerWiring: PlayerLightWiring; // how the connected controller lights its player lights
  power: ChargeState | null; // chargeState(): a bolt while charging, a plug on a cable that isn't
  rssi: number | null;
  // The lightbar's mode (from the dongle's settings) and its live color;
  // clicking the tile opens the lightbar settings.
  lightbarMode: number | null;
  lightbar: [number, number, number] | null;
  onLightbar: () => void;
}

const BARS = { excellent: 4, good: 3, fair: 2, weak: 1 } as const;

export default function LiveStrip({ id, playerWiring, power, rssi, lightbarMode, lightbar, onLightbar }: Props) {
  const { t } = useTranslation();
  const quality = rssi === null ? null : signalQuality(rssi);
  const player = playerNumber(id.playerLeds);
  const lit = litPlayerLights(id.playerLeds, playerWiring);
  // loop: HOT-PATH-OK — N ≈ 8 lightbar modes per render
  const mode = LIGHTBAR_MODES.find((m) => m.value === lightbarMode);
  const swatch = lightbar ? `rgb(${lightbar.join(", ")})` : null; // theme-exempt: the real lightbar color
  return (
    <div className="live-strip">
      <div className="live-tile">
        <BatteryIcon level={id.battery} power={power} />
        <span className="live-tile-value">{id.battery !== null ? `${id.battery}%` : "—"}</span>
        <span className="live-tile-label">
          {power === "charging"
            ? t("desktop.controller.charging")
            : power === "pluggedIn"
              ? t("desktop.controller.pluggedIn")
              : power === "full"
                ? t("desktop.ctrlInfo.chargeState.full")
                : t("desktop.controller.battery")}
        </span>
      </div>
      <div className="live-tile">
        <span className="live-bars" aria-hidden="true">
          {/* loop: HOT-PATH-OK — N = 4 player lights per render */}
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={quality && n <= BARS[quality] ? "on" : ""} style={{ height: `${n * 25}%` }} />
          ))}
        </span>
        <span className="live-tile-value">{quality ? t(`desktop.overview.signalQ.${quality}`, quality) : "—"}</span>
        {/* The dB as its small line (the one place the page shows it; Bluetooth's RSSI is relative to the ideal range: 0 = in it). */}
        <span className="live-tile-label">
          {t("desktop.overview.signal", "Signal")}
          {rssi !== null && ` · ${rssi === 0 ? t("desktop.liveData.inRange") : `${rssi} dB`}`}
        </span>
      </div>
      <button type="button" className="live-tile live-tile-button" onClick={onLightbar} title={t("desktop.live.part.lightbar", "Light bar")}>
        <span className="live-swatch" aria-hidden="true" style={swatch ? { background: swatch, color: swatch } : undefined} />
        <span className="live-tile-value">{mode ? t(`desktop.lightbar.modes.${mode.key}`, mode.label) : "—"}</span>
        <span className="live-tile-label">{t("desktop.live.part.lightbar", "Light bar")}</span>
      </button>
      <div className="live-tile">
        <span className="live-pleds" aria-hidden="true">
          {/* loop: HOT-PATH-OK — N = 5 signal bars per render */}
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={lit & (1 << n) ? "on" : ""} />
          ))}
        </span>
        <span className="live-tile-value">{player ? `${t("desktop.live.player", "Player")} ${player}` : "—"}</span>
        {/* The pairing slot is the panel's sub-line, not repeated here (IA audit C1). */}
        <span className="live-tile-label">{t("desktop.live.playerIndicator")}</span>
      </div>
    </div>
  );
}

export function BatteryIcon({ level, power }: { level: number | null; power: ChargeState | null }) {
  const fill = level === null ? 0 : Math.max(0, Math.min(100, level));
  return (
    <svg viewBox="0 0 44 22" className={`live-battery${fill <= 20 ? " low" : ""}`} aria-hidden="true">
      <rect x="1" y="1" width="38" height="20" rx="4" className="shell" />
      <rect x="40" y="7" width="3" height="8" rx="1" className="shell-tip" />
      <rect x="4" y="4" width={(32 * fill) / 100} height="14" rx="2" className="level" />
      {power === "charging" && <path d="M22 3 L15 12 H20 L17 19 L25 9 H20 Z" className="bolt" />}
      {power === "pluggedIn" && <path d="M17 3 H19 V7 H17 Z M23 3 H25 V7 H23 Z M15 7 H27 V11 A5 5 0 0 1 22 16 V19 H20 V16 A5 5 0 0 1 15 11 Z" className="plug" />}
    </svg>
  );
}
