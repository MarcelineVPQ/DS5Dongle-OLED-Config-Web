// The dongle's live diagnostics under its console, in two groups: the
// Pico 2 W (chip temperature, clock and core voltage as dials; USB, Bluetooth
// and signal as graphs over the last minute; the audio pipeline's counters,
// with anything that went wrong lit) and the OLED (what it's doing). One poll
// a second reads 0xFB diag, 0xFC CPU (with the per-stage timings on protocol
// 1.11) and 0xF5 audio counters; the signal and the OLED mirror come from the
// page's own polls (no second read of either).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import {
  AUDIO_COUNTER_NAMES,
  CORE1_MIC_FAILED,
  CORE1_SPEAKER_FAILED,
  FEATURES2,
  supportsFeature2,
  TIMING_MAX_SATURATED,
  TIMING_STAGES,
  type AudioCounters,
  type CpuTimings,
  type OledFrame,
} from "../../protocol/bridgeClient";
import { SCREEN_NAMES } from "../../oled/screenNames";
import { boardSpecs, OLED_MODULE } from "./boardSpecs";
import { errorText } from "../../errorText";
import { BusyButton } from "../controls";
import { core1StoppedText } from "./core1Status";
import { adcToCelsius, formatMicros, formatUptime, signalQuality } from "../format";
import { usePoll } from "../usePoll";

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
  micFps: number; // mic audio frames decoded per second
  rssi: number;
  peaks: [number, number]; // speaker, haptics 0..1
  hciErrors: number;
  counters: AudioCounters;
  core1Alive: boolean;
  oled: { power: string; screen: number; contrast: number; fps: number } | null;
  timings: CpuTimings | null; // protocol 1.11
}

// Core voltage codes 0..15 are 0.55 V + 0.05 V steps (the firmware's CPU screen).
const vcoreVolts = (code: number) => (code <= 15 ? (550 + 50 * code) / 1000 : null);

function useDongleTelemetry(bridge: UseDs5BridgeResult, frameNow: OledFrame | null, rssiNow: number | null) {
  const client = bridge.client;
  const withTimings = supportsFeature2(bridge.identity, 11, FEATURES2.timings);
  // cache: OK — key=sample time; invalidated=sliding window; bound=HISTORY = 60 samples
  const history = useRef<Sample[]>([]);
  // seq null = no mirror frame in that sample (then no redraw rate).
  // cache: OK — key=none (previous counters); invalidated=each 1 s sample; bound=1 entry
  const prev = useRef<{ at: number; usb: number; bt: number; mic: number; loops: number; seq: number | null } | null>(null);
  const latest = useRef({ frame: frameNow, rssi: rssiNow });
  // lifetime: OK — acquires nothing (latest frame / RSSI into a ref)
  useEffect(() => {
    latest.current = { frame: frameNow, rssi: rssiNow };
  }, [frameNow, rssiNow]);
  // lifetime: OK — usePoll: 1 s, stops when hidden, without a client, or on unmount
  const sample = usePoll(
    async () => {
      if (!client) return null;
      const [diag, cpu, counters] = await Promise.all([client.readDiag(), client.readCpu(withTimings), client.readAudioCounters()]);
      const { frame, rssi: rssiRead } = latest.current;
      const rssi = rssiRead ?? 0;
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
        micFps: rate(counters.micFrames, p?.mic),
        rssi,
        peaks: [diag.peakSpeaker / 255, diag.peakHaptic / 255],
        hciErrors: diag.hciErrors,
        counters,
        core1Alive: !p || counters.core1Loops !== p.loops,
        // The frame counter is 8-bit: the difference mod 256.
        timings: cpu.timings,
        oled: frame ? { power: frame.power, screen: frame.screen, contrast: frame.contrast, fps: p && p.seq !== null && dt > 0 ? Math.round(((frame.seq - p.seq) & 0xff) / dt) : 0 } : null,
      };
      prev.current = { at, usb: diag.usbFrames, bt: diag.btPackets, mic: counters.micFrames, loops: counters.core1Loops, seq: frame?.seq ?? null };
      history.current = [...history.current.slice(-(HISTORY - 1)), s];
      return { s, history: history.current };
    },
    1000,
    Boolean(client),
  ).value;
  return { sample: sample?.s ?? null, history: sample?.history ?? [] };
}

