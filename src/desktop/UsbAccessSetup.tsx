import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Linux only: installs the app's udev rule (via the main process and pkexec)
// so the logged-in user can open the dongle and the RP2350 boot device.
export default function UsbAccessSetup({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (desktop?.platform !== "linux") return;
    void desktop.usbAccessInstalled().then(setInstalled);
  }, [desktop]);

  if (desktop?.platform !== "linux") return null;

  const run = async () => {
    setBusy(true);
    const result = await desktop.setupUsbAccess();
    setMessage(result.message);
    if (result.ok) setInstalled(true);
    setBusy(false);
  };

  return (
    <div className={compact ? "" : "dk-row"} style={compact ? { marginTop: 10 } : undefined}>
      {!compact && (
        <span className="dk-label">
          {t("desktop.usbAccess.label", "USB access rule")}
          <span className="dk-sub">{installed ? t("desktop.usbAccess.installed", "Installed") : t("desktop.usbAccess.missing", "Not installed (Steam's rules may already cover the dongle)")}</span>
        </span>
      )}
      <div className="dk-ctl" style={compact ? { justifyContent: "center" } : undefined}>
        <button type="button" className="dk-btn" disabled={busy || installed === true} onClick={() => void run()}>
          {busy ? t("desktop.usbAccess.working", "Waiting for password…") : t("desktop.usbAccess.button", "Set up USB access")}
        </button>
      </div>
      {message && <p className="dk-hint">{message}</p>}
    </div>
  );
}
