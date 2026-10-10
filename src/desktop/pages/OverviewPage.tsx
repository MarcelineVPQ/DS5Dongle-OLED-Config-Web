import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { usePoll } from "../usePoll";

// RP2350 die temperature from the raw 12-bit ADC (datasheet: 27 °C at 0.706 V,
// -1.721 mV/°C, 3.3 V reference).
export function adcToCelsius(raw: number): number {
  const volts = (raw * 3.3) / 4096;
  return 27 - (volts - 0.706) / 0.001721;
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Classic Bluetooth's HCI Read RSSI is not dBm: it is how far the link sits
// from the receiver's "golden" power range, so 0 means ideal and more negative
// means weaker.
export function signalQuality(rssi: number): "excellent" | "good" | "fair" | "weak" {
  if (rssi >= -5) return "excellent";
  if (rssi >= -15) return "good";
  if (rssi >= -25) return "fair";
  return "weak";
}

export default function OverviewPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const live = usePoll(
    async () => {
      if (!client) return null;
      const [identity, rssi, diag, cpu, audio] = await Promise.all([client.identity(), client.readRssi(), client.readDiag(), client.readCpu(), client.readAudioCounters()]);
      return { identity, rssi, diag, cpu, audio };
    },
    1000,
    Boolean(client),
  );
  const v = live.value;
  const c = bridge.config;
  const drops = v ? v.audio.dropRaw + v.audio.dropEnc + v.audio.dropHap : 0;

  return (
    <div className="dk-grid">
      <section className="dk-card">
        <h2>{t("desktop.overview.dongle", "Dongle")}</h2>
        <dl className="dk-kv">
          <dt>{t("desktop.overview.firmware", "Firmware")}</dt>
          <dd className="dk-mono">{bridge.firmwareVersion ?? "—"}</dd>
          <dt>{t("desktop.overview.protocol", "Protocol")}</dt>
          <dd className="dk-mono">{bridge.identity ? `${bridge.identity.protoMajor}.${bridge.identity.protoMinor}` : "—"}</dd>
          <dt>{t("desktop.overview.uptime", "Uptime")}</dt>
          <dd>{v ? formatUptime(v.diag.uptimeSeconds) : "—"}</dd>
          <dt>{t("desktop.overview.cpu", "CPU")}</dt>
          <dd>{v ? `${Math.round(v.cpu.measuredKhz / 1000)} MHz · ${adcToCelsius(v.cpu.tempRaw).toFixed(1)} °C` : "—"}</dd>
        </dl>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.overview.controller", "Controller")}</h2>
        <dl className="dk-kv">
          <dt>{t("desktop.overview.status", "Status")}</dt>
          <dd className={v?.identity.controllerConnected ? "dk-good" : ""}>
            {v ? (v.identity.controllerConnected ? t("desktop.overview.connected", "Connected") : t("desktop.overview.notConnected", "Not connected (press PS)")) : "—"}
          </dd>
          <dt>{t("desktop.overview.slot", "Pairing slot")}</dt>
          <dd>{v ? v.identity.currentSlot : "—"}</dd>
          <dt>{t("desktop.overview.signal", "Signal")}</dt>
          <dd>
            {v?.identity.controllerConnected ? `${t(`desktop.overview.signalQ.${signalQuality(v.rssi)}`, signalQuality(v.rssi))} (${v.rssi} ${t("desktop.overview.fromIdeal", "dB from ideal")})` : "—"}
          </dd>
        </dl>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.overview.audio", "Audio")}</h2>
        <dl className="dk-kv">
          <dt>{t("desktop.overview.stream", "Game audio")}</dt>
          <dd>{v ? (v.diag.peakSpeaker > 0 || v.diag.peakHaptic > 0 ? t("desktop.overview.streaming", "Streaming") : t("desktop.overview.idle", "Idle")) : "—"}</dd>
          <dt>{t("desktop.overview.drops", "Dropped audio chunks")}</dt>
          <dd className={drops > 0 ? "dk-bad" : ""}>{v ? drops : "—"}</dd>
          <dt>{t("desktop.overview.flashFails", "Failed saves")}</dt>
          <dd className={v && v.audio.flashFailures > 0 ? "dk-bad" : ""}>{v ? v.audio.flashFailures : "—"}</dd>
        </dl>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.overview.settings", "Current settings")}</h2>
        <dl className="dk-kv">
          <dt>{t("haptics.gainLabel")}</dt>
          <dd>{c ? `${c.hapticsGain.toFixed(1)}×` : "—"}</dd>
          <dt>{t("autoHaptics.sectionTitle")}</dt>
          <dd>{c ? t(`autoHaptics.modes.${["off", "fallback", "mix", "replace"][c.autoHapticsEnable & 3]}.label`) : "—"}</dd>
          <dt>{t("desktop.overview.unsaved", "Unsaved changes")}</dt>
          <dd>{bridge.hasUnsavedChanges ? t("desktop.overview.yes", "Yes") : t("desktop.overview.no", "No")}</dd>
        </dl>
      </section>
    </div>
  );
}
