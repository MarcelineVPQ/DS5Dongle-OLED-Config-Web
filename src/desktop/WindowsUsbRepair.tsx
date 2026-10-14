import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WebUsbTransport } from "../protocol/webUsbTransport";
import { usePoll } from "./usePoll";
import { BusyButton } from "./controls";
import { REPAIR_SCRIPT } from "./windowsRepairScript";

const POLL_MS = 2000;
const STEPS = ["admin", "forget", "entries", "replug"] as const;

// Windows only, on the "Plug in the DS5 Dongle" screen: when Windows kept an
// old answer for the dongle's USB IDs (a real DualSense plugged in by USB
// first), the dongle shows up but can't be opened. The button first says,
// step by step, what the repair will do and shows the exact script; only
// "Run the repair" runs it (UAC prompt, electron/main/windowsSetup.ts). The
// user then replugs.
export default function WindowsUsbRepair() {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const windows = desktop?.platform === "win32";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Plugged in but not connected: the case this repairs (polled only while
  // the window is shown).
  const seen = !!usePoll(() => WebUsbTransport.findPermitted(), POLL_MS, windows).value;

  if (!windows || !desktop) return null;

  const run = async () => {
    setBusy(true);
    setResult(await desktop.repairWindowsUsb());
    setBusy(false);
    setConfirming(false);
  };

  return (
    <div className="dk-setup-repair" data-testid="windows-usb-repair">
      <span className={seen ? "dk-bad" : "dk-hint"}>{seen ? t("desktop.windowsUsb.seen") : t("desktop.windowsUsb.hint")}</span>
      {confirming ? (
        <div className="dk-setup-steps">
          <strong>{t("desktop.windowsUsb.stepsTitle")}</strong>
          <ol>
            {/* loop: HOT-PATH-OK — N = 4 steps; re-render per USB poll on Windows only */}
            {STEPS.map((step) => (
              <li key={step}>{t(`desktop.windowsUsb.step.${step}`)}</li>
            ))}
          </ol>
          <details>
            <summary>{t("desktop.windowsUsb.showScript")}</summary>
            <pre className="dk-mono">{REPAIR_SCRIPT}</pre>
          </details>
          <div className="dk-setup-steps-actions">
            <button type="button" className="dk-btn" disabled={busy} onClick={() => setConfirming(false)}>
              {t("desktop.windowsUsb.cancel")}
            </button>
            {/* autoFocus: Enter runs it, the obvious next step after reading */}
            <BusyButton className="dk-btn primary" autoFocus onClick={run}>
              {t("desktop.windowsUsb.run")}
            </BusyButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={seen ? "dk-btn primary" : "dk-btn"}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
        >
          {t("desktop.windowsUsb.button")}
        </button>
      )}
      {result && <span className={result.ok ? "dk-good" : "dk-bad"}>{result.ok ? t("desktop.windowsUsb.done") : result.message}</span>}
    </div>
  );
}
