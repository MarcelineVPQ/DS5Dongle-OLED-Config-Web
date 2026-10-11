// The live readouts under the controller, laid out like it: left stick and
// L2 on the left, R2 and the right stick on the right, the controller's
// battery, signal, player and slot in the middle.
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import type { BridgeIdentity } from "../../protocol/bridgeClient";
import { playerNumber } from "../../protocol/bridgeClient";
import { signalQuality } from "../format";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";

interface Props {
  input: InputReport | null;
  id: BridgeIdentity;
  rssi: number | null;
  // The lightbar's mode (from the dongle's settings) and its live color;
  // clicking the tile opens the lightbar settings.
  lightbarMode: number | null;
  lightbar: [number, number, number] | null;
  onLightbar: () => void;
}

const BARS = { excellent: 4, good: 3, fair: 2, weak: 1 } as const;

export default function LiveStrip({ input, id, rssi, lightbarMode, lightbar, onLightbar }: Props) {
  const { t } = useTranslation();
  const quality = rssi === null ? null : signalQuality(rssi);
  const player = playerNumber(id.playerLeds);
  const mode = LIGHTBAR_MODES.find((m) => m.value === lightbarMode);
  return (
    <div className="live-strip">
      <Stick label="L3" x={input?.leftStick.x ?? 128} y={input?.leftStick.y ?? 128} pressed={!!input?.l3} name={t("desktop.live.part.stick-l")} />
      <Trigger label="L2" value={input?.triggerLeft ?? 0} />
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
      <Trigger label="R2" value={input?.triggerRight ?? 0} />
      <Stick label="R3" x={input?.rightStick.x ?? 128} y={input?.rightStick.y ?? 128} pressed={!!input?.r3} name={t("desktop.live.part.stick-r")} />
    </div>
  );
}

function Stick({ label, x, y, pressed, name }: { label: string; x: number; y: number; pressed: boolean; name: string }) {
  const cx = 30 + ((x - 128) / 128) * 22;
  const cy = 30 + ((y - 128) / 128) * 22;
  return (
    <div className="live-tile" title={name}>
      <svg viewBox="0 0 60 60" className={`live-stick${pressed ? " pressed" : ""}`} aria-hidden="true">
        <circle cx="30" cy="30" r="26" className="ring" />
        <line x1="30" y1="6" x2="30" y2="54" className="cross" />
        <line x1="6" y1="30" x2="54" y2="30" className="cross" />
        <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="6" className="dot" />
      </svg>
      <span className="live-tile-label">{label}</span>
    </div>
  );
}

function Trigger({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 255) * 100);
  return (
    <div className="live-tile live-tile-narrow">
      <span className="live-trig" aria-hidden="true">
        <span style={{ height: `${pct}%` }} />
      </span>
      <span className="live-tile-value">{pct}%</span>
      <span className="live-tile-label">{label}</span>
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
