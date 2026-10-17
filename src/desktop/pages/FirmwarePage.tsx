import { useState } from "react";
import { causeText } from "../shownError";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { isNewer, shortVersion } from "../../update/manifest";
import { BusyButton } from "../controls";
import { announce } from "../toast";
import { feedProblemKey, type FirmwareUpdate } from "../useUpdates";
import { logged } from "../../errorText";

// The Pico 2 W page's Firmware section (installed / latest, update, check)
// and its Restart & reset section (restart, BOOTSEL, factory reset; Set up
// USB access is in Connection to the PC): section bodies for
// dongle/DonglePage.tsx.
export default function FirmwareSection({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  const { t } = useTranslation();
  const client = bridge.client;
  // Flashing restarts the dongle: a second click confirms it (a stray click
  // on the update button flashed it before).
  const [confirmFlash, setConfirmFlash] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const installed = bridge.firmwareVersion;

  return (
    <>
      <dl className="dk-kv">
        <dt>{t("desktop.overview.firmware", "Firmware")}</dt>
        <dd className="dk-mono">{bridge.firmwareVersion ?? "—"}</dd>
        <dt>{t("desktop.overview.protocol", "Protocol")}</dt>
        <dd className="dk-mono">{bridge.identity ? `${bridge.identity.protoMajor}.${bridge.identity.protoMinor}` : "—"}</dd>
        <dt>{t("desktop.firmware.latest", "Latest")}</dt>
        <dd className="dk-mono">
          {fw.latest
            ? `${fw.latest.version}${fw.latest.source === "bundled" ? ` (${t("desktop.firmware.bundled")})` : ""}`
            : fw.problem === "unpublished"
              ? t("desktop.firmware.unpublished")
              : fw.problem === "disabled"
                ? t("desktop.firmware.disabled")
                : fw.problem === "unsigned"
                  ? t("desktop.firmware.unsigned")
                  : fw.problem === "malformed"
                    ? t("desktop.firmware.malformed")
                    : t("desktop.firmware.offline")}
        </dd>
      </dl>
      <div className="dk-row-btns">
        {fw.available && confirmFlash ? (
          <>
            <button type="button" className="dk-btn" onClick={() => setConfirmFlash(false)}>
              {t("desktop.common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              className="dk-btn primary"
              disabled={!client || fw.state.phase === "running" || fw.state.phase === "verifying"}
              onClick={() => {
                setConfirmFlash(false);
                fw.start().catch(logged("fw.start (it shows its own errors in the firmware banner)"));
              }}
            >
              {t("desktop.firmware.confirmInstall", { version: shortVersion(fw.latest?.version), defaultValue: "Install {{version}} now" })}
            </button>
          </>
        ) : fw.available ? (
          <button type="button" className="dk-btn primary" disabled={!client || fw.state.phase === "running" || fw.state.phase === "verifying"} onClick={() => setConfirmFlash(true)}>
            {fw.backToStable
              ? t("desktop.firmware.backToStable", { version: shortVersion(fw.latest?.version) })
              : t("desktop.firmware.update", { version: shortVersion(fw.latest?.version), defaultValue: "Update to {{version}}" })}
          </button>
        ) : (
          <span className="dk-good">✓ {t("desktop.firmware.upToDate", "Up to date")}</span>
        )}
        <BusyButton
          onClick={async () => {
            setChecked(null);
            // error: NOT-WORTH — the app check only refreshes the app banner; this button reports the firmware (desktop.firmware.checkedOffline, or desktop.updateFeed.unsigned / .malformed)
            const [, lookup] = await Promise.all([window.desktop?.checkForUpdates().catch(() => undefined), fw.refreshLatest()]);
            setChecked(
              lookup.latest
                ? installed && isNewer(lookup.latest.version, installed)
                  ? t("desktop.firmware.checkedNewer", { version: lookup.latest.version })
                  : t("desktop.firmware.checkedCurrent")
                : lookup.problem === "unpublished"
                  ? t("desktop.firmware.checkedNone")
                  : t(feedProblemKey(lookup.problem, "desktop.firmware.checkedOffline")),
            );
          }}
        >
          {/* The same label as App settings → Updates' check (page rule 8). */}
          {t("desktop.setup.checkUpdates")}
        </BusyButton>
      </div>
      {checked && (
        <p className="dk-hint" role="status">
          {checked}
        </p>
      )}
      {/* hint: MUST-SHOW — a warning before Update: keep the board plugged in, press PS afterwards */}
      <p className="dk-hint">
        {t(
          "desktop.firmware.updateHint",
          "{{device, capitalize}} restarts into its bootloader, gets flashed and restarts on its own. Keep it plugged in; press the PS button on the controller afterwards.",
        )}
      </p>
    </>
  );
}

export function DeviceSection({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // `done` stays in the section: it says what to do next (a plain confirmation is a toast from the task instead).
  const act = async (task: () => Promise<void>, done: string | null) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage(done);
    } catch (cause) {
      // error: SHOWN — desktop.errors.boardFailed (causeText, with the other keyed board errors)
      setMessage(causeText(cause));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  return (
    <>
      {message && <p className="dk-hint">{message}</p>}
      <div className="dk-row-btns">
        <BusyButton
          className="dk-btn"
          disabled={!client || busy}
          onClick={() => act(() => client!.reboot(), t("desktop.firmware.rebooting", "Restarting… press the PS button on the controller once it's back."))}
        >
          {t("desktop.firmware.reboot")}
        </BusyButton>
        <BusyButton
          className="dk-btn"
          disabled={!client || busy}
          onClick={() => act(() => client!.enterBootsel(), t("desktop.firmware.bootsel", "{{device, capitalize}} is now an RP2350 drive. Copy a .uf2 onto it, or unplug it to cancel."))}
        >
          {t("desktop.firmware.enterBootsel", "Enter BOOTSEL mode")}
        </BusyButton>
        {confirmReset ? (
          <>
            <button type="button" className="dk-btn" onClick={() => setConfirmReset(false)}>
              {t("desktop.common.cancel", "Cancel")}
            </button>
            <BusyButton
              className="dk-btn danger"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await client!.factoryReset();
                  await bridge.readConfig();
                  announce("desktop.firmware.resetDone", "app_reset");
                }, null)
              }
            >
              {t("desktop.firmware.confirmReset", "Reset all settings")}
            </BusyButton>
          </>
        ) : (
          <button type="button" className="dk-btn danger" disabled={!client || busy} onClick={() => setConfirmReset(true)}>
            {t("desktop.firmware.factoryReset", "Factory reset…")}
          </button>
        )}
      </div>
      {/* hint: MUST-SHOW — what Factory reset keeps and loses, before you press it */}
      <p className="dk-hint">{t("desktop.firmware.resetHint", "Factory reset restores default settings. Pairings and button assignments are kept.")}</p>
    </>
  );
}
