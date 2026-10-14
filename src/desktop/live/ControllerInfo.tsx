// The Controller page's "Controller info" block (protocol 1.12; in the main
// view under the drawing, MainBlock.tsx: readouts stay out of the accordion): the
// connected controller's own firmware, its battery (level and charge state
// from the live input, the voltage from a test command) and its lifetime
// counters. Read once when a controller connects and on Refresh
// (useControllerInfo, kept by the page so the block's status and its
// "newer firmware" task dot are known while it's closed); nothing here polls.
// Serial numbers never reach the app (the dongle blanks them), so nothing
// identifying is shown.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { causeText } from "../shownError";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { FEATURES3, supportsFeature3 } from "../../protocol/bridgeClient";
import { type ChargeState, type ControllerFirmware, formatDspVersion, formatHex32, formatThreePart, formatUpdateVersion } from "../../protocol/controllerInfo";
import { compareOfficial, type OfficialStatus } from "../../protocol/officialFirmware";
import type { OfficialFirmwareLookup } from "../api";
import { BusyButton, InfoTip } from "../controls";
import { type ControllerInfoData, loadControllerInfo } from "./loadControllerInfo";
import Notice from "../Notice";
import { SectionGroup } from "../accordion/Section";

export const supportsControllerInfo = (identity: UseDs5BridgeResult["identity"]) => supportsFeature3(identity, 12, FEATURES3.controllerInfo);

