// The dongle's live diagnostics under its console, in two groups: the
// Pico 2 W (chip temperature, clock and core voltage as dials; USB, Bluetooth
// and signal as graphs over the last minute; the audio pipeline's counters,
// with anything that went wrong lit) and the OLED (what it's doing). One poll
// a second reads everything the firmware reports (0xFB diag, 0xFC CPU, 0xF5
// audio counters, 0xF9 RSSI, 0xEF mirror header).
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { AUDIO_COUNTER_NAMES, type AudioCounters } from "../../protocol/bridgeClient";
import { SCREEN_NAMES } from "../../oled/screenNames";
import { adcToCelsius, formatUptime, signalQuality } from "../format";
import { usePoll } from "../usePoll";
import { supportsOledMirror } from "./DongleConsole";

const HISTORY = 60;

interface Sample {
  at: number;
  tempC: number;
  setMhz: number;
  realMhz: number;
  vcore: number | null;
  uptime: number;
  usbFps: number;
  btPps: number;
  rssi: number;
  peaks: [number, number]; // speaker, haptics 0..1
  hciErrors: number;
  counters: AudioCounters;
  core1Alive: boolean;
  oled: { power: string; screen: number; contrast: number; fps: number } | null;
}

// Core voltage codes 0..15 are 0.55 V + 0.05 V steps (the firmware's CPU screen).
const vcoreVolts = (code: number) => (code <= 15 ? (550 + 50 * code) / 1000 : null);

function useDongleTelemetry(bridge: UseDs5BridgeResult) {
  const client = bridge.client;
  const mirror = supportsOledMirror(bridge.identity);
  const history = useRef<Sample[]>([]);
  const prev = useRef<{ at: number; usb: number; bt: number; loops: number; seq: number } | null>(null);
  const sample = usePoll(
    async () => {
      if (!client) return null;
      const [diag, cpu, counters, rssi, frame] = await Promise.all([
        client.readDiag(),
        client.readCpu(),
        client.readAudioCounters(),
        client.readRssi().catch(() => 0),
        mirror ? client.readOledFrame().catch(() => null) : Promise.resolve(null),
      ]);
      const at = performance.now();
      const p = prev.current;
      const dt = p ? (at - p.at) / 1000 : 0;
      const rate = (now: number, then: number | undefined) => (p && dt > 0 && then !== undefined ? Math.max(0, (now - then) / dt) : 0);
      const s: Sample = {
        at,
        tempC: adcToCelsius(cpu.tempRaw),
        setMhz: cpu.setKhz / 1000,
        realMhz: cpu.measuredKhz / 1000,
        vcore: vcoreVolts(cpu.vregCode),
        uptime: diag.uptimeSeconds,
        usbFps: rate(diag.usbFrames, p?.usb),
        btPps: rate(diag.btPackets, p?.bt),
        rssi,
        peaks: [diag.peakSpeaker / 255, diag.peakHaptic / 255],
        hciErrors: diag.hciErrors,
        counters,
        core1Alive: !p || counters.core1Loops !== p.loops,
        oled: frame ? { power: frame.power, screen: frame.screen, contrast: frame.contrast, fps: p ? Math.round(rate(frame.seq + (frame.seq < (p.seq & 0xff) ? 256 : 0), p.seq & 0xff)) : 0 } : null,
      };
      prev.current = { at, usb: diag.usbFrames, bt: diag.btPackets, loops: counters.core1Loops, seq: frame?.seq ?? 0 };
      history.current = [...history.current.slice(-(HISTORY - 1)), s];
      return s;
    },
    1000,
    Boolean(client),
  ).value;
  return { sample, history: history.current };
}

