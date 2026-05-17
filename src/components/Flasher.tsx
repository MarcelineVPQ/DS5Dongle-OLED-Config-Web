// Flash firmware tab. Uses WebUSB + piersfinlayson/picoflash to push a
// .uf2 to a Pico 2 W that's in BOOTSEL mode (VID:2E8A PID:000F).

import { AlertTriangle, CheckCircle2, Cpu, Download, FileUp, Usb, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PicoflashAPI, PicoflashHandle, parseUf2Regions, Uf2Region } from "../flash";

interface LatestFirmwareMeta {
  tag: string;        // git tag, e.g. "v0.6.0-oled-edition"
  title: string;      // pretty release title, e.g. "v0.6.0 — OLED Edition"
  assetName: string;  // UF2 filename, e.g. "ds5-bridge-oled-v0.6.0-oled-edition.uf2"
  size: number;
  publishedAt: string;
}

type FlashStage =
  | "idle"
  | "parsing"
  | "connecting"
  | "writing"
  | "rebooting"
  | "done"
  | "error";

const FLASH_BASE_ADDRESS = 0x10000000; // RP2350 XIP flash base

interface ParsedUf2 {
  fileName: string;
  regions: Uf2Region[];
  totalBytes: number;
}

export default function Flasher() {
  const { t } = useTranslation();
  const [uf2, setUf2] = useState<ParsedUf2 | null>(null);
  const [device, setDevice] = useState<PicoflashHandle | null>(null);
  const [stage, setStage] = useState<FlashStage>("idle");
  const [message, setMessage] = useState<string>("");
  const [latestMeta, setLatestMeta] = useState<LatestFirmwareMeta | null>(null);

  const isBusy = stage === "parsing" || stage === "connecting" || stage === "writing" || stage === "rebooting";

  // Probe for the CI-bundled latest-release metadata. If absent (e.g. local
  // dev where the workflow hasn't run), the "use latest" button stays hidden.
  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}firmware-latest.json`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: LatestFirmwareMeta | null) => meta && setLatestMeta(meta))
      .catch(() => { /* no bundled firmware; that's fine */ });
  }, []);

  async function handleUseLatest() {
    if (!latestMeta) return;
    setStage("parsing");
    setMessage("");
    try {
      const url = `${import.meta.env.BASE_URL}firmware-latest.uf2`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Fetch failed: HTTP ${r.status}`);
      ingestUf2(latestMeta.assetName, await r.arrayBuffer());
    } catch (err) {
      setStage("error");
      setMessage(err instanceof Error ? err.message : String(err));
      setUf2(null);
    }
  }

  function ingestUf2(fileName: string, buffer: ArrayBuffer) {
    const regions = parseUf2Regions(buffer);
    if (regions.length === 0) throw new Error("UF2 contains no blocks");
    if (regions[0].address !== FLASH_BASE_ADDRESS) {
      throw new Error(`First region at 0x${regions[0].address.toString(16)} — expected 0x${FLASH_BASE_ADDRESS.toString(16)}`);
    }
    const totalBytes = regions.reduce((n, r) => n + r.data.byteLength, 0);
    if (totalBytes < 1024 || totalBytes > 4 * 1024 * 1024) {
      throw new Error(`Unexpected total firmware size: ${totalBytes} bytes across ${regions.length} regions`);
    }
    setUf2({ fileName, regions, totalBytes });
    setStage("idle");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("parsing");
    setMessage("");
    try {
      ingestUf2(file.name, await file.arrayBuffer());
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
      // Don't open / claim the interface here — just request authorization.
      // picoflash's flashEraseAndWrite() and rebootRp2350() both manage the
      // open / claim / release lifecycle internally; holding the device open
      // between the Connect click and the Flash click invites stale-session
      // transferOut errors.
      const handle = await PicoflashAPI.requestDevice();
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
      // Open + claim once for the whole sequence so each region's
      // flashEraseAndWrite call uses the existing connection (wasConnected
      // = true → it won't disconnect between regions, just resetInterface).
      await device.connect();
      for (let i = 0; i < uf2.regions.length; i++) {
        const r = uf2.regions[i];
        setMessage(`region ${i + 1}/${uf2.regions.length}: ${r.data.byteLength} B @ 0x${r.address.toString(16)}`);
        await device.flashEraseAndWrite(r.address, r.data);
      }
      setStage("rebooting");
      setMessage("");
      // Reboot RP2350 into application mode. Flags=0 = reboot-to-application;
      // p0/p1 unused for this flag.
      await device.rebootRp2350(0, 0, 0, 100);
      setStage("done");
      setMessage(t("flash.done"));
      setDevice(null); // device will reset and re-enumerate; the handle is stale
    } catch (err) {
      setStage("error");
      setMessage(err instanceof Error ? err.message : String(err));
      try { await device.disconnect(); } catch { /* device may already be gone */ }
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
            <div className="flasher-source-row">
              {latestMeta && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleUseLatest}
                  disabled={isBusy}
                  title={`${latestMeta.assetName} (${(latestMeta.size / 1024).toFixed(1)} KiB)`}
                >
                  <Download size={14} /> {t("flash.useLatest", { title: latestMeta.title })}
                </button>
              )}
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
            </div>
            {uf2 && (
              <span className="flasher-file-size">
                {(uf2.totalBytes / 1024).toFixed(1)} KiB · {uf2.regions.length} region{uf2.regions.length === 1 ? "" : "s"}
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
