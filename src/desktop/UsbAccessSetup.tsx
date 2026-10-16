import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "./controls";
import { logged } from "../errorText";
import { shownText } from "./shownError";

// Linux only: "Set up USB access", the one name for the one rule (via the main
// process and pkexec, linuxSetup.ts): the logged-in user can open the board
// and the RP2350 boot device (this app's WebUSB) and the controller's hidraw
// node (games' direct path: adaptive triggers, haptic feedback). Shown where
// the problem shows (page rule 7): the Pico 2 W page's Connection to the PC
// (a row), the setup screen (compact) and Games → This computer's Controller
// access (inline, after its "games can't reach the controller"); `onDone`
// lets that page read the access again.
export default function UsbAccessSetup({ variant = "row", onDone }: { variant?: "row" | "compact" | "inline"; onDone?: () => void }) {
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
    setMessage(shownText(result.message));
    if (result.ok) {
      setInstalled(true);
      onDone?.();
    }
  };
  const button = (
    <BusyButton className="dk-btn" disabled={installed === true} onClick={run}>
      {t("desktop.usbAccess.button", "Set up USB access")}
    </BusyButton>
  );

  if (variant === "inline")
    return (
      <span className="dk-usb-inline">
        {button}
        {message && <span className="dk-hint">{message}</span>}
      </span>
    );
  if (variant === "compact")
    return (
      <div className="dk-usb-compact">
        <div className="dk-ctl">{button}</div>
        {message && <p className="dk-hint">{message}</p>}
      </div>
    );
  return (
    <div className="dk-row">
      <span className="dk-label">
        {t("desktop.usbAccess.label", "USB access")}
        <span className="dk-sub">{installed ? t("desktop.usbAccess.installed", "Installed") : t("desktop.usbAccess.missing")}</span>
      </span>
      <div className="dk-ctl">{button}</div>
      {message && <p className="dk-hint">{message}</p>}
    </div>
  );
}