// The counters in groups, named the way Sony names them where Sony has a
// group name (docs/GLOSSARY.md): action buttons, directional buttons, back
// buttons. "sticks" also holds the round trips.
const BUTTON_GROUPS: { title: string; keys: string[] }[] = [
  { title: "desktop.ctrlInfo.group.action", keys: ["cross", "circle", "square", "triangle"] },
  { title: "desktop.ctrlInfo.group.directional", keys: ["up", "down", "left", "right"] },
  { title: "desktop.ctrlInfo.group.shoulder", keys: ["l1", "r1", "l2", "r2"] },
  { title: "desktop.customColors.part.stick", keys: ["l3", "r3"] },
  { title: "desktop.ctrlInfo.group.other", keys: ["touchpad", "options", "create", "ps", "mute"] },
  { title: "desktop.ctrlInfo.group.back", keys: ["paddleLeft", "paddleRight"] },
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

export type ControllerInfoState = ReturnType<typeof useControllerInfo>;

// The read: once per controller connection, and again on Refresh. (While none
// is connected there are no numbers; a new one starts from blank.)
// `onFirmware`: the firmware report once read (null until then), for the drawing's player lights.
export function useControllerInfo(bridge: UseDs5BridgeResult, onFirmware?: (firmware: ControllerFirmware | null) => void) {
  const client = bridge.client;
  const supported = supportsControllerInfo(bridge.identity);
  const connected = !!bridge.identity?.controllerConnected;
  const [info, setInfo] = useState<ControllerInfoData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [loadTry, setLoadTry] = useState(0);
  const [official, setOfficial] = useState<OfficialFirmwareLookup | null>(null);

  // Refresh's promise: settled when the read it started has finished.
  const refreshDone = useRef<(() => void) | null>(null);
  const refresh = () =>
    new Promise<void>((resolve) => {
      refreshDone.current = resolve;
      setLoadTry((n) => n + 1);
    });

  // lifetime: OK — cleanup: drops a late read and settles the Refresh promise
  useEffect(() => {
    if (!client || !supported || !connected) return;
    let live = true;
    const done = refreshDone.current;
    refreshDone.current = null;
    Promise.resolve()
      .then(() => {
        if (live) {
          setInfo(null);
          setError(null);
          setLoading(true);
          setOfficial(null);
          // Sony's latest versions, alongside (main process; only with
          // automatic checks on, or now that Refresh was pressed).
          window.desktop
            ?.officialControllerFirmware(loadTry > 0)
            .then((lookup) => live && setOfficial(lookup))
            // error: SHOWN — desktop.ctrlInfo.officialUnavailable (after Refresh; was SILENT-BUG: nothing was said)
            .catch(() => live && setOfficial({ latest: null, problem: "unavailable" }));
        }
        return loadControllerInfo(client);
      })
      .then((next) => live && setInfo(next))
      // error: SHOWN — english: the read error in the card, with Refresh (board errors are English, batch E3)
      .catch((cause) => live && setError(causeText(cause)))
      .finally(() => {
        if (live) setLoading(false);
        done?.();
      });
    return () => {
      live = false;
      done?.();
    };
  }, [client, supported, connected, loadTry]);

  // A controller gone: its numbers go with it (the next one is read afresh).
  const shown = connected ? info : null;
  const firmware = shown?.firmware ?? null;
  // lifetime: OK — acquires nothing (reports the firmware to the parent)
  useEffect(() => onFirmware?.(firmware), [firmware, onFirmware]);

  const edge = shown?.edge ?? null;
  const officialStatus: OfficialStatus | null = firmware && edge !== null && official?.latest ? compareOfficial(firmware.updateVersion, edge, official.latest) : null;
  return { client, supported, connected, info: shown, error, setError, loading, official, officialStatus, loadTry, refresh };
}

interface Props {
  data: ControllerInfoState;
  // From the live input (0xF0): level in %, and the shown power (chargeState()).
  batteryPct: number | null;
  power: ChargeState | null;
}

// The block's body.
export default function ControllerInfo({ data, batteryPct, power }: Props) {
  const { t, i18n } = useTranslation();
  const { client, supported, connected, info, error, setError, loading, official, officialStatus, loadTry, refresh } = data;
  if (!client) return null;
  const num = (n: number) => n.toLocaleString(i18n.resolvedLanguage);
  const hours = (s: number) => t("desktop.ctrlInfo.hours", { value: (s / 3600).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 }) });

  let body;
  let presses = null;
  // hint: MUST-SHOW — why it's empty: what to update
  if (!supported) body = <p className="dk-hint">{t("desktop.ctrlInfo.needsFirmware")}</p>;
  else if (!connected) body = <p className="dk-hint">{t("desktop.ctrlInfo.noController")}</p>;
  else {
    const chargeBad = power === "voltageError" || power === "temperatureError" || power === "chargeError";
    const fw = info?.firmware;
    const tm = info?.telemetry;
    // "Button presses and stick use": its own card below this one, from the
    // same read (shown only when the controller has the counters), one small
    // group per column, wrapping on narrow windows.
    if (tm) {
      // loop: HOT-PATH-OK — N = 6 groups, memo component, rerenders on prop change only
      const groups = BUTTON_GROUPS.map(({ title, keys }) => {
        // loop: HOT-PATH-OK — N ≤ 21 counters across groups, memo component
        const pairs = keys.filter((k) => k in tm.buttons).map((k) => <Pair key={k} label={t(BUTTON_LABEL[k])} value={num(tm.buttons[k])} />);
        if (title === "desktop.customColors.part.stick")
          // loop: HOT-PATH-OK — N = 2 sticks, memo component
          tm.sticks.forEach((s, i) =>
            pairs.push(
              <Pair
                key={`stick-${i}`}
                label={t(i === 0 ? "desktop.ctrlInfo.stickLeft" : "desktop.ctrlInfo.stickRight")}
                value={t("desktop.ctrlInfo.stickValue", { x: num(s.roundTripsX), y: num(s.roundTripsY) })}
              />,
            ),
          );
        return { title, pairs };
      }).filter((g) => g.pairs.length > 0);
      presses = (
        <SectionGroup title={t("desktop.ctrlInfo.presses")}>
          <div className="ctrl-info-groups">
            {/* loop: HOT-PATH-OK — N ≤ 6 groups, memo component */}
            {groups.map((g) => (
              <div key={g.title}>
                <h4 className="dk-subhead">{t(g.title)}</h4>
                <dl className="dk-kv">{g.pairs}</dl>
              </div>
            ))}
          </div>
        </SectionGroup>
      );
    }
    const errors = tm ? tm.chargeErrors.voltage + tm.chargeErrors.temperature + tm.chargeErrors.pmic : 0;
    body = (
      <>
        <div className="ctrl-info-cols">
          <div>
            <dl className="dk-kv">
              <dt>{t("desktop.controller.battery")}</dt>
              {/* loop: HOT-PATH-OK — N = 2 parts of one label */}
              <dd>{[batteryPct !== null ? `${batteryPct}%` : null, info?.millivolts ? `${(info.millivolts / 1000).toFixed(2)} V` : null].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>{t("desktop.ctrlInfo.charge")}</dt>
              <dd className={chargeBad ? "dk-bad" : undefined}>{power ? t(`desktop.ctrlInfo.chargeState.${power}`) : "—"}</dd>
              <dt>{t("desktop.overview.firmware")}</dt>
              <dd>
                <span className="dk-mono">{fw ? `${formatUpdateVersion(fw.updateVersion)} (${formatThreePart(fw.mainFw)})` : loading ? "…" : "—"}</span>
                {officialStatus && (
                  <span className={officialStatus.status === "current" ? "dk-good dk-fw-note" : "dk-fw-note"}>
                    {officialStatus.status === "current" ? t("desktop.firmware.upToDate") : t("desktop.ctrlInfo.officialNewer", { version: formatUpdateVersion(officialStatus.version) })}
                  </span>
                )}
                {/* Refresh asked Sony and got no answer: said, not left blank. */}
                {loadTry > 0 && fw && official?.problem === "unavailable" && <span className="dk-fw-note">{t("desktop.ctrlInfo.officialUnavailable")}</span>}
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
        </div>
        {!tm && (
          // hint: MUST-SHOW — a status: why the lifetime counters are missing, and how to get them
          <p className="dk-hint">
            {loading
              ? t("desktop.ctrlInfo.reading")
              : info?.tooOld
                ? // loop: HOT-PATH-OK — N = 2 parts of one hint
                  [t("desktop.ctrlInfo.tooOld"), info.activeOnly ? t("desktop.ctrlInfo.playedOnly", { value: hours(info.activeOnly) }) : null].filter(Boolean).join(" ")
                : info
                  ? t("desktop.ctrlInfo.noCounters")
                  : "—"}
          </p>
        )}
        <div className="dk-row-btns">
          <BusyButton disabled={loading} onClick={refresh}>
            {t("desktop.ctrlInfo.refresh")}
          </BusyButton>
          <InfoTip text={t("desktop.ctrlInfo.privacy")} />
        </div>
      </>
    );
  }
  return (
    <div className="ctrl-info">
      {error && (
        <Notice error onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {body}
      {presses}
    </div>
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
      {/* hint: MUST-SHOW — the steps' own text (opened on purpose to read them) */}
      <ul className="dk-hint dk-fw-steps">
        <li>
          {t("desktop.ctrlInfo.howToPc")}{" "}
          <a href={sonyUpdaterPage(i18n.resolvedLanguage)} target="_blank" rel="noreferrer noopener" aria-label={t("desktop.ctrlInfo.sonyPage")}>
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

// The block's status: the task (a newer official firmware), else the firmware and battery.
export function controllerInfoStatus(t: (k: string, o?: Record<string, unknown>) => string, data: ControllerInfoState, batteryPct: number | null): { status: string | null; task: string | null } {
  const s = data.officialStatus;
  const task = s?.status === "newer" ? t("desktop.ctrlInfo.officialNewer", { version: formatUpdateVersion(s.version) }) : null;
  const fw = data.info?.firmware;
  // loop: NOT-WORTH — N = 2 parts of one status line
  const status = [fw ? `${t("desktop.overview.firmware")} ${formatUpdateVersion(fw.updateVersion)}` : null, batteryPct !== null ? `${batteryPct}%` : null].filter(Boolean).join(" · ") || null;
  return { status, task };
}
