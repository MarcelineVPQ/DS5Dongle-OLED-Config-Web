import { useState } from "react";
import { causeText } from "../shownError";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { isNewer, shortVersion } from "../../update/manifest";
import { BusyButton } from "../controls";
import UsbAccessSetup from "../UsbAccessSetup";
import { sayInPassing } from "../narrator";
import { feedProblemKey, type FirmwareUpdate } from "../useUpdates";
import { logged } from "../../errorText";

export default function FirmwarePage({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Flashing restarts the dongle: a second click confirms it (a stray click
  // on the update button flashed it before).
  const [confirmFlash, setConfirmFlash] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  const installed = bridge.firmwareVersion;

  const act = async (task: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage(done);
    } catch (cause) {
      // error: SHOWN — desktop.errors.boardFailed (causeText; other board errors English, batch E3)
      setMessage(causeText(cause));
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="dk-grid">
      <section className="dk-card">
        <h2>{t("desktop.firmware.installed", "Installed firmware")}</h2>
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
        <div className="dk-ctl" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, paddingBottom: 6 }}>
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
            {t("desktop.firmware.check", "Check now")}
          </BusyButton>
        </div>
        {checked && (
          <p className="dk-hint" role="status">
            {checked}
          </p>
        )}
        <p className="dk-hint">
          {t(
            "desktop.firmware.updateHint",
            "{{device, capitalize}} restarts into its bootloader, gets flashed and restarts on its own. Keep it plugged in; press the PS button on the controller afterwards.",
          )}
        </p>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.firmware.device", "Device")}</h2>
        {message && <p className="dk-hint">{message}</p>}
        <div className="dk-ctl" style={{ justifyContent: "flex-start", flexWrap: "wrap", paddingBottom: 6 }}>
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
                  act(
                    async () => {
                      await client!.factoryReset();
                      await bridge.readConfig();
                      sayInPassing("app_reset");
                    },
                    t("desktop.firmware.resetDone", "Settings reset to defaults and saved."),
                  )
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
        <p className="dk-hint">{t("desktop.firmware.resetHint", "Factory reset restores default settings. Pairings and button assignments are kept.")}</p>
        <UsbAccessSetup />
      </section>
    </div>
  );
}
