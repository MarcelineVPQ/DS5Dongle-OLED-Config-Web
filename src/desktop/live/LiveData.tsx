// Everything the controller reports, as numbers (and motion as scrolling
// graphs), plus the dongle's settings at a glance, in eight cards so they
// always split evenly (4+4, or 2+2+2+2 when narrow):
// sticks, triggers and their effects, gyro, accelerometer and tilt, the
// controller (touch points, what's plugged in, mute) and the link (sensor
// clock, update rate, round trip, signal, USB power).
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import type { ConfigBody } from "../../protocol/config";
import { liveStats } from "../useLiveInput";
import type { PanelView } from "./PartPanel";

interface Props {
  input: InputReport;
  rssi: number | null;
  // The dongle's settings at a glance; each line opens its panel.
  config: ConfigBody | null;
  firmware: string | null;
  onOpen: (view: PanelView) => void;
}

const HISTORY = 150;
const AXIS_COLORS = ["#f43f5e", "#22c55e", "#3b82f6"]; // X red, Y green, Z blue (as in 3D tools)

export default function LiveData({ input, rssi, config, firmware, onOpen }: Props) {
  const { t } = useTranslation();
  const tl = (key: string) => t(`desktop.liveData.${key}`);
  const yn = (v: boolean) => (v ? tl("yes") : tl("no"));
  const centered = (v: number) => v - 128;
  const { accelX: ax, accelY: ay, accelZ: az } = input;
  const roll = (Math.atan2(ay, az) * 180) / Math.PI;
  const pitch = (Math.atan2(-ax, Math.hypot(ay, az)) * 180) / Math.PI;
  const fingers = input.fingers;

  return (
    <section className="live-data" aria-label={tl("title")}>
      <Card title={tl("sticks")}>
        <Rows
          rows={[
            ["L  X / Y", `${fmt(centered(input.leftStick.x), 4)} ${fmt(centered(input.leftStick.y), 4)}`],
            ["R  X / Y", `${fmt(centered(input.rightStick.x), 4)} ${fmt(centered(input.rightStick.y), 4)}`],
            ["L3 / R3", `${input.l3 ? "●" : "○"} ${input.r3 ? "●" : "○"}`],
          ]}
        />
      </Card>
      <Card title={tl("triggers")}>
        <Rows
          rows={[
            ["L2", `${fmt(input.triggerLeft, 3)} / 255`],
            ["R2", `${fmt(input.triggerRight, 3)} / 255`],
            [
              tl("effect"),
              `${t(`desktop.live.effects.${input.triggerEffectLeft}`, String(input.triggerEffectLeft))} · ${t(`desktop.live.effects.${input.triggerEffectRight}`, String(input.triggerEffectRight))}`,
            ],
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
      <Card title={tl("ports")}>
        <Rows
          rows={[
            ...fingers.map((f, i): [string, string] => [t("desktop.liveData.finger", { n: i + 1 }), f.touching ? `${fmt(f.x, 4)} ${fmt(f.y, 4)}` : "—"]),
            [tl("headset"), yn(input.headphones)],
            [tl("mic"), yn(input.micPlugged)],
            [tl("muted"), yn(input.micMuted)],
          ]}
        />
      </Card>
      <Card title={tl("link")}>
        <Rows
          rows={[
            [tl("clock"), `${(input.sensorTime / 3_000_000).toFixed(2)} s`],
            [tl("rate"), `${liveStats.hz.toFixed(1)} /s`],
            [tl("roundTrip"), `${liveStats.ms.toFixed(1)} ms`],
            // Bluetooth reports RSSI relative to the ideal ("golden") range: 0 = in it.
            [tl("signal"), rssi === null ? "—" : rssi === 0 ? tl("inRange") : `${rssi} dB`],
            [tl("usb"), yn(input.usbPower)],
          ]}
        />
      </Card>
      <Card title={tl("audio")}>
        {config ? (
          <Links
            rows={[
              [t("haptics.gainLabel"), `${config.hapticsGain.toFixed(1)}×`, () => onOpen({ part: "body" })],
              [t("desktop.settings.speakerLevel"), `${config.speakerVolume > 0 ? "+" : ""}${Math.round(config.speakerVolume)} dB`, () => onOpen({ part: "speaker" })],
              [t("autoHaptics.sectionTitle"), t(`autoHaptics.modes.${AUTO_HAPTICS[config.autoHapticsEnable] ?? "off"}.label`), () => onOpen({ part: "body" })],
              [t("haptics.btMicLabel"), config.btMicEnable ? tl("on") : tl("off"), () => onOpen({ part: "mute" })],
            ]}
          />
        ) : (
          <p className="dk-hint">—</p>
        )}
      </Card>
      <Card title={t("desktop.nav.dongle", "Dongle")}>
        {config ? (
          <Links
            rows={[
              [t("desktop.overview.firmware"), firmware ?? "—", () => onOpen("dongle")],
              [t("behavior.pollingRateLabel"), POLLING[config.pollingRateMode] ?? "—", () => onOpen("dongle")],
              [t("behavior.controllerModeLabel"), MODES[config.controllerMode] ?? "—", () => onOpen("dongle")],
              [tl("idle"), config.disableInactiveDisconnect ? tl("never") : `${config.inactiveTime} min`, () => onOpen("dongle")],
              [t("desktop.settings.display"), `${config.screenBrightness + 1}/4`, () => onOpen("dongle")],
            ]}
          />
        ) : (
          <p className="dk-hint">—</p>
        )}
      </Card>
    </section>
  );
}

const AUTO_HAPTICS = ["off", "fallback", "mix", "replace"] as const;
const POLLING = ["250 Hz", "500 Hz", "1 kHz"];
const MODES = ["DS5", "Edge", "Auto"];

// Settings rows that open their panel when clicked.
function Links({ rows }: { rows: Array<[string, string, () => void]> }) {
  return (
    <dl className="live-data-rows live-data-links">
      {rows.map(([k, v, open]) => (
        <div key={k}>
          <dt>
            <button type="button" className="live-data-link" onClick={open}>
              {k}
            </button>
          </dt>
          <dd title={v}>{v}</dd>
        </div>
      ))}
    </dl>
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
          <dt>{k}</dt>
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
          <b style={{ color: AXIS_COLORS[i] }}>{axis}</b>
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
    for (let axis = 0; axis < 3; axis++) {
      g.strokeStyle = AXIS_COLORS[axis];
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