// The clock gauge's scale is the board's own ceiling (the fastest the dongle
// firmware ever runs it), fixed, so 150 MHz and 320 MHz read as what they are
// instead of each filling the dial.
const CLOCK_MAX_MHZ: Record<string, number> = { "Pico 2 W": 320, "Pico W": 200 };
export const clockMaxMhz = (board: string | null): number => (board && CLOCK_MAX_MHZ[board]) || 320;

export default function DongleDashboard({ bridge, frame, rssi }: { bridge: UseDs5BridgeResult; frame: OledFrame | null; rssi: number | null }) {
  const { t } = useTranslation();
  const { sample: s, history } = useDongleTelemetry(bridge, frame, rssi);
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.${k}`, o);
  if (!bridge.client) return null;
  // loop: HOT-PATH-OK — N = 60 samples per trend, a few trends per render
  const series = (pick: (x: Sample) => number) => history.map(pick);
  const config = bridge.config;
  const micLoss = micLossClimbing(history);
  const specs = boardSpecs(bridge.identity?.boardName);

  return (
    <div className="dash">
      <h3 className="dash-group">{td("pico")}</h3>
      <div className="dash-row">
        <Gauge label={td("temperature")} value={s?.tempC} min={20} max={85} unit="°C" digits={1} warn={60} bad={72} trend={series((x) => x.tempC)} />
        <Gauge label={td("clock")} value={s?.realMhz} min={0} max={clockMaxMhz(bridge.identity?.boardName ?? null)} unit="MHz" sub={s ? td("clockSet", { mhz: Math.round(s.setMhz) }) : undefined} />
        <Gauge label={td("vcore")} value={s?.vcore ?? undefined} min={0.85} max={1.3} unit="V" digits={2} warn={1.2} bad={1.26} />
        <div className="dash-card dash-facts">
          <Fact label={td("uptime")} value={s ? formatUptime(s.uptime) : "—"} />
          <Fact label={td("protocol")} value={bridge.identity ? `${bridge.identity.protoMajor}.${bridge.identity.protoMinor}` : "—"} />
          {/* Every build is the OLED Edition: the short form fits the card; the tooltip has it all. */}
          <Fact label={td("firmware")} value={bridge.firmwareVersion?.replace("-oled-edition", "") ?? "—"} title={bridge.firmwareVersion ?? undefined} />
          <Fact label={td("hciErrors")} value={s ? String(s.hciErrors) : "—"} bad={!!s?.hciErrors} />
        </div>
        {specs && (
          <div className="dash-card">
            <h4>{td("specs.title")}</h4>
            <dl className="dk-kv">
              <dt>{td("specs.chip")}</dt>
              <dd>{s ? td("specs.chipClock", { chip: specs.chip, core: specs.core, mhz: Math.round(s.realMhz) }) : td("specs.chipValue", { chip: specs.chip, core: specs.core })}</dd>
              <dt>{td("specs.sram")}</dt>
              <dd>{specs.sramKb} KB</dd>
              <dt>{td("specs.flash")}</dt>
              <dd>{specs.flashMb} MB</dd>
              <dt>{td("specs.wireless")}</dt>
              <dd>{td("specs.wirelessValue", { chip: specs.wireless, bt: specs.bluetooth })}</dd>
            </dl>
          </div>
        )}
      </div>
      <div className="dash-row">
        <Graph label={td("usb")} unit="/s" values={series((x) => x.usbFps)} now={s?.usbFps} />
        <Graph label={td("bt")} unit="/s" values={series((x) => x.btPps)} now={s?.btPps} />
        <Graph label={td("signal")} unit="dB" values={series((x) => x.rssi)} now={s?.rssi} note={s ? t(`desktop.overview.signalQ.${signalQuality(s.rssi)}`) : undefined} />
        <Graph label={td("mic")} unit="/s" values={series((x) => x.micFps)} now={s?.micFps} />
      </div>
      <div className="dash-row">
        <div className="dash-card dash-wide">
          <h4>{td("audio")}</h4>
          {s && !s.core1Alive && <div className="dk-notice error">{core1StoppedText(t, s.counters)}</div>}
          {s && ((s.counters.core1Flags ?? 0) & CORE1_SPEAKER_FAILED) !== 0 && (
            <div className="dk-notice error">{t("desktop.diag.speakerEncoderFailed", { kb: Math.round((s.counters.core1FreeHeap ?? 0) / 1024) })}</div>
          )}
          {s && ((s.counters.core1Flags ?? 0) & CORE1_MIC_FAILED) !== 0 && (
            <div className="dk-notice error">{t("desktop.diag.micDecoderFailed", { kb: Math.round((s.counters.core1FreeHeap ?? 0) / 1024) })}</div>
          )}
          <div className="dash-levels">
            <Level label={td("speakerPeak")} value={s?.peaks[0] ?? 0} />
            <Level label={td("hapticPeak")} value={s?.peaks[1] ?? 0} />
          </div>
          <div className="dash-counters">
            {/* loop: HOT-PATH-OK — N ≈ 15 audio counters */}
            {AUDIO_COUNTER_NAMES.filter((k) => k !== "setFeatureLast" && k !== "core1Loops").map((k) => (
              <Fact key={k} label={t(`desktop.diag.counters.${k}`)} value={s ? s.counters[k].toLocaleString() : "—"} bad={k === "micPlc" ? micLoss : BAD.has(k) && !!s?.counters[k]} />
            ))}
          </div>
        </div>
      </div>

      {s?.timings && <TimingCard client={bridge.client} timings={s.timings} history={history} />}

      <h3 className="dash-group">{OLED_MODULE.name}</h3>
      <div className="dash-row">
        <Gauge label={td("brightness")} value={s?.oled ? Math.round((s.oled.contrast / 255) * 100) : undefined} min={0} max={100} unit="%" />
        <div className="dash-card dash-facts">
          <Fact label={td("oledState")} value={s?.oled ? td(`power.${s.oled.power}`) : td("noMirror")} />
          <Fact label={td("oledScreen")} value={s?.oled ? `${s.oled.screen + 1}/${SCREEN_NAMES.length} · ${SCREEN_NAMES[s.oled.screen] ?? "?"}` : "—"} />
          <Fact label={td("oledFps")} value={s?.oled ? `${s.oled.fps} /s` : "—"} />
        </div>
        <div className="dash-card dash-facts">
          <Fact label={td("dimAfter")} value={config ? (config.screenDimTimeout ? td("minutes", { n: config.screenDimTimeout }) : td("never")) : "—"} />
          <Fact label={td("offAfter")} value={config ? (config.screenOffTimeout ? td("minutes", { n: config.screenOffTimeout }) : td("never")) : "—"} />
          <Fact label={td("wakeOnInput")} value={config ? (config.controllerWakesDisplay ? td("yes") : td("no")) : "—"} />
        </div>
        <div className="dash-card">
          <h4>{td("specs.title")}</h4>
          <dl className="dk-kv">
            <dt>{td("specs.model")}</dt>
            <dd>{OLED_MODULE.name}</dd>
            <dt>{td("specs.size")}</dt>
            <dd>{OLED_MODULE.size}</dd>
            <dt>{td("specs.resolution")}</dt>
            <dd>{OLED_MODULE.resolution}</dd>
            <dt>{td("specs.controller")}</dt>
            <dd>{OLED_MODULE.controller}</dd>
            <dt>{td("specs.interface")}</dt>
            <dd>{OLED_MODULE.interface}</dd>
            <dt>{td("specs.keys")}</dt>
            <dd>{OLED_MODULE.keys}</dd>
          </dl>
          <p className="dk-hint">{td("specs.notDetected")}</p>
        </div>
      </div>
    </div>
  );
}

// The core1 speaker frame has 10 ms of audio to encode in; a worst case at
// that or above means a dropped frame.
const SPEAKER_FRAME_US = 10000;

// Protocol 1.11: how long each stage of the firmware takes (average and worst
// case since the reset), the averages' last minute, and a Reset.
function TimingCard({ client, timings, history }: { client: NonNullable<UseDs5BridgeResult["client"]>; timings: CpuTimings; history: Sample[] }) {
  const { t } = useTranslation();
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.timing.${k}`, o);
  // The graphs start over at a reset, like the numbers.
  const [resetAt, setResetAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // loop: HOT-PATH-OK — N = 60 samples
  const recent = history.filter((x) => x.at >= resetAt && x.timings);
  const reset = async () => {
    try {
      setError(null);
      await client.resetTimings();
      setResetAt(performance.now());
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return (
    <div className="dash-row">
      <div className="dash-card dash-wide">
        <h4>{td("title")}</h4>
        <p className="dk-hint">{td("hint")}</p>
        {timings.timerFallback && <p className="dk-hint">{td("usTimer")}</p>}
        {error && <div className="dk-notice error">{error}</div>}
        <div className="dash-timings">
          <span />
          <span>{td("average")}</span>
          <span>{td("worst")}</span>
          <span>{td("trend")}</span>
          {/* loop: HOT-PATH-OK — N ≤ 8 timing stages */}
          {timings.stages.slice(0, TIMING_STAGES.length).map((st, i) => {
            const saturated = st.maxUs >= TIMING_MAX_SATURATED;
            const bad = TIMING_STAGES[i] === "speaker" && st.maxUs >= SPEAKER_FRAME_US;
            // loop: HOT-PATH-OK — N = 8 stages x 60 samples = 480 numbers
            const trend = recent.map((x) => (x.timings?.stages[i]?.avgNs ?? 0) / 1000);
            return <TimingRow key={TIMING_STAGES[i]} label={td(`stages.${TIMING_STAGES[i]}`)} avg={formatMicros(st.avgNs / 1000)} worst={formatMicros(st.maxUs, saturated)} bad={bad} trend={trend} />;
          })}
        </div>
        <div className="dash-timing-foot">
          <Fact label={td("sinceReset")} value={`${timings.sinceResetSeconds >= 0xffff ? "≥ " : ""}${formatUptime(timings.sinceResetSeconds)}`} />
          <BusyButton onClick={reset}>{td("reset")}</BusyButton>
        </div>
      </div>
    </div>
  );
}

function TimingRow({ label, avg, worst, bad, trend }: { label: string; avg: string; worst: string; bad: boolean; trend: number[] }) {
  return (
    <>
      <span>{label}</span>
      <b>{avg}</b>
      <b className={bad ? "bad" : undefined}>
        {bad ? "⚠ " : ""}
        {worst}
      </b>
      {trend.length > 1 ? <Trend values={trend} /> : <span />}
    </>
  );
}

const BAD = new Set(["dropRaw", "dropEnc", "dropHap", "flashFailures"]);

// Mic concealment is only a warning when it keeps climbing while the mic is
// in use: right after a controller connects it sends a couple of mic packets,
// then core1 conceals ~33 frames (~1/3 s) before it sees the stream stopped,
// a one-off that is benign. "In use": mic frames decoding at a real rate (a
// stream is far above this; the connect-time packets far below).
const MIC_IN_USE_FPS = 20;
// loop: HOT-PATH-OK — N = 60 samples
const micLossClimbing = (history: Sample[]): boolean => history.filter((x, i) => i > 0 && x.micFps >= MIC_IN_USE_FPS && x.counters.micPlc > history[i - 1].counters.micPlc).length >= 2;

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
  trend,
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
  trend?: number[]; // the last minute, drawn under the gauge
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
      {trend && trend.length > 1 && <Trend values={trend} />}
    </figure>
  );
}

// A small trend line (a gauge's last minute).
function Trend({ values }: { values: number[] }) {
  const w = 120;
  const h = 18;
  const lo = Math.min(...values);
  const hi = Math.max(...values, lo + 0.5);
  // loop: HOT-PATH-OK — N = 60 points per trend line
  const pts = values.map((v, i) => `${((i / (HISTORY - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="dash-gauge-trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

// The last minute of one value as a line with its current value.
function Graph({ label, values, now, unit, digits = 0, note }: { label: string; values: number[]; now?: number; unit: string; digits?: number; note?: string }) {
  const w = 120;
  const h = 34;
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, lo + 1);
  // loop: HOT-PATH-OK — N = 60 points per graph
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
        <span style={{ "--level": Math.min(1, Math.max(0, value)) } as React.CSSProperties} />
      </div>
      <b>{Math.round(value * 100)}%</b>
    </div>
  );
}

function Fact({ label, value, bad, title }: { label: string; value: string; bad?: boolean; title?: string }) {
  return (
    <div className={`dash-fact${bad ? " bad" : ""}`}>
      <span>{label}</span>
      <b title={title ?? value}>
        {bad ? "⚠ " : ""}
        {value}
      </b>
    </div>
  );
}
