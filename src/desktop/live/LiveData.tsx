// Everything the controller reports, in four equal cards (one row, or 2 x 2
// when narrow), grouped by kind: inputs (sticks, buttons, triggers,
// touchpad), the two motion sensors, and the connection (link and what's
// plugged in). Settings live in the panel, not here, and nothing repeats
// what the drawing or the status strip shows.
import { useEffect, useRef, useState } from "react";
import { AXIS_DASH, PALETTES } from "../colorVision";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import { liveStats } from "../useLiveInput";
import { onThemeChange } from "./controllerAccent";
import { useWindowShown } from "../useWindowShown";
import { atNextTick } from "../frameTick";

interface Props {
  input: InputReport;
  rssi: number | null;
  edge?: boolean; // DualSense Edge: Fn buttons and paddles rows
}

const HISTORY = 150;
// X, Y, Z: red, green, blue as in 3D tools (or the Color vision palette), and
// always a line pattern too (solid, dashed, dotted), so colour isn't needed.

// Pressed / not pressed, as in the other rows.
const dot = (down: boolean) => (down ? "●" : "○");
// The D-pad's direction (0 = up, clockwise; 8 = released, shown as —).
const DPAD_ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

// The link's reads a second and round trip, as text, read from liveStats
// once a second (they'd change with every input frame otherwise, ~30 a
// second); a render only when the text changes, none while hidden.
function useLinkRates(): [string, string] {
  const shown = useWindowShown();
  const read = (): [string, string] => [`${liveStats.hz.toFixed(1)} /s`, `${liveStats.ms.toFixed(1)} ms`];
  const [rates, setRates] = useState(read);
  // lifetime: OK — cleanup: clears the 1 s timer (hidden / unmount)
  useEffect(() => {
    if (!shown) return;
    let pending = () => undefined as unknown;
    // lifetime: OK — cleared in the effect cleanup (with an update still waiting for its tick); runs only while shown
    const id = setInterval(() => {
      const next = read();
      // On the next frame tick (frameTick.ts): with the background's step, not in a frame of its own.
      pending = atNextTick(() => setRates((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next)));
    }, 1000);
    return () => {
      clearInterval(id);
      pending();
    };
  }, [shown]);
  return rates;
}

