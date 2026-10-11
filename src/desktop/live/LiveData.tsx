// Everything the controller reports, in four equal cards (one row, or 2 x 2
// when narrow), grouped by kind: inputs (sticks, buttons, triggers,
// touchpad), the two motion sensors, and the connection (link and what's
// plugged in). Settings live in the panel, not here, and nothing repeats
// what the drawing or the status strip shows.
import { useEffect, useRef } from "react";
import { AXIS_DASH, PALETTES } from "../colorVision";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import { liveStats } from "../useLiveInput";

interface Props {
  input: InputReport;
  rssi: number | null;
}

const HISTORY = 150;
// X, Y, Z: red, green, blue as in 3D tools (or the Color vision palette), and
// always a line pattern too (solid, dashed, dotted), so colour isn't needed.

export default function LiveData({ input, rssi }: Props) {
  const { t } = useTranslation();
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
            ["L1 / R1", `${input.l1 ? "●" : "○"} ${input.r1 ? "●" : "○"}`],
            ["L2 / R2", `${fmt(input.triggerLeft, 3)} ${fmt(input.triggerRight, 3)}`],
            [tl("effect"), `${effect(input.triggerEffectLeft)} · ${effect(input.triggerEffectRight)}`],
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
            [tl("rate"), `${liveStats.hz.toFixed(1)} /s`],
            [tl("roundTrip"), `${liveStats.ms.toFixed(1)} ms`],
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

// Three scrolling lines (X, Y, Z) of the last HISTORY samples.
function Spark({ values, range }: { values: [number, number, number]; range: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<Array<[number, number, number]>>([]);
  useEffect(() => {
    const h = history.current;
    h.push(values);
    if (h.length > HISTORY) h.shift();
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const w = c.width;
    const ht = c.height;
    g.clearRect(0, 0, w, ht);
    g.strokeStyle = "rgba(128, 128, 128, 0.25)";
    g.beginPath();
    g.moveTo(0, ht / 2);
    g.lineTo(w, ht / 2);
    g.stroke();
    const css = getComputedStyle(document.documentElement);
    for (let axis = 0; axis < 3; axis++) {
      g.strokeStyle = css.getPropertyValue(`--cv-axis-${axis}`).trim() || PALETTES.standard.axis[axis];
      g.setLineDash(AXIS_DASH[axis]);
      g.lineWidth = 1.5;
      g.beginPath();
      h.forEach((sample, i) => {
        const x = (i / (HISTORY - 1)) * w;
        const y = ht / 2 - (Math.max(-range, Math.min(range, sample[axis])) / range) * (ht / 2 - 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }
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
