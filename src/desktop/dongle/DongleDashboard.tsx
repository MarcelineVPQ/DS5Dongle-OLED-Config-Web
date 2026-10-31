// The Pico 2 W page's readouts. In its main view, under the OLED's zone, the
// board's zone (PicoGauges): its name and one spec line (chip, cores, clock,
// SRAM, flash, wireless; the full specs behind the ⓘ) as the title, then the
// chip temperature, clock and core voltage as dials and the board's facts.
// In its Diagnostics block below them (a main-view MainBlock: readouts stay
// out of the accordion), in the order the data flows: USB, Bluetooth, signal
// and mic as graphs, the audio pipeline's counters (anything that went wrong
// lit), the per-stage timings with Reset (DiagnosticsBody).
// Live reads (useDongleTelemetry): one poll a second while the page is shown
// and the window is on screen (usePoll pauses while hidden; leaving the page
// unmounts it) reads 0xFB diag, 0xFC CPU with the timings and the 0xF5 audio
// counters. The signal and the OLED mirror come from the page's own polls
// (no second read of either).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { AUDIO_COUNTER_NAMES, FEATURES2, supportsFeature2, TIMING_MAX_SATURATED, TIMING_STAGES, type AudioCounters, type CpuTimings, type OledFrame } from "../../protocol/bridgeClient";
import { boardSpecs, OLED_MODULE } from "./boardSpecs";
import { causeText } from "../shownError";
import { BusyButton, InfoTip } from "../controls";
import { boardProblems } from "./core1Status";
import Notice from "../Notice";
import { SectionGroup } from "../accordion/Section";
import { hardwareName } from "../hardwareName";
import { boardProblemKey } from "../openTasks";
import { adcToCelsius, formatMicros, formatUptime, signalQuality } from "../format";
import { usePoll } from "../usePoll";
import type { OledFrameState } from "./DongleConsole";
import { HISTORY, TREND_MAX_SAMPLES, trendCapacity } from "./trendHistory";

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
  rated: boolean; // the rates above are known (a previous read to compare with)
  rssi: number | null; // dB from the ideal range; null = no reading
  peaks: [number, number]; // speaker, haptics 0..1
  hciErrors: number;
  counters: AudioCounters | null; // null: older firmware
  core1Alive: boolean;
  oled: { power: string; screen: number; contrast: number; fps: number } | null;
  timings: CpuTimings | null; // protocol 1.11
}

// Core voltage codes 0..15 are 0.55 V + 0.05 V steps (the firmware's CPU screen).
const vcoreVolts = (code: number) => (code <= 15 ? (550 + 50 * code) / 1000 : null);

// `frame`: the OLED mirror's latest frame (the page's own poll), for what the OLED shows now.
// `error`: the last read's failure (null once a read succeeds).
// `history`: the last minute; `longHistory`: up to TREND_MAX_SAMPLES (the Timing card's width-sized trends).
// error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): at the Diagnostics heading (DonglePage, MainBlock actions)
export type Telemetry = { sample: Sample | null; history: Sample[]; longHistory: Sample[]; error: string | null; frame: OledFrame | null };