export default function LiveData({ input, rssi, edge = false }: Props) {
  const { t } = useTranslation();
  const [rate, roundTrip] = useLinkRates();
  const tl = (key: string) => t(`desktop.liveData.${key}`);
  const yn = (v: boolean) => (v ? tl("yes") : tl("no"));
  const centered = (v: number) => v - 128;
  const { accelX: ax, accelY: ay, accelZ: az } = input;
  const roll = (Math.atan2(ay, az) * 180) / Math.PI;
  const pitch = (Math.atan2(-ax, Math.hypot(ay, az)) * 180) / Math.PI;
  const effect = (v: number) => t(`desktop.live.effects.${v}`, String(v));

  return (
    <section className="live-data" aria-label={tl("title")}>
      <Card title={tl("inputs")}>
        {/* L stick + L2 | R2 + R stick, as on the controller: the dot moves
            with the stick (the ring lights when it's clicked), the bar fills
            with the trigger; numbers underneath. */}
        <div className="live-data-sticks">
          <Stick label={t("desktop.live.part.stick-l")} x={input.leftStick.x} y={input.leftStick.y} pressed={input.l3} />
          <Trigger label="L2" value={input.triggerLeft} bumper="L1" bumperDown={input.l1} />
          <Trigger label="R2" value={input.triggerRight} bumper="R1" bumperDown={input.r1} />
          <Stick label={t("desktop.live.part.stick-r")} x={input.rightStick.x} y={input.rightStick.y} pressed={input.r3} />
        </div>
        <Rows
          rows={[
            [tl("leftStick"), `${fmt(centered(input.leftStick.x), 4)} ${fmt(centered(input.leftStick.y), 4)}`],
            [tl("rightStick"), `${fmt(centered(input.rightStick.x), 4)} ${fmt(centered(input.rightStick.y), 4)}`],
            ["L1 / R1", `${dot(input.l1)} ${dot(input.r1)}`],
            // Every other button too, by the names the Buttons list uses.
            ["Create / Options", `${dot(input.create)} ${dot(input.options)}`],
            ["△ ○ ✕ □", `${dot(input.triangle)} ${dot(input.circle)} ${dot(input.cross)} ${dot(input.square)}`],
            ["D-pad", DPAD_ARROWS[input.dpad] ?? "—"],
            ["PS / Mute / Touchpad", `${dot(input.home)} ${dot(input.mute)} ${dot(input.pad)}`],
            // The DualSense Edge's Fn buttons and back buttons (LB / RB).
            ...(edge
              ? ([
                  ["Fn L / R", `${dot(input.fnLeft)} ${dot(input.fnRight)}`],
                  [tl("paddles"), `${dot(input.backLeft)} ${dot(input.backRight)}`],
                ] as [string, string][])
              : []),
            ["L2 / R2", `${fmt(input.triggerLeft, 3)} ${fmt(input.triggerRight, 3)}`],
            [tl("effect"), `${effect(input.triggerEffectLeft)} · ${effect(input.triggerEffectRight)}`],
            // loop: HOT-PATH-OK — N = 2 fingers per live frame
            ...input.fingers.map((f, i): [string, string] => [t("desktop.liveData.finger", { n: i + 1 }), f.touching ? `${fmt(f.x, 4)} ${fmt(f.y, 4)}` : "—"]),
          ]}
        />
      </Card>
      <Card title={tl("gyro")}>
        <Xyz values={[input.gyroX, input.gyroY, input.gyroZ]} />
        <Spark values={[input.gyroX, input.gyroY, input.gyroZ]} range={8000} />
      </Card>
      <Card title={tl("accel")}>
        <Xyz values={[ax, ay, az]} />
        <Spark values={[ax, ay, az]} range={10000} />
        <Rows rows={[[tl("tilt"), `${fmt(Math.round(pitch), 4)}° ${fmt(Math.round(roll), 4)}°`]]} />
      </Card>
      <Card title={tl("connection")}>
        <Rows
          rows={[
            [tl("rate"), rate],
            [tl("roundTrip"), roundTrip],
            // Bluetooth reports RSSI relative to the ideal ("golden") range: 0 = in it.
            [tl("signal"), rssi === null ? "—" : rssi === 0 ? tl("inRange") : `${rssi} dB`],
            [tl("usb"), yn(input.usbPower)],
            [tl("headset"), yn(input.headphones)],
            [tl("mic"), yn(input.micPlugged)],
            [tl("muted"), yn(input.micMuted)],
          ]}
        />
      </Card>
    </section>
  );
}

