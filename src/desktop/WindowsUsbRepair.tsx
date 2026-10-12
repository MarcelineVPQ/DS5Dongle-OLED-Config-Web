import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WebUsbTransport } from "../protocol/webUsbTransport";

const POLL_MS = 2000;

// Windows only, on the "Plug in the DS5 Dongle" screen: when Windows kept an
// old answer for the dongle's USB IDs (a real DualSense plugged in by USB
// first), the dongle shows up but can't be opened. One button forgets that
// answer (UAC prompt, electron/main/windowsSetup.ts); the user then replugs.
export default function WindowsUsbRepair() {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const windows = desktop?.platform === "win32";
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Plugged in but not connected: the case this repairs.
  useEffect(() => {
    if (!windows) return;
    let live = true;
    const tick = () =>
      void WebUsbTransport.findPermitted()
        .then((d) => live && setSeen(!!d))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [windows]);

  if (!windows || !desktop) return null;

  const run = async () => {
    setBusy(true);
    setResult(await desktop.repairWindowsUsb());
    setBusy(false);
  };

  return (
    <div className="dk-setup-repair" data-testid="windows-usb-repair">
      <span className={seen ? "dk-bad" : "dk-hint"}>{seen ? t("desktop.windowsUsb.seen") : t("desktop.windowsUsb.hint")}</span>
      <button type="button" className={seen ? "dk-btn primary" : "dk-btn"} disabled={busy} onClick={() => void run()}>
        {busy ? t("desktop.windowsUsb.working") : t("desktop.windowsUsb.button")}
      </button>
      {result && <span className={result.ok ? "dk-good" : "dk-bad"}>{result.ok ? t("desktop.windowsUsb.done") : result.message}</span>}
    </div>
  );
}
