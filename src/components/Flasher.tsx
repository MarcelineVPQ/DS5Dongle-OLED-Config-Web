// Flash firmware tab. Uses WebUSB + piersfinlayson/picoflash to push a
// .uf2 to a Pico 2 W that's in BOOTSEL mode (VID:2E8A PID:000F).

import { AlertTriangle, CheckCircle2, Cpu, FileUp, Usb, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PicoflashAPI, PicoflashHandle, parseUf2 } from "../flash";

type FlashStage =
  | "idle"
  | "parsing"
  | "connecting"
  | "writing"
  | "rebooting"
  | "done"
  | "error";

const FLASH_BASE_ADDRESS = 0x10000000; // RP2350 XIP flash base
const RP2350_FAMILY_ID = 0xe48bff57;

interface ParsedUf2 {
  fileName: string;
  byteSize: number;
  baseAddress: number;
  binary: Uint8Array;
}

export default function Flasher() {
  const { t } = useTranslation();
  const [uf2, setUf2] = useState<ParsedUf2 | null>(null);
  const [device, setDevice] = useState<PicoflashHandle | null>(null);
  const [stage, setStage] = useState<FlashStage>("idle");
  const [message, setMessage] = useState<string>("");

  const isBusy = stage === "parsing" || stage === "connecting" || stage === "writing" || stage === "rebooting";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("parsing");
    setMessage("");
    try {
      const buffer = await file.arrayBuffer();
      const { address, data } = parseUf2(buffer);
      // Sanity check on the binary size — guard against picking the wrong file.
      if (data.byteLength < 1024 || data.byteLength > 4 * 1024 * 1024) {
        throw new Error(`Unexpected firmware size: ${data.byteLength} bytes`);
      }
      if (address !== FLASH_BASE_ADDRESS) {
        throw new Error(`Unexpected base address 0x${address.toString(16)} — expected 0x${FLASH_BASE_ADDRESS.toString(16)}`);
      }
      setUf2({ fileName: file.name, byteSize: data.byteLength, baseAddress: address, binary: data });
      setStage("idle");
    } catch (err) {
      setStage("error");
      setMessage(err instanceof Error ? err.message : String(err));
      setUf2(null);
    }
  }

  async function handleConnect() {
    setStage("connecting");
    setMessage("");
    try {
      const handle = await PicoflashAPI.requestDevice();
      await handle.connect();
      setDevice(handle);
      setStage("idle");
      setMessage(`${t("flash.connected")}: ${handle.getTarget().toString()}`);
    } catch (err) {
      setStage("error");
      setMessage(err instanceof Error ? err.message : String(err));
      setDevice(null);
    }
  }

  async function handleFlash() {
    if (!uf2 || !device) return;
    setStage("writing");
    setMessage("");
    try {
      await device.flashEraseAndWrite(uf2.baseAddress, uf2.binary);
      setStage("rebooting");
      // Reboot RP2350 into normal mode. Flags=0 means reboot to application;
      // p0/p1 are unused for this flag.
      await device.rebootRp2350(0, 0, 0, 100);
      setStage("done");
      setMessage(t("flash.done"));
      setDevice(null); // device will reset and re-enumerate; the handle is stale
    } catch (err) {
      setStage("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const webUsbSupported = typeof navigator !== "undefined" && "usb" in navigator;

  return (
    <section className="card flasher-card">
      <div className="panel-title">
        <Zap size={18} />
        <h2>{t("flash.sectionTitle")}</h2>
      </div>
      <p className="panel-blurb">{t("flash.blurb")}</p>

      {!webUsbSupported && (
        <div className="flasher-warning">
          <AlertTriangle size={16} /> {t("flash.webusbUnavailable")}
        </div>
      )}

      <ol className="flasher-steps">
        <li>
          <div className="flasher-step-num">1</div>
          <div>
            <h3>{t("flash.step1Title")}</h3>
            <p>{t("flash.step1Hint")}</p>
            <input
              type="file"
              accept=".uf2"
              onChange={handleFileChange}
              disabled={isBusy}
              id="flasher-file"
              className="flasher-file-input"
            />
            <label htmlFor="flasher-file" className="button-secondary">
              <FileUp size={14} /> {uf2 ? uf2.fileName : t("flash.pickFile")}
            </label>
            {uf2 && (
              <span className="flasher-file-size">
                {(uf2.byteSize / 1024).toFixed(1)} KiB · 0x{uf2.baseAddress.toString(16).toUpperCase()}
              </span>
            )}
          </div>
        </li>

        <li>
          <div className="flasher-step-num">2</div>
          <div>
            <h3>{t("flash.step2Title")}</h3>
            <p>{t("flash.step2Hint")}</p>
            <button
              type="button"
              className="button-secondary"
              onClick={handleConnect}
              disabled={isBusy || !webUsbSupported}
              title={t("flash.connectTitle")}
            >
              <Usb size={14} /> {device ? t("flash.reconnect") : t("flash.connect")}
            </button>
            {device && <span className="flasher-device-ok"><CheckCircle2 size={14} /> {device.getTarget().toString()}</span>}
          </div>
        </li>

        <li>
          <div className="flasher-step-num">3</div>
          <div>
            <h3>{t("flash.step3Title")}</h3>
            <p>{t("flash.step3Hint")}</p>
            <button
              type="button"
              className="button-primary"
              onClick={handleFlash}
              disabled={!uf2 || !device || isBusy}
            >
              <Cpu size={14} /> {t("flash.flashButton")}
            </button>
          </div>
        </li>
      </ol>

      <div className={`flasher-status flasher-status-${stage}`}>
        <strong>{t(`flash.stage.${stage}`)}</strong>
        {message && <span className="flasher-status-msg">{message}</span>}
      </div>

      <details className="flasher-driver-help">
        <summary>{t("flash.driverHelpSummary")}</summary>
        <h4>Linux</h4>
        <p>{t("flash.driverHelpLinux")}</p>
        <pre><code>{`echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="2e8a", ATTRS{idProduct}=="000f", MODE="0666"' | sudo tee /etc/udev/rules.d/99-pico-bootsel.rules
sudo udevadm control --reload-rules && sudo udevadm trigger`}</code></pre>
        <h4>Windows</h4>
        <p>{t("flash.driverHelpWindows")} <a href="https://zadig.akeo.ie" target="_blank" rel="noopener noreferrer">Zadig</a>.</p>
        <h4>macOS</h4>
        <p>{t("flash.driverHelpMac")}</p>
      </details>
    </section>
  );
}
