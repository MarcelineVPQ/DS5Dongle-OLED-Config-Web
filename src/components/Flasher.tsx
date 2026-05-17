// Flash firmware tab. Uses WebUSB + piersfinlayson/picoflash to push a
// .uf2 to a Pico 2 W that's in BOOTSEL mode (VID:2E8A PID:000F).
//
// QoL ports from picoflash.org: timestamped activity log, simulated
// progress bar (driven by interval + FLASH_SPEED estimate, since picoflash
// itself has no real progress callback), device-info strip showing
// model + serial + state, withTimeout/tryRecover for failure paths,
// standalone Reboot button. UI structure is React but the patterns
// match piersfinlayson/picoflash's reference implementation.

import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileUp,
  Power,
  Usb,
  Zap,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PicoflashAPI, PicoflashHandle, parseUf2Regions, Uf2Region } from "../flash";

interface LatestFirmwareMeta {
  tag: string;        // git tag, e.g. "v0.6.0-oled-edition"
  title: string;      // pretty release title, e.g. "v0.6.0 — OLED Edition"
  assetName: string;  // UF2 filename, e.g. "ds5-bridge-oled-v0.6.0-oled-edition.uf2"
  size: number;
  sha256?: string;    // hex digest of the UF2, written by deploy.yml from `sha256sum`
  publishedAt: string;
}

type Uf2Source = "file" | "latest";

type FlashStage =
  | "idle"
  | "parsing"
  | "connecting"
  | "writing"
  | "rebooting"
  | "done"
  | "error";

type Op = null | "flash" | "reboot";

interface LogEntry {
  ts: string;
  msg: string;
  severity: "info" | "success" | "warning" | "error";
}

const FLASH_BASE_ADDRESS = 0x10000000;            // RP2350 XIP flash base
const FLASH_SPEED_BPS    = 80 * 1024;             // picoflash.org's estimate
const TIMEOUT_BUFFER_MS  = 5000;                  // baseline timeout slack
const TIMEOUT_VARIANCE   = 1.1;                   // 10 % padding
const REBOOT_DELAY_MS    = 100;                   // ms before reboot fires
const SHOW_LOGS_KEY      = "flasher-show-logs";

interface ParsedUf2 {
  fileName: string;
  regions: Uf2Region[];
  totalBytes: number;
  sha256: string;       // hex digest of the raw UF2 file
  source: Uf2Source;    // 'file' = user-supplied, 'latest' = trusted CI-bundled
  expectedSha256?: string; // for 'latest' source, the hash CI computed; compared against sha256
}