// The page's live reads: every second while shown (usePoll).
export function useDongleTelemetry(bridge: UseDs5BridgeResult, mirror: OledFrameState, rssiNow: number | null): Telemetry {
  const frameNow = mirror.frame;
  const client = bridge.client;
  const withTimings = supportsFeature2(bridge.identity, 11, FEATURES2.timings);
  // cache: OK — key=sample time; invalidated=sliding window; bound=TREND_MAX_SAMPLES = 600 samples (10 min)
  const history = useRef<Sample[]>([]);
  // changes null = no mirror frame in that sample (then no redraw rate).
  // cache: OK — key=none (previous counters); invalidated=each 1 s sample; bound=1 entry
  const prev = useRef<{ at: number; usb: number; bt: number; mic: number | undefined; loops: number | null; changes: number | null } | null>(null);
  const latest = useRef({ frame: frameNow, changes: mirror.changes, rssi: rssiNow });
  // lifetime: OK — acquires nothing (latest frame / RSSI into a ref)
  useEffect(() => {
    latest.current = { frame: frameNow, changes: mirror.changes, rssi: rssiNow };
  }, [frameNow, mirror.changes, rssiNow]);
  // lifetime: OK — usePoll: 1 s, stops when hidden, without a client, or on unmount (leaving the page)
  const poll = usePoll(
    async () => {
      if (!client) return null;
      // loop: NOT-WORTH — not a loop: one batch of up to 3 reads per 1 s poll (the board serializes them)
      const [diag, cpu, counters] = await Promise.all([client.readDiag(), client.readCpu(withTimings), client.readAudioCounters()]);
      // null = no reading (or none read yet): shown as "—", a gap in the graph, never as 0 (ideal).
      const { frame, changes, rssi } = latest.current;
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
        micFps: counters ? rate(counters.micFrames, p?.mic) : 0,
        rated: !!p && dt > 0,
        rssi,
        peaks: [diag.peakSpeaker / 255, diag.peakHaptic / 255],
        hciErrors: diag.hciErrors,
        counters,
        // On the first read, not known here: the app's health read says it (useBoardProblems).
        core1Alive: !counters || !p || p.loops === null || counters.core1Loops !== p.loops,
        // The redraw rate: the mirror's changed pictures (a resend of the same one is not a redraw).
        timings: cpu.timings,
        oled: frame ? { power: frame.power, screen: frame.screen, contrast: frame.contrast, fps: p && p.changes !== null && dt > 0 ? Math.round((changes - p.changes) / dt) : 0 } : null,
      };
      prev.current = { at, usb: diag.usbFrames, bt: diag.btPackets, mic: counters?.micFrames, loops: counters?.core1Loops ?? null, changes: frame ? changes : null };
      history.current = [...history.current.slice(-(TREND_MAX_SAMPLES - 1)), s];
      return { s, history: history.current.slice(-HISTORY), longHistory: history.current };
    },
    1000,
    Boolean(client),
  );
  const sample = poll.value;
  return { sample: sample?.s ?? null, history: sample?.history ?? [], longHistory: sample?.longHistory ?? [], error: poll.error, frame: frameNow };
}

// 0xEA's chip byte (protocol 1.21) as the spec line names it, with its package for the ⓘ.
const CHIP_PACKAGES: Record<number, { chip: string; pkg: string }> = { 0: { chip: "RP2040", pkg: "QFN56" }, 1: { chip: "RP2350A", pkg: "QFN60" }, 2: { chip: "RP2350B", pkg: "QFN80" } };
const DISPLAY_NAMES: Record<number, string> = { 1: OLED_MODULE.name };
const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

// The clock gauge's scale is the board's own ceiling (the fastest the dongle
// firmware ever runs it), fixed, so 150 MHz and 320 MHz read as what they are
// instead of each filling the dial.
const CLOCK_MAX_MHZ: Record<string, number> = { "Pico 2 W": 320, "Pico W": 200 };
export const clockMaxMhz = (board: string | null): number => (board && CLOCK_MAX_MHZ[board]) || 320;

