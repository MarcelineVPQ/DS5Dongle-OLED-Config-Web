// "Controller info" in the overview (protocol 1.12): the connected controller's
// own firmware, its battery (level and charge state from the live input, the
// voltage from a test command) and its lifetime counters. Read once when a
// controller connects and on Refresh; nothing here polls. Serial numbers never
// reach the app (the dongle blanks them), so nothing identifying is shown.
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../errorText";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { FEATURES3, supportsFeature3 } from "../../protocol/bridgeClient";
import { chargeState, formatDspVersion, formatHex32, formatThreePart, formatUpdateVersion } from "../../protocol/controllerInfo";
import { compareOfficial } from "../../protocol/officialFirmware";
import type { OfficialFirmwareLookup } from "../api";
import { type ControllerInfoData, loadControllerInfo } from "./loadControllerInfo";

export const supportsControllerInfo = (identity: UseDs5BridgeResult["identity"]) => supportsFeature3(identity, 12, FEATURES3.controllerInfo);

const BUTTON_ORDER = [
  "cross",
  "circle",
  "square",
  "triangle",
  "up",
  "down",
  "left",
  "right",
  "l1",
  "r1",
  "l2",
  "r2",
  "l3",
  "r3",
  "touchpad",
  "options",
  "create",
  "ps",
  "mute",
  "paddleLeft",
  "paddleRight",
];
const BUTTON_LABEL: Record<string, string> = {
  up: "desktop.live.part.dpad-up",
  down: "desktop.live.part.dpad-down",
  left: "desktop.live.part.dpad-left",
  right: "desktop.live.part.dpad-right",
  triangle: "desktop.live.part.triangle",
  circle: "desktop.live.part.circle",
  cross: "desktop.live.part.cross",
  square: "desktop.live.part.square",
  l1: "desktop.live.part.l1",
  l2: "desktop.live.part.l2",
  r1: "desktop.live.part.r1",
  r2: "desktop.live.part.r2",
  l3: "desktop.live.part.stick-l",
  r3: "desktop.live.part.stick-r",
  touchpad: "desktop.live.part.touchpad",
  options: "desktop.live.part.options",
  create: "desktop.live.part.create",
  ps: "desktop.live.part.ps",
  mute: "desktop.ctrlInfo.muteButton",
  paddleLeft: "desktop.live.part.paddle-l",
  paddleRight: "desktop.live.part.paddle-r",
};

interface Props {
  bridge: UseDs5BridgeResult;
  // From the live input (0xF0): level in %, and the power-state nibble.
  batteryPct: number | null;
  batteryState: number | null;
}

