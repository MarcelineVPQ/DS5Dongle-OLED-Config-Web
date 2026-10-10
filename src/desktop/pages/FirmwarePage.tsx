import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import UsbAccessSetup from "../UsbAccessSetup";
import type { FirmwareUpdate } from "../useUpdates";

export default function FirmwarePage({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const act = async (task: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage(done);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
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
          <dd className="dk-mono">{fw.latest?.version ?? t("desktop.firmware.unknown", "unknown (offline?)")}</dd>
        </dl>
        <div className="dk-ctl" style={{ justifyContent: "flex-start", gap: 8, paddingBottom: 6 }}>
          <button type="button" className="dk-btn primary" disabled={!client || !fw.available || fw.state.phase === "running" || fw.state.phase === "verifying"} onClick={() => void fw.start()}>
            {fw.available ? t("desktop.firmware.update", { version: fw.latest?.version, defaultValue: "Update to {{version}}" }) : t("desktop.firmware.upToDate", "Up to date")}
          </button>
          <button type="button" className="dk-btn" onClick={() => void window.desktop?.checkForUpdates()}>
            {t("desktop.firmware.check", "Check now")}
          </button>
        </div>
        <p className="dk-hint">
          {t("desktop.firmware.updateHint", "The dongle restarts into its bootloader, gets flashed and restarts on its own. Keep it plugged in; press PS on the controller afterwards.")}
        </p>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.firmware.device", "Device")}</h2>
        {message && <p className="dk-hint">{message}</p>}
        <div className="dk-ctl" style={{ justifyContent: "flex-start", flexWrap: "wrap", paddingBottom: 6 }}>
          <button
            type="button"
            className="dk-btn"
            disabled={!client || busy}
            onClick={() => void act(() => client!.reboot(), t("desktop.firmware.rebooting", "Restarting… press PS on the controller once it's back."))}
          >
            {t("desktop.firmware.reboot", "Restart dongle")}
          </button>
          <button
            type="button"
            className="dk-btn"
            disabled={!client || busy}
            onClick={() => void act(() => client!.enterBootsel(), t("desktop.firmware.bootsel", "The dongle is now an RP2350 drive. Copy a .uf2 onto it, or unplug it to cancel."))}
          >
            {t("desktop.firmware.enterBootsel", "Enter BOOTSEL mode")}
          </button>
          {confirmReset ? (
            <>
              <button type="button" className="dk-btn" onClick={() => setConfirmReset(false)}>
                {t("desktop.common.cancel", "Cancel")}
              </button>
              <button
                type="button"
                className="dk-btn danger"
                disabled={busy}
                onClick={() =>
                  void act(
                    async () => {
                      await client!.factoryReset();
                      await bridge.readConfig();
                    },
                    t("desktop.firmware.resetDone", "Settings reset to defaults and saved."),
                  )
                }
              >
                {t("desktop.firmware.confirmReset", "Reset all settings")}
              </button>
            </>
          ) : (
            <button type="button" className="dk-btn danger" disabled={!client || busy} onClick={() => setConfirmReset(true)}>
              {t("desktop.firmware.factoryReset", "Factory reset…")}
            </button>
          )}
        </div>
        <p className="dk-hint">{t("desktop.firmware.resetHint", "Factory reset restores default settings. Pairings and button remaps are kept.")}</p>
        <UsbAccessSetup />
      </section>
    </div>
  );
}