// The board's zone: its name and spec line, the chip's dials and the board's facts.
export function PicoGauges({ bridge, telemetry, onDiagnostics }: { bridge: UseDs5BridgeResult; telemetry: Telemetry; onDiagnostics: () => void }) {
  const { t } = useTranslation();
  const { sample: s, history } = telemetry;
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.${k}`, o);
  if (!bridge.client) return null;
  // loop: HOT-PATH-OK — N = 60 samples per trend, one trend per render
  const series = (pick: (x: Sample) => number) => history.map(pick);
  const specs = boardSpecs(bridge.identity?.boardName);
  // Protocol 1.21: the board's own report (0xEA) names the chip's package and
  // the flash it measured at start-up; older firmware: the table's values.
  const fw = bridge.firmwareIdentity;
  const pkg = fw ? CHIP_PACKAGES[fw.chip] : undefined;
  const chipName = pkg?.chip ?? specs?.chip;
  const flashMb = fw?.flashMeasuredBytes ? mb(fw.flashMeasuredBytes) : specs?.flashMb;
  const flashInfo = fw?.flashMeasuredBytes
    ? td("specs.flashMeasured", { mb: mb(fw.flashMeasuredBytes), built: fw.flashBuiltBytes ? mb(fw.flashBuiltBytes) : "?" })
    : fw?.flashBuiltBytes
      ? td("specs.flashNotReported", { built: mb(fw.flashBuiltBytes) })
      : `${flashMb} MB`;
  const displayName = (id: number) => (id === 0 ? td("displayNone") : (DISPLAY_NAMES[id] ?? `#${id}`));
  // The clock as measured, once read (as the dial shows it).
  const mhz = s ? Math.round(s.realMhz) : null;
  const core = specs && `${specs.coreMaker} ${specs.core}`;
  return (
    <section className="dash pico-zone" aria-labelledby="pico-zone-h">
      <header className="zone-head">
        <h3 id="pico-zone-h">{hardwareName(bridge.identity)}</h3>
        {specs && core && (
          <span className="zone-sub">
            {/* loop: NOT-WORTH — N = 6 parts of one title line */}
            {[chipName, `2× ${specs.core}`, mhz !== null ? `${mhz} MHz` : null, `${specs.sramKb} KB`, `${flashMb} MB`, specs.wireless].filter(Boolean).join(" · ")}
            <InfoTip
              text={[
                `${td("specs.chip")}: ${mhz !== null ? td("specs.chipClock", { chip: pkg ? `${pkg.chip} (${pkg.pkg})` : specs.chip, core, mhz }) : td("specs.chipValue", { chip: pkg ? `${pkg.chip} (${pkg.pkg})` : specs.chip, core })}`,
                `${td("specs.sram")}: ${specs.sramKb} KB`,
                `${td("specs.flash")}: ${flashInfo}`,
                `${td("specs.wireless")}: ${td("specs.wirelessValue", { chip: `${specs.wirelessMaker} ${specs.wireless}`, bt: specs.bluetooth })}`,
              ].join("\n")}
            />
          </span>
        )}
      </header>
      {fw?.savedStateOff && <Notice error>{td("savedStateOff")}</Notice>}
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
          {fw && <Fact label={td("persona")} value={fw.persona === 0 ? td("personaDs5") : `#${fw.persona}`} />}
          {/* The OLED's zone above already names the module it drives: only "None" or a change waiting for the next start adds anything. */}
          {fw && (fw.display !== 1 || fw.displaySaved !== fw.display) && (
            <Fact label={td("display")} value={fw.displaySaved === fw.display ? displayName(fw.display) : td("displayNext", { now: displayName(fw.display), next: displayName(fw.displaySaved) })} />
          )}
          <button type="button" className="dk-btn dash-more" onClick={onDiagnostics}>
            {t("desktop.accordion.moreInDiagnostics")}
          </button>
        </div>
      </div>
    </section>
  );
}

