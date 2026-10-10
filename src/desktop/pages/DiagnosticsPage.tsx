import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { AUDIO_COUNTER_NAMES, type AudioCounters } from "../../protocol/bridgeClient";
import { usePoll } from "../usePoll";

const LABELS: Record<(typeof AUDIO_COUNTER_NAMES)[number], string> = {
  usbFrames: "USB audio frames in",
  btOut: "Audio reports sent over BT",
  dropRaw: "Dropped: speaker PCM (core1 too slow)",
  dropEnc: "Dropped: encoded speaker",
  dropHap: "Dropped: haptics",
  core1Loops: "Core1 loop count",
  core1Encoded: "Speaker frames encoded",
  rawPushed: "Speaker chunks queued",
  hapPushed: "Haptic chunks queued",
  micFrames: "Mic frames decoded",
  micPlc: "Mic frames concealed (lost)",
  flashWrites: "Flash writes",
  flashFailures: "Flash write failures",
  setFeatureCount: "Host feature writes",
  setFeatureLast: "Last host feature write",
};
const RATE = new Set(["usbFrames", "btOut", "core1Encoded", "micFrames"]);
const BAD = new Set(["dropRaw", "dropEnc", "dropHap", "micPlc", "flashFailures"]);

// Live view of the 0xF5 counters (same data as scripts/audio_diag.py).
export default function DiagnosticsPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const prev = useRef<{ at: number; counters: AudioCounters } | null>(null);
  const live = usePoll(
    async () => {
      if (!client) return null;
      const counters = await client.readAudioCounters();
      const at = performance.now();
      const last = prev.current;
      prev.current = { at, counters };
      const rates: Partial<AudioCounters> = {};
      if (last) for (const k of AUDIO_COUNTER_NAMES) rates[k] = ((counters[k] - last.counters[k]) * 1000) / (at - last.at);
      return { counters, rates, core1Alive: !last || counters.core1Loops !== last.counters.core1Loops };
    },
    1000,
    Boolean(client),
  );
  const v = live.value;

  return (
    <div className="dk-grid">
      <section className="dk-card" style={{ gridColumn: "1 / -1" }}>
        <h2>{t("desktop.diag.title", "Audio pipeline counters")}</h2>
        {v && !v.core1Alive && <div className="dk-notice error">{t("desktop.diag.core1Frozen", "Core1 stopped: the audio path is dead until the dongle restarts.")}</div>}
        <table className="dk-table">
          <thead>
            <tr>
              <th>{t("desktop.diag.counter", "Counter")}</th>
              <th style={{ textAlign: "right" }}>{t("desktop.diag.total", "Total")}</th>
              <th style={{ textAlign: "right" }}>{t("desktop.diag.perSecond", "Per second")}</th>
            </tr>
          </thead>
          <tbody>
            {AUDIO_COUNTER_NAMES.map((k) => {
              const total = v?.counters[k];
              const isLast = k === "setFeatureLast";
              return (
                <tr key={k}>
                  <td>{t(`desktop.diag.counters.${k}`, LABELS[k])}</td>
                  <td className={`num${BAD.has(k) && total ? " dk-bad" : ""}`}>{total === undefined ? "—" : isLast ? `0x${total.toString(16).padStart(6, "0")}` : total.toLocaleString()}</td>
                  <td className="num">{RATE.has(k) && v?.rates[k] !== undefined ? Math.round(v.rates[k]!).toLocaleString() : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