// ---- helpers ----------------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function calcTimeoutMs(byteCount: number): number {
  const base = (1000 * byteCount) / FLASH_SPEED_BPS + TIMEOUT_BUFFER_MS;
  return Math.max(base, base * TIMEOUT_VARIANCE);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  const rounded = Math.round(ms / 100) * 100;
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${rounded}ms`)), rounded),
    ),
  ]);
}

function logReducer(state: LogEntry[], action: LogEntry | { type: "clear" }): LogEntry[] {
  if ("type" in action && action.type === "clear") return [];
  return [...state, action as LogEntry];
}

// ---- component --------------------------------------------------------------

export default function Flasher() {
  const { t } = useTranslation();
  const [uf2, setUf2] = useState<ParsedUf2 | null>(null);
  const [device, setDevice] = useState<PicoflashHandle | null>(null);
  const [stage, setStage] = useState<FlashStage>("idle");
  const [op, setOp] = useState<Op>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [progressErrored, setProgressErrored] = useState(false);
  const [logs, dispatchLog] = useReducer(logReducer, []);
  const [showLogs, setShowLogs] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_LOGS_KEY) === "true";
  });
  const [latestMeta, setLatestMeta] = useState<LatestFirmwareMeta | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  const isBusy = op !== null || stage === "parsing" || stage === "connecting";
  const webUsbSupported = typeof navigator !== "undefined" && "usb" in navigator;

  function log(msg: string, severity: LogEntry["severity"] = "info") {
    dispatchLog({ ts: new Date().toLocaleTimeString(), msg, severity });
  }

  // Persist log-panel visibility across reloads.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SHOW_LOGS_KEY, showLogs ? "true" : "false");
    }
  }, [showLogs]);

  // Auto-scroll the log panel to the bottom whenever a new entry is appended.
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Probe for the CI-bundled latest-release metadata. If absent (e.g. local
  // dev where the workflow hasn't run), the "use latest" button stays hidden.
  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}firmware-latest.json`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta: LatestFirmwareMeta | null) => meta && setLatestMeta(meta))
      .catch(() => { /* no bundled firmware; that's fine */ });
  }, []);

  // Cleanup any leftover progress interval on unmount.
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current !== null) {
        window.clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // ---- progress driver -----------------------------------------------------

  function startProgressTimer(totalBytes: number) {
    setProgressPct(1);
    setProgressErrored(false);
    const estimatedMs = (totalBytes / FLASH_SPEED_BPS) * 1000;
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, Math.floor((elapsed / estimatedMs) * 100));
      setProgressPct(pct);
    }, 100);
    progressIntervalRef.current = id;
  }

  function stopProgressTimer(finalPct: number, errored: boolean) {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgressPct(finalPct);
    setProgressErrored(errored);
  }

  // ---- UF2 loading ---------------------------------------------------------

  async function ingestUf2(
    fileName: string,
    buffer: ArrayBuffer,
    source: Uf2Source,
    expectedSha256?: string,
  ) {
    const regions = parseUf2Regions(buffer);
    if (regions.length === 0) throw new Error("UF2 contains no blocks");
    if (regions[0].address !== FLASH_BASE_ADDRESS) {
      throw new Error(
        `First region at 0x${regions[0].address.toString(16)} — expected 0x${FLASH_BASE_ADDRESS.toString(16)}`,
      );
    }
    const totalBytes = regions.reduce((n, r) => n + r.data.byteLength, 0);
    if (totalBytes < 1024 || totalBytes > 4 * 1024 * 1024) {
      throw new Error(`Unexpected total firmware size: ${totalBytes} bytes across ${regions.length} regions`);
    }
    const sha256 = await sha256Hex(buffer);
    setUf2({ fileName, regions, totalBytes, sha256, source, expectedSha256 });
    setStage("idle");
    log(`Loaded UF2: ${fileName} — ${formatBytes(totalBytes)} · sha256 ${sha256.slice(0, 16)}…`, "success");
    if (expectedSha256 && expectedSha256.toLowerCase() !== sha256.toLowerCase()) {
      log(
        `Integrity warning: bundled SHA-256 ${expectedSha256.slice(0, 16)}… ≠ computed ${sha256.slice(0, 16)}… — UF2 was modified after CI built it.`,
        "warning",
      );
    }
  }

  async function handleUseLatest() {
    if (!latestMeta) return;
    setStage("parsing");
    try {
      log(`Fetching ${latestMeta.assetName} (${latestMeta.title})...`);
      const r = await fetch(`${import.meta.env.BASE_URL}firmware-latest.uf2`);
      if (!r.ok) throw new Error(`Fetch failed: HTTP ${r.status}`);
      await ingestUf2(latestMeta.assetName, await r.arrayBuffer(), "latest", latestMeta.sha256);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`Failed to load latest release: ${m}`, "error");
      setStage("error");
      setUf2(null);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("parsing");
    try {
      await ingestUf2(file.name, await file.arrayBuffer(), "file");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`Failed to parse UF2: ${m}`, "error");
      setStage("error");
      setUf2(null);
    }
  }

  // ---- recovery ------------------------------------------------------------

  /** Best-effort cleanup after a failed op. Returns true if the handle is still usable. */
  async function tryRecover(handle: PicoflashHandle): Promise<boolean> {
    log("Attempting to recover Pico connection...", "warning");
    try {
      await handle.disconnect();
      log("Disconnected cleanly; click Connect to re-authorize the device.", "info");
      return false;
    } catch {
      log("Pico connection could not be recovered — replug in BOOTSEL and reload.", "error");
      return false;
    }
  }

  // ---- connect / flash / reboot --------------------------------------------

  async function handleConnect() {
    setStage("connecting");
    try {
      log("Requesting USB device authorization...");
      const handle = await PicoflashAPI.requestDevice();
      setDevice(handle);
      const info = handle.getUsbDeviceInfo();
      log(`Authorized: ${handle.getTarget().toString()} · serial ${info.serialNumber || "?"}`, "success");
      setStage("idle");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`Connect failed: ${m}`, "error");
      setStage("error");
      setDevice(null);
    }
  }

  async function handleFlash() {
    if (!uf2 || !device) return;
    setOp("flash");
    setStage("writing");
    startProgressTimer(uf2.totalBytes);
    log(`Flashing ${uf2.fileName} (${formatBytes(uf2.totalBytes)})...`);
    try {
      // Open + claim once for the whole sequence so each region's
      // flashEraseAndWrite call uses the existing connection (wasConnected
      // = true → it won't disconnect between regions, just resetInterface).
      await device.connect();
      for (let i = 0; i < uf2.regions.length; i++) {
        const r = uf2.regions[i];
        const label = `region ${i + 1}/${uf2.regions.length} (${formatBytes(r.data.byteLength)} @ 0x${r.address.toString(16)})`;
        log(`Writing ${label}`);
        await withTimeout(
          () => device.flashEraseAndWrite(r.address, r.data),
          calcTimeoutMs(r.data.byteLength),
          label,
        );
      }
      setStage("rebooting");
      log("Rebooting Pico into the new firmware...");
      // rebootRp2350(0, 0, 0, delay) = reboot to application. Same as
      // the standalone Reboot button.
      await device.rebootRp2350(0, 0, 0, REBOOT_DELAY_MS);
      stopProgressTimer(100, false);
      setStage("done");
      log("Done — Pico is rebooting into the new firmware.", "success");
      setDevice(null); // device will reset and re-enumerate; the handle is stale
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`Error during flash: ${m}`, "error");
      stopProgressTimer(progressPct, true);
      setStage("error");
      await tryRecover(device);
      setDevice(null);
    } finally {
      setOp(null);
    }
  }

  async function handleReboot() {
    if (!device) return;
    setOp("reboot");
    setStage("rebooting");
    log("Rebooting Pico into application mode...");
    try {
      await device.connect();
      await withTimeout(
        () => device.rebootRp2350(0, 0, 0, REBOOT_DELAY_MS),
        5_000,
        "Reboot",
      );
      setStage("done");
      log("Reboot command sent.", "success");
      setDevice(null);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log(`Error during reboot: ${m}`, "error");
      setStage("error");
      await tryRecover(device);
      setDevice(null);
    } finally {
      setOp(null);
    }
  }

  // ---- derived display values ----------------------------------------------

  const deviceModel = device?.getTarget().toString() ?? "—";
  const deviceSerial = device?.getUsbDeviceInfo().serialNumber ?? "—";
  const stateLabel = t(`flash.stage.${stage}`);

  // ---- render --------------------------------------------------------------

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

      {/* Device info strip — model / serial / state */}
      <div className="flasher-device-strip">
        <div><span className="label">{t("flash.info.device")}</span><span className="num">{deviceModel}</span></div>
        <div><span className="label">{t("flash.info.serial")}</span><span className="num">{deviceSerial}</span></div>
        <div><span className="label">{t("flash.info.state")}</span><span className="num">{stateLabel}</span></div>
      </div>

      {/* Progress bar */}
      <div className="flasher-progress" aria-hidden={progressPct === 0 && !progressErrored}>
        <div
          className={`flasher-progress-fill ${progressErrored ? "errored" : ""}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

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
                  title={`${latestMeta.assetName} (${formatBytes(latestMeta.size)})`}
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
              <div className="flasher-file-meta">
                <span className="flasher-file-size">
                  {formatBytes(uf2.totalBytes)} · {uf2.regions.length} region{uf2.regions.length === 1 ? "" : "s"}
                </span>
                <span
                  className="flasher-file-hash"
                  title={`SHA-256: ${uf2.sha256}`}
                >
                  sha256 {uf2.sha256.slice(0, 16)}…
                </span>
              </div>
            )}
            {uf2?.source === "file" && (
              <div className="flasher-warning flasher-warning-trust">
                <AlertTriangle size={14} />
                <span>{t("flash.trustWarning")}</span>
              </div>
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
            {device && (
              <span className="flasher-device-ok">
                <CheckCircle2 size={14} /> {device.getTarget().toString()}
              </span>
            )}
          </div>
        </li>

        <li>
          <div className="flasher-step-num">3</div>
          <div>
            <h3>{t("flash.step3Title")}</h3>
            <p>{t("flash.step3Hint")}</p>
            <div className="flasher-action-row">
              <button
                type="button"
                className="button-primary"
                onClick={handleFlash}
                disabled={!uf2 || !device || isBusy}
              >
                <Cpu size={14} /> {op === "flash" ? t("flash.flashingButton") : t("flash.flashButton")}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={handleReboot}
                disabled={!device || isBusy}
                title={t("flash.rebootTitle")}
              >
                <Power size={14} /> {op === "reboot" ? t("flash.rebootingButton") : t("flash.rebootButton")}
              </button>
            </div>
          </div>
        </li>
      </ol>

      {/* Activity log toggle + panel */}
      <div className="flasher-log-toggle">
        <button
          type="button"
          className="button-link"
          onClick={() => setShowLogs((v) => !v)}
        >
          {showLogs ? t("flash.hideLogs") : t("flash.showLogs")} ({logs.length})
        </button>
        {logs.length > 0 && (
          <button
            type="button"
            className="button-link"
            onClick={() => dispatchLog({ type: "clear" })}
          >
            {t("flash.clearLogs")}
          </button>
        )}
      </div>
      {showLogs && (
        <div className="flasher-log" ref={logScrollRef}>
          {logs.length === 0 && <div className="log-entry log-info">{t("flash.logEmpty")}</div>}
          {logs.map((entry, i) => (
            <div key={i} className={`log-entry log-${entry.severity}`}>
              [{entry.ts}] {entry.msg}
            </div>
          ))}
        </div>
      )}

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