// Fixed-width numbers so the columns don't jitter as values change.
function fmt(v: number, width: number): string {
  return String(v).padStart(width, " ");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="live-data-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="live-data-rows">
      {/* loop: HOT-PATH-OK — N ≈ 20 rows per live frame (the panel shows live values) */}
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt title={k}>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Xyz({ values }: { values: [number, number, number] }) {
  return (
    <div className="live-data-xyz">
      {/* loop: HOT-PATH-OK — N = 3 axes per live frame */}
      {(["X", "Y", "Z"] as const).map((axis, i) => (
        <span key={axis}>
          <b>
            <svg className="axis-key" viewBox="0 0 16 4" aria-hidden="true" style={{ color: `var(--cv-axis-${i})` }}>
              <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray={AXIS_DASH[i].join(" ") || undefined} />
            </svg>
            {axis}
          </b>
          <span>{values[i]}</span>
        </span>
      ))}
    </div>
  );
}

// The spark lines' theme colors (grid, three axes), read once and again only
// when the theme changes (it sets its tokens on <html>), not on every sample.
type SparkColors = { grid: string; axis: string[] };
function readSparkColors(c: HTMLCanvasElement): SparkColors {
  const css = getComputedStyle(document.documentElement);
  return {
    grid: getComputedStyle(c).getPropertyValue("--border-subtle").trim() || "transparent", // the theme's grid line
    axis: [0, 1, 2].map((axis) => css.getPropertyValue(`--cv-axis-${axis}`).trim() || PALETTES.standard.axis[axis]),
  };
}

// Three scrolling lines (X, Y, Z) of the last HISTORY samples. Canvas 2D,
// which Chromium rasterizes on the GPU with hardware acceleration.
function Spark({ values, range }: { values: [number, number, number]; range: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // cache: OK — key=sample order; invalidated=sliding window; bound=HISTORY = 150 points
  const history = useRef<Array<[number, number, number]>>([]);
  // cache: OK — key=none (the spark colors); invalidated=cleared on theme change; bound=1 entry
  const colors = useRef<SparkColors | null>(null);
  // lifetime: OK — cleanup: the theme watcher's unsubscribe
  useEffect(() => {
    // lifetime: OK — the effect returns its unsubscribe
    return onThemeChange(() => (colors.current = null));
  }, []);
  // lifetime: OK — acquires nothing (draws a frame; the history is capped at HISTORY)
  useEffect(() => {
    const h = history.current;
    h.push(values);
    if (h.length > HISTORY) h.shift();
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const col = (colors.current ??= readSparkColors(c));
    const w = c.width;
    const ht = c.height;
    g.clearRect(0, 0, w, ht);
    g.strokeStyle = col.grid;
    g.beginPath();
    g.moveTo(0, ht / 2);
    g.lineTo(w, ht / 2);
    g.stroke();
    // loop: HOT-PATH-OK — N = 3 axes per spark redraw; 2D canvas, GPU-composited
    for (let axis = 0; axis < 3; axis++) {
      g.strokeStyle = col.axis[axis];
      g.setLineDash(AXIS_DASH[axis]);
      g.lineWidth = 1.5;
      g.beginPath();
      // loop: HOT-PATH-OK — N = 150 history points per axis per redraw
      h.forEach((sample, i) => {
        const x = (i / (HISTORY - 1)) * w;
        const y = ht / 2 - (Math.max(-range, Math.min(range, sample[axis])) / range) * (ht / 2 - 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }
    g.setLineDash([]);
  }, [values, range]);
  return <canvas ref={canvas} className="live-data-spark" width={300} height={56} aria-hidden="true" />;
}

function Stick({ label, x, y, pressed }: { label: string; x: number; y: number; pressed: boolean }) {
  const cx = 30 + ((x - 128) / 128) * 22;
  const cy = 30 + ((y - 128) / 128) * 22;
  return (
    <svg viewBox="0 0 60 60" className={`live-stick${pressed ? " pressed" : ""}`} role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="30" cy="30" r="26" className="ring" />
      <line x1="30" y1="6" x2="30" y2="54" className="cross" />
      <line x1="6" y1="30" x2="54" y2="30" className="cross" />
      <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="6" className="dot" />
    </svg>
  );
}

// The bumper (L1 / R1) above its trigger, as on the controller: lit while held.
function Trigger({ label, value, bumper, bumperDown }: { label: string; value: number; bumper: string; bumperDown: boolean }) {
  const pct = Math.round((value / 255) * 100);
  return (
    <span className="live-data-trig" title={`${bumper} ${bumperDown ? "●" : "○"} · ${label} ${pct}%`}>
      <span className={`live-bumper${bumperDown ? " on" : ""}`} aria-hidden="true" />
      <span className="live-trig" aria-hidden="true">
        <span style={{ height: `${pct}%` }} />
      </span>
      <span className="live-data-trig-label">{label}</span>
    </span>
  );
}
