import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "./controls";
import { logged } from "../errorText";

// Linux only: installs the app's udev rule (via the main process and pkexec)
// so the logged-in user can open the dongle and the RP2350 boot device.
export default function UsbAccessSetup({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // lifetime: OK — acquires nothing (one IPC check on mount)
  useEffect(() => {
    if (desktop?.platform !== "linux") return;
    desktop.usbAccessInstalled().then(setInstalled).catch(logged("checking for the USB access rule (unknown: the button stays offered)"));
  }, [desktop]);

  if (desktop?.platform !== "linux") return null;

  const run = async () => {
    const result = await desktop.setupUsbAccess();
    setMessage(result.message);
    if (result.ok) setInstalled(true);
  };

  return (
    <div className={compact ? "" : "dk-row"} style={compact ? { marginTop: 10 } : undefined}>
      {!compact && (
        <span className="dk-label">
          {t("desktop.usbAccess.label", "USB access rule")}
          <span className="dk-sub">{installed ? t("desktop.usbAccess.installed", "Installed") : t("desktop.usbAccess.missing", "Not installed (Steam's rules may already cover {{device}})")}</span>
        </span>
      )}
      <div className="dk-ctl" style={compact ? { justifyContent: "center" } : undefined}>
        <BusyButton className="dk-btn" disabled={installed === true} onClick={run}>
          {t("desktop.usbAccess.button", "Set up USB access")}
        </BusyButton>
      </div>
      {message && <p className="dk-hint">{message}</p>}
    </div>
  );
}
