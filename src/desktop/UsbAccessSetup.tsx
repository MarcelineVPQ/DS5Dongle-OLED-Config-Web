import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "./controls";
import { logged } from "../errorText";
import { shownText } from "./shownError";
import { REMOVE_SCRIPT, SANDBOX_PROFILE_PATH } from "./linuxRemoveScript";

// Linux only: "Set up USB access", the one name for the one rule (via the main
// process and pkexec, linuxSetup.ts): the logged-in user can open the board
// and the RP2350 boot device (this app's WebUSB) and the controller's hidraw
// node (games' direct path: adaptive triggers, haptic feedback). Shown where
// the problem shows (page rule 7): the Pico 2 W page's Connection to the PC
// (a row), the setup screen (compact) and Games → This computer's Controller
// access (inline, after its "games can't reach the controller"); `onDone`
// lets that page read the access again. The row (the Pico 2 W page) also
// offers its undo, Remove USB access setup, last (the section's danger zone).
export default function UsbAccessSetup({ variant = "row", onDone }: { variant?: "row" | "compact" | "inline"; onDone?: () => void }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The installed files Remove would delete (the row only; null: not read).
  const [files, setFiles] = useState<string[] | null>(null);

  // lifetime: OK — acquires nothing (one IPC check on mount)
  useEffect(() => {
    if (desktop?.platform !== "linux") return;
    desktop.usbAccessInstalled().then(setInstalled).catch(logged("checking for the USB access rule (unknown: the button stays offered)"));
    if (variant === "row") desktop.usbAccessFiles().then(setFiles).catch(logged("listing the USB access files (unknown: Remove isn't offered)"));
  }, [desktop, variant]);

  if (desktop?.platform !== "linux") return null;

  const run = async () => {
    const result = await desktop.setupUsbAccess();
    setMessage(shownText(result.message));
    if (result.ok) {
      setInstalled(true);
      onDone?.();
      if (variant === "row") desktop.usbAccessFiles().then(setFiles).catch(logged("listing the USB access files (unknown: Remove isn't offered)"));
    }
  };
  // Only while there's something to install or repair: once it's in place the
  // status says so, never a greyed-out button (no controls that do nothing).
  const button = installed !== true && (
    <BusyButton className="dk-btn" onClick={run}>
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
    <>
      <div className="dk-row">
        <span className="dk-label">
          {t("desktop.usbAccess.label", "USB access")}
          {!installed && <span className="dk-sub">{t("desktop.usbAccess.missing")}</span>}
        </span>
        <div className="dk-ctl">{button || <span className="dk-good">✓ {t("desktop.usbAccess.installed", "Installed")}</span>}</div>
        {message && <p className="dk-hint">{message}</p>}
      </div>
      {files && files.length > 0 && (
        <RemoveUsbAccess
          files={files}
          onResult={(result) => {
            setMessage(shownText(result.message));
            if (!result.ok) return;
            setInstalled(false);
            setFiles([]);
          }}
        />
      )}
    </>
  );
}

// Remove USB access setup (Linux): the setup's undo. First it says which files
// go and what stops working, and shows the exact script; only Remove runs it
// (pkexec asks for the password; cancelled, nothing changes). The result shows
// under the row above; Set up USB access puts the same files back.
function RemoveUsbAccess({ files, onResult }: { files: string[]; onResult: (result: { ok: boolean; message: string }) => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" onClick={() => setConfirming(true)}>
          {t("desktop.usbAccess.remove.button")}
        </button>
      </div>
    );
  // A rejected call reaches BusyButton (desktop.errors.actionFailed).
  const run = async () => {
    // error: SHOWN — desktop.usbAccess.remove.* (keyed text from the main process, shownText under the row)
    const result = await window.desktop!.removeUsbAccess();
    setConfirming(false);
    onResult(result);
  };
  return (
    <div className="dk-confirm">
      <p>{t("desktop.usbAccess.remove.confirm")}</p>
      <ul className="dk-review">
        {/* loop: HOT-PATH-OK — N ≤ 2 files; only while the question is open */}
        {files.map((file) => (
          <li key={file} className="dk-mono dk-file">
            {file}
          </li>
        ))}
      </ul>
      <p>{t(files.includes(SANDBOX_PROFILE_PATH) ? "desktop.usbAccess.remove.afterSandbox" : "desktop.usbAccess.remove.after")}</p>
      <p>{t("desktop.usbAccess.remove.scriptTitle")}</p>
      <pre className="dk-mono">{REMOVE_SCRIPT}</pre>
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" onClick={() => setConfirming(false)}>
          {t("desktop.common.cancel")}
        </button>
        <BusyButton className="dk-btn danger" onClick={run}>
          {t("desktop.usbAccess.remove.run")}
        </BusyButton>
      </div>
    </div>
  );
}