// The Diagnostics block's body: everything the dials above don't show.
export function DiagnosticsBody({ bridge, telemetry }: { bridge: UseDs5BridgeResult; telemetry: Telemetry }) {
  const { t } = useTranslation();
  const { sample: s, history, longHistory } = telemetry;
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.${k}`, o);
  if (!bridge.client) return null;
  // A rate needs two reads: the first read shows none ("—").
  // loop: HOT-PATH-OK — N = 60 samples per graph, 4 graphs; the 1 s sample's render
  const series = (pick: (x: Sample) => number) => history.filter((x) => x.rated).map(pick);
  const rated = s?.rated ? s : null;
  const micLoss = micLossClimbing(history);
  // dB from the ideal range, null = no reading (a gap in the graph).
  // loop: HOT-PATH-OK — N = 60 samples; the 1 s sample's render
  const signal = history.map((x) => x.rssi);
  const counters = s?.counters ?? null;
  const problems = s && counters ? boardProblems(t, counters, s.core1Alive) : [];

  return (
    <div className="dash dash-block">
      <div className="dash-row">
        <Graph label={td("usb")} unit="/s" values={series((x) => x.usbFps)} now={rated?.usbFps} />
        <Graph label={td("bt")} unit="/s" values={series((x) => x.btPps)} now={rated?.btPps} />
        <Graph label={td("signal")} unit="dB" values={signal} now={s?.rssi ?? undefined} note={s && s.rssi !== null ? t(`desktop.overview.signalQ.${signalQuality(s.rssi)}`) : undefined} />
        <Graph label={td("mic")} unit="/s" values={series((x) => x.micFps)} now={counters ? rated?.micFps : undefined} />
      </div>
      <SectionGroup title={td("audio")}>
        {/* loop: HOT-PATH-OK — N ≤ 3 problems; the 1 s sample's render */}
        {problems.map((p) => (
          <Notice key={p.reason} error dismissKey={boardProblemKey(p)}>
            {p.text}
          </Notice>
        ))}
        <div className="dash-levels">
          <Level label={td("speakerPeak")} value={s?.peaks[0] ?? 0} />
          <Level label={td("hapticPeak")} value={s?.peaks[1] ?? 0} />
        </div>
        <div className="dash-counters">
          {/* loop: HOT-PATH-OK — N ≈ 15 audio counters */}
          {AUDIO_COUNTER_NAMES.filter((k) => k !== "setFeatureLast" && k !== "core1Loops").map((k) => (
            <Fact key={k} label={t(`desktop.diag.counters.${k}`)} value={counters ? counters[k].toLocaleString() : "—"} bad={k === "micPlc" ? micLoss : BAD.has(k) && !!counters?.[k]} />
          ))}
        </div>
      </SectionGroup>

      {s?.timings && <TimingCard client={bridge.client} timings={s.timings} history={longHistory} />}
    </div>
  );
}

// The core1 speaker frame has 10 ms of audio to encode in; a worst case at
// that or above means a dropped frame.
const SPEAKER_FRAME_US = 10000;

// Protocol 1.11: how long each stage of the firmware takes (average and worst
// case since the reset), the averages over time, and a Reset. The trend column
// takes the card's spare width; the line keeps one sample per few pixels of it
// (trendCapacity), so it fills the column from left to right over time.
function TimingCard({ client, timings, history }: { client: NonNullable<UseDs5BridgeResult["client"]>; timings: CpuTimings; history: Sample[] }) {
  const { t } = useTranslation();
  const td = (k: string, o?: Record<string, unknown>) => t(`desktop.dash.timing.${k}`, o);
  // The graphs start over at a reset, like the numbers.
  const [resetAt, setResetAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The trend column's drawn width (its header cell spans it): re-measured only when it resizes.
  const trendHead = useRef<HTMLSpanElement>(null);
  const [trendWidth, setTrendWidth] = useState(0);
  // lifetime: OK — the ResizeObserver is disconnected on unmount
  useEffect(() => {
    const el = trendHead.current;
    if (!el) return;
    // lifetime: OK — cleanup: disconnects the ResizeObserver (unmount)
    const ro = new ResizeObserver(([entry]) => setTrendWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const capacity = trendCapacity(trendWidth);
  // loop: HOT-PATH-OK — N ≤ TREND_MAX_SAMPLES = 600 samples; the 1 s sample's render
  const recent = history.slice(-capacity).filter((x) => x.at >= resetAt && x.timings);
  const reset = async () => {
    try {
      setError(null);
      await client.resetTimings();
      setResetAt(performance.now());
    } catch (cause) {
      // error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): the error next to Reset
      setError(causeText(cause));
    }
  };
  return (
    <SectionGroup title={td("title")} info={td("hint")}>
      {/* hint: MUST-SHOW — a state of this board: why the numbers are rounded */}
      {timings.timerFallback && <p className="dk-hint">{td("usTimer")}</p>}
      {error && (
        <Notice error onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      <div className="dash-timings">
        <span />
        <span>{td("average")}</span>
        <span>{td("worst")}</span>
        <span ref={trendHead}>{td("trend")}</span>
        {/* loop: HOT-PATH-OK — N ≤ 8 timing stages */}
        {timings.stages.slice(0, TIMING_STAGES.length).map((st, i) => {
          const saturated = st.maxUs >= TIMING_MAX_SATURATED;
          const bad = TIMING_STAGES[i] === "speaker" && st.maxUs >= SPEAKER_FRAME_US;
          // loop: HOT-PATH-OK — N = 8 stages x ≤ 600 samples; the 1 s sample's render
          const trend = recent.map((x) => (x.timings?.stages[i]?.avgNs ?? 0) / 1000);
          return (
            <TimingRow
              key={TIMING_STAGES[i]}
              label={td(`stages.${TIMING_STAGES[i]}`)}
              avg={formatMicros(st.avgNs / 1000)}
              worst={formatMicros(st.maxUs, saturated)}
              bad={bad}
              trend={trend}
              capacity={capacity}
            />
          );
        })}
      </div>
      <div className="dash-timing-foot">
        <Fact label={td("sinceReset")} value={`${timings.sinceResetSeconds >= 0xffff ? "≥ " : ""}${formatUptime(timings.sinceResetSeconds)}`} />
        <BusyButton onClick={reset}>{td("reset")}</BusyButton>
      </div>
    </SectionGroup>
  );
}

function TimingRow({ label, avg, worst, bad, trend, capacity }: { label: string; avg: string; worst: string; bad: boolean; trend: number[]; capacity: number }) {
  return (
    <>
      <span>{label}</span>
      <b>{avg}</b>
      <b className={bad ? "bad" : undefined}>
        {bad ? "⚠ " : ""}
        {worst}
      </b>
      {trend.length > 1 ? <Trend values={trend} capacity={capacity} /> : <span />}
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
const micLossClimbing = (history: Sample[]): boolean =>
  // loop: HOT-PATH-OK — N = 60 samples
  history.filter((x, i) => i > 0 && x.micFps >= MIC_IN_USE_FPS && x.counters !== null && x.counters.micPlc > (history[i - 1].counters?.micPlc ?? x.counters.micPlc)).length >= 2;

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

// A small trend line: `capacity` samples span its width (a gauge's last minute
// by default), so it fills from the left as samples arrive.
function Trend({ values, capacity = HISTORY }: { values: number[]; capacity?: number }) {
  const w = 120;
  const h = 18;
  const lo = Math.min(...values);
  const hi = Math.max(...values, lo + 0.5);
  // loop: HOT-PATH-OK — N ≤ capacity ≤ 600 points per trend line; the 1 s sample's render
  const pts = values.map((v, i) => `${((i / (capacity - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="dash-gauge-trend" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

// The last minute of one value as a line with its current value.
// A null value is a gap (no reading then): the line breaks there.
function Graph({ label, values, now, unit, digits = 0, note }: { label: string; values: (number | null)[]; now?: number; unit: string; digits?: number; note?: string }) {
  const w = 120;
  const h = 34;
  // loop: HOT-PATH-OK — N = 60 points per graph
  const known = values.filter((v): v is number => v !== null);
  const lo = Math.min(...known, 0);
  const hi = Math.max(...known, lo + 1);
  // Runs of consecutive readings, one polyline each.
  const runs: string[][] = [];
  // loop: HOT-PATH-OK — N = 60 points per graph
  values.forEach((v, i) => {
    if (v === null || runs.length === 0) runs.push([]);
    if (v === null) return;
    runs[runs.length - 1].push(`${((i / (HISTORY - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`);
  });
  return (
    <div className="dash-card dash-graph">
      <h4>{label}</h4>
      <div className="dash-graph-now">
        {now === undefined ? "—" : now.toFixed(digits)}
        <span>{unit}</span>
        {note && <em>{note}</em>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {/* loop: HOT-PATH-OK — N ≤ 30 runs of 60 points */}
        {runs.map((r, i) => r.length > 1 && <polyline key={i} points={r.join(" ")} />)}
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