function ControllerInfo({ bridge, batteryPct, batteryState }: Props) {
  const { t, i18n } = useTranslation();
  const client = bridge.client;
  const supported = supportsControllerInfo(bridge.identity);
  const connected = !!bridge.identity?.controllerConnected;
  const [info, setInfo] = useState<ControllerInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [loadTry, setLoadTry] = useState(0);
  const [official, setOfficial] = useState<OfficialFirmwareLookup | null>(null);

  // Once per controller connection, and again on Refresh. (While none is
  // connected the card shows no numbers; a new one starts from blank.)
  useEffect(() => {
    if (!client || !supported || !connected) return;
    let live = true;
    void Promise.resolve()
      .then(() => {
        if (live) {
          setInfo(null);
          setError(null);
          setLoading(true);
          setOfficial(null);
          // Sony's latest versions, alongside (main process; only with
          // automatic checks on, or now that Refresh was pressed).
          void window.desktop
            ?.officialControllerFirmware(loadTry > 0)
            .then((lookup) => live && setOfficial(lookup))
            .catch(() => undefined);
        }
        return loadControllerInfo(client);
      })
      .then((next) => live && setInfo(next))
      .catch((cause) => live && setError(errorText(cause)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [client, supported, connected, loadTry]);

  if (!client) return null;
  const num = (n: number) => n.toLocaleString(i18n.resolvedLanguage);
  const hours = (s: number) => t("desktop.ctrlInfo.hours", { value: (s / 3600).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 }) });

  let body;
  if (!supported) body = <p className="dk-hint">{t("desktop.ctrlInfo.needsFirmware")}</p>;
  else if (!connected) body = <p className="dk-hint">{t("desktop.ctrlInfo.noController")}</p>;
  else {
    const charge = batteryState === null ? null : chargeState(batteryState);
    const chargeBad = charge === "voltageError" || charge === "temperatureError" || charge === "chargeError";
    const fw = info?.firmware;
    const edge = info?.edge ?? null;
    const officialStatus = fw && edge !== null && official?.latest ? compareOfficial(fw.updateVersion, edge, official.latest) : null;
    const tm = info?.telemetry;
    const errors = tm ? tm.chargeErrors.voltage + tm.chargeErrors.temperature + tm.chargeErrors.pmic : 0;
    body = (
      <>
        <div className="ctrl-info-cols">
          <div>
            <dl className="dk-kv">
              <dt>{t("desktop.ctrlInfo.battery")}</dt>
              <dd>{[batteryPct !== null ? `${batteryPct}%` : null, info?.millivolts ? `${(info.millivolts / 1000).toFixed(2)} V` : null].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>{t("desktop.ctrlInfo.charge")}</dt>
              <dd className={chargeBad ? "dk-bad" : undefined}>{charge ? t(`desktop.ctrlInfo.chargeState.${charge}`) : "—"}</dd>
              <dt>{t("desktop.ctrlInfo.firmware")}</dt>
              <dd>
                <span className="dk-mono">{fw ? `${formatUpdateVersion(fw.updateVersion)} (${formatThreePart(fw.mainFw)})` : loading ? "…" : "—"}</span>
                {officialStatus && (
                  <span className={officialStatus.status === "current" ? "dk-good dk-fw-note" : "dk-fw-note"}>
                    {officialStatus.status === "current" ? t("desktop.ctrlInfo.officialCurrent") : t("desktop.ctrlInfo.officialNewer", { version: formatUpdateVersion(officialStatus.version) })}
                  </span>
                )}
              </dd>
              {officialStatus?.status === "newer" && (
                <dd className="dk-fw-howto">
                  <HowToUpdate />
                </dd>
              )}
              {fw && (
                <>
                  <dt>{t("desktop.ctrlInfo.built")}</dt>
                  <dd className="dk-mono">{fw.buildDate || "—"}</dd>
                  <dt>{t("desktop.ctrlInfo.hardware")}</dt>
                  <dd className="dk-mono">{formatHex32(fw.hwInfo)}</dd>
                  <dt>{t("desktop.ctrlInfo.sbl")}</dt>
                  <dd className="dk-mono">{formatThreePart(fw.sbl)}</dd>
                  <dt>{t("desktop.ctrlInfo.dsp")}</dt>
                  <dd className="dk-mono">
                    {formatDspVersion(fw.dsp)} · {formatThreePart(fw.mcuDsp)}
                  </dd>
                </>
              )}
              {info?.btPatch !== null && info?.btPatch !== undefined && (
                <>
                  <dt>{t("desktop.ctrlInfo.btPatch")}</dt>
                  <dd className="dk-mono">{formatHex32(info.btPatch)}</dd>
                </>
              )}
            </dl>
          </div>
          <div>
            <h4 className="dk-subhead">{t("desktop.ctrlInfo.lifetime")}</h4>
            {tm ? (
              <>
                <dl className="dk-kv">
                  <dt>{t("desktop.ctrlInfo.played")}</dt>
                  <dd>{hours(tm.activeTime)}</dd>
                  <dt>{t("desktop.ctrlInfo.charging")}</dt>
                  <dd>{hours(tm.chargeTime)}</dd>
                  <dt>{t("desktop.ctrlInfo.haptics")}</dt>
                  <dd>{hours(tm.hapticsTime)}</dd>
                  <dt>{t("desktop.ctrlInfo.triggers")}</dt>
                  <dd>
                    {hours(tm.triggerTime[0])} · {hours(tm.triggerTime[1])}
                  </dd>
                  <dt>{t("desktop.ctrlInfo.chargeCycles")}</dt>
                  <dd>{t("desktop.ctrlInfo.chargeCyclesValue", { cycles: num(tm.chargeCycles), full: num(tm.fullCharges) })}</dd>
                  <dt>{t("desktop.ctrlInfo.chargeErrors")}</dt>
                  <dd className={errors ? "dk-bad" : undefined}>
                    {errors
                      ? t("desktop.ctrlInfo.chargeErrorsValue", { voltage: num(tm.chargeErrors.voltage), temperature: num(tm.chargeErrors.temperature), pmic: num(tm.chargeErrors.pmic) })
                      : t("desktop.ctrlInfo.none")}
                  </dd>
                  <dt>{t("desktop.ctrlInfo.connections")}</dt>
                  <dd>{t("desktop.ctrlInfo.connectionsValue", { bt: num(tm.bluetoothConnects), usb: num(tm.usbConnects), timeouts: num(tm.bluetoothTimeouts) })}</dd>
                </dl>
              </>
            ) : null}
          </div>
          {tm && (
            <div>
              <details className="dk-advanced">
                <summary>{t("desktop.ctrlInfo.presses")}</summary>
                <dl className="dk-kv">
                  {BUTTON_ORDER.filter((k) => k in tm.buttons).map((k) => (
                    <Pair key={k} label={t(BUTTON_LABEL[k])} value={num(tm.buttons[k])} />
                  ))}
                  {tm.sticks.map((s, i) => (
                    <Pair
                      key={`stick-${i}`}
                      label={t(i === 0 ? "desktop.ctrlInfo.stickLeft" : "desktop.ctrlInfo.stickRight")}
                      value={t("desktop.ctrlInfo.stickValue", { x: num(s.roundTripsX), y: num(s.roundTripsY) })}
                    />
                  ))}
                </dl>
              </details>
            </div>
          )}
        </div>
        {!tm && (
          <p className="dk-hint">
            {loading
              ? t("desktop.ctrlInfo.reading")
              : info?.tooOld
                ? [t("desktop.ctrlInfo.tooOld"), info.activeOnly ? t("desktop.ctrlInfo.playedOnly", { value: hours(info.activeOnly) }) : null].filter(Boolean).join(" ")
                : info
                  ? t("desktop.ctrlInfo.noCounters")
                  : "—"}
          </p>
        )}
        <p className="dk-hint">{t("desktop.ctrlInfo.privacy")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn" disabled={loading} onClick={() => setLoadTry((n) => n + 1)}>
            {t("desktop.ctrlInfo.refresh")}
          </button>
        </div>
      </>
    );
  }
  // A full-width card under the live data (the same card look), not in the
  // settings panel: it's something to read, not a setting.
  return (
    <section className="live-data-card ctrl-info">
      <h3>{t("desktop.ctrlInfo.title")}</h3>
      {body}
      {error && <div className="dk-notice error">{error}</div>}
    </section>
  );
}

// Sony's official links, where Sony has the page in the app's language.
const SONY_PAGE_LANG: Record<string, string> = { de: "de", es: "es", fr: "fr", ja: "jp", "pt-BR": "pt" };
const sonyUpdaterPage = (lang: string | undefined) => `https://controller.dl.playstation.net/controller/lang/${SONY_PAGE_LANG[lang ?? ""] ?? "en"}/2100004.html`;

// Sony's route for a newer official firmware. The app only checks: Sony's
// firmware is installed with Sony's own tools, never by this app.
function HowToUpdate() {
  const { t, i18n } = useTranslation();
  return (
    <details className="dk-advanced">
      <summary>{t("desktop.ctrlInfo.howToUpdate")}</summary>
      <ul className="dk-hint dk-fw-steps">
        <li>
          {t("desktop.ctrlInfo.howToPc")}{" "}
          <a href={sonyUpdaterPage(i18n.resolvedLanguage)} target="_blank" rel="noreferrer noopener">
            {t("desktop.ctrlInfo.sonyPage")}
          </a>
        </li>
        <li>{t("desktop.ctrlInfo.howToPs5")}</li>
        <li>{t("desktop.ctrlInfo.howToCable")}</li>
        {window.desktop?.platform !== "win32" && <li>{t("desktop.ctrlInfo.windowsOnly")}</li>}
      </ul>
    </details>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

// The overview re-renders with every live input report: this card only
// redraws when the battery level / state or the dongle connection changes.
export default memo(ControllerInfo);