export default function DongleDashboard({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const { sample: s, history } = useDongleTelemetry(bridge);
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.${k}`, o);
  if (!bridge.client) return null;
  const series = (pick: (x: Sample) => number) => history.map(pick);
  const config = bridge.config;

  return (
    <div className="dash">
      <h3 className="dash-group">{td("pico")}</h3>
      <div className="dash-row">
        <Gauge label={td("temperature")} value={s?.tempC} min={20} max={85} unit="°C" digits={1} warn={60} bad={72} />
        <Gauge label={td("clock")} value={s?.realMhz} min={0} max={Math.max(150, Math.ceil((s?.setMhz ?? 150) * 1.1))} unit="MHz" sub={s ? td("clockSet", { mhz: Math.round(s.setMhz) }) : undefined} />
        <Gauge label={td("vcore")} value={s?.vcore ?? undefined} min={0.85} max={1.3} unit="V" digits={2} warn={1.2} bad={1.26} />
        <div className="dash-card dash-facts">
          <Fact label={td("uptime")} value={s ? formatUptime(s.uptime) : "—"} />
          <Fact label={td("protocol")} value={bridge.identity ? `${bridge.identity.protoMajor}.${bridge.identity.protoMinor}` : "—"} />
          <Fact label={td("firmware")} value={bridge.firmwareVersion ?? "—"} />
          <Fact label={td("hciErrors")} value={s ? String(s.hciErrors) : "—"} bad={!!s?.hciErrors} />
        </div>
      </div>
      <div className="dash-row">
        <Graph label={td("usb")} unit="/s" values={series((x) => x.usbFps)} now={s?.usbFps} />
        <Graph label={td("bt")} unit="/s" values={series((x) => x.btPps)} now={s?.btPps} />
        <Graph label={td("signal")} unit="dB" values={series((x) => x.rssi)} now={s?.rssi} note={s ? t(`desktop.overview.signalQ.${signalQuality(s.rssi)}`) : undefined} />
        <Graph label={td("tempHistory")} unit="°C" values={series((x) => x.tempC)} now={s?.tempC} digits={1} />
      </div>
      <div className="dash-row">
        <div className="dash-card dash-wide">
          <h4>{td("audio")}</h4>
          {s && !s.core1Alive && <div className="dk-notice error">{t("desktop.diag.core1Frozen", "Core1 stopped: the audio path is dead until the dongle restarts.")}</div>}
          <div className="dash-levels">
            <Level label={td("speakerPeak")} value={s?.peaks[0] ?? 0} />
            <Level label={td("hapticPeak")} value={s?.peaks[1] ?? 0} />
          </div>
          <div className="dash-counters">
            {AUDIO_COUNTER_NAMES.filter((k) => k !== "setFeatureLast" && k !== "core1Loops").map((k) => (
              <Fact key={k} label={t(`desktop.diag.counters.${k}`)} value={s ? s.counters[k].toLocaleString() : "—"} bad={BAD.has(k) && !!s?.counters[k]} />
            ))}
          </div>
        </div>
      </div>

      <h3 className="dash-group">{td("oled")}</h3>
      <div className="dash-row">
        <Gauge label={td("brightness")} value={s?.oled ? Math.round((s.oled.contrast / 255) * 100) : undefined} min={0} max={100} unit="%" />
        <div className="dash-card dash-facts">
          <Fact label={td("oledState")} value={s?.oled ? td(`power.${s.oled.power}`) : td("noMirror")} />
          <Fact label={td("oledScreen")} value={s?.oled ? `${s.oled.screen + 1}/${SCREEN_NAMES.length} · ${SCREEN_NAMES[s.oled.screen] ?? "?"}` : "—"} />
          <Fact label={td("oledFps")} value={s?.oled ? `${s.oled.fps} /s` : "—"} />
        </div>
        <div className="dash-card dash-facts">
          <Fact label={td("dimAfter")} value={config ? (config.screenDimTimeout ? `${config.screenDimTimeout} min` : td("never")) : "—"} />
          <Fact label={td("offAfter")} value={config ? (config.screenOffTimeout ? `${config.screenOffTimeout} min` : td("never")) : "—"} />
          <Fact label={td("wakeOnInput")} value={config ? (config.controllerWakesDisplay ? td("yes") : td("no")) : "—"} />
        </div>
      </div>
    </div>
  );
}

const BAD = new Set(["dropRaw", "dropEnc", "dropHap", "micPlc", "flashFailures"]);

// A 240° dial; the arc turns warning / bad colors past the thresholds (the
// number and the label carry the meaning too, never color alone).
function Gauge({
  label,
  value,
  min,
  max,
  unit,
  digits = 0,
  warn,
  bad,
  sub,
}: {
  label: string;
  value?: number;
  min: number;
  max: number;
  unit: string;
  digits?: number;
  warn?: number;
  bad?: number;
  sub?: string;
}) {
  const r = 38;
  const sweep = 240;
  const start = 150; // degrees, clockwise from +x
  const frac = value === undefined ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const arc = (to: number) => {
    const a0 = (start * Math.PI) / 180;
    const a1 = ((start + sweep * to) * Math.PI) / 180;
    const [x0, y0, x1, y1] = [50 + r * Math.cos(a0), 50 + r * Math.sin(a0), 50 + r * Math.cos(a1), 50 + r * Math.sin(a1)];
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${sweep * to > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const level = value === undefined ? "" : bad !== undefined && value >= bad ? " bad" : warn !== undefined && value >= warn ? " warn" : "";
  return (
    <figure className={`dash-card dash-gauge${level}`}>
      <svg viewBox="0 0 100 82" aria-hidden="true">
        <path d={arc(1)} className="track" />
        {frac > 0.002 && <path d={arc(frac)} className="fill" />}
      </svg>
      <div className="dash-gauge-value">
        {value === undefined ? "—" : value.toFixed(digits)}
        <span>{unit}</span>
      </div>
      <figcaption>
        {label}
        {sub && <small>{sub}</small>}
      </figcaption>
    </figure>
  );
}

// The last minute of one value as a line with its current value.
function Graph({ label, values, now, unit, digits = 0, note }: { label: string; values: number[]; now?: number; unit: string; digits?: number; note?: string }) {
  const w = 120;
  const h = 34;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, lo + 1);
  const pts = values.map((v, i) => `${((i / (HISTORY - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <div className="dash-card dash-graph">
      <h4>{label}</h4>
      <div className="dash-graph-now">
        {now === undefined ? "—" : now.toFixed(digits)}
        <span>{unit}</span>
        {note && <em>{note}</em>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {values.length > 1 && <polyline points={pts} />}
      </svg>
    </div>
  );
}

function Level({ label, value }: { label: string; value: number }) {
  return (
    <div className="dash-level">
      <span>{label}</span>
      <div className="live-meter">
        <span style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <b>{Math.round(value * 100)}%</b>
    </div>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`dash-fact${bad ? " bad" : ""}`}>
      <span>{label}</span>
      <b>
        {bad ? "⚠ " : ""}
        {value}
      </b>
    </div>
  );
}
