// Calibration (protocol 1.5): stick centers, deadzones and range, trigger
// travel and the gyro's zero, stored in the dongle per pairing slot and
// applied to what games see; nothing is written to the controller. Each part
// is calibrated where its subject is (IA audit C9, Q3): the sticks in Sticks
// & calibration, the triggers in Adaptive triggers (above the trigger test),
// the gyroscope in its own Gyroscope section. A guided run measures the part
// from the raw live input (every step starts with a short "get ready" pause;
// a step that didn't go all the way keeps the old value); the sticks' values
// can also be adjusted by hand, with the corrected result previewed live.
// Reset puts that part back to the controller's own (uncalibrated) values.
//
// The draft is the app's one calibration draft (boardDrafts.tsx): one body
// per slot, staged until the save bar's Save (IA audit Q1).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { DEFAULT_CALIBRATION, correctStick, correctTrigger, fitCenter, fitGyro, fitOuter, fitTrigger, normalizeCalibration, type Calibration as Cal } from "../../protocol/calibration";
import { Slider } from "../controls";
import { useProfileTarget } from "../library/libraryContext";
import { SlotReadError } from "./slotSettings";
import { useBoardDrafts, type SlotDraft } from "./boardDrafts";
import Notice from "../Notice";
import { SectionGroup } from "../accordion/Section";

export { supportsCalibration } from "./boardDrafts";

type Measure = "center" | "edges" | "triggers" | "gyro";
type Step = "idle" | "done" | { measure: Measure; ready: boolean };
const STEP_MS: Record<Measure, number> = { center: 2000, edges: 5000, triggers: 4000, gyro: 2500 };
const READY_MS = 1500; // time to read the instruction and get into position
const GYRO_SETTLE_MS = 500; // the first moments of the gyro step are ignored

// The guided run over `order`: a pause to get ready, then sample the raw
// input and fit each measure into the draft.
function useGuidedRun(order: readonly Measure[], input: InputReport | null, cal: SlotDraft<Cal>) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("idle");
  const [missed, setMissed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // cache: OK — key=sample time; invalidated=reset at each step; bound=one step (≤ 5 s at ~30 Hz)
  const samples = useRef<Array<{ at: number; r: InputReport }>>([]);
  const latest = useRef(input);
  // lifetime: OK — acquires nothing (mirrors the input into a ref)
  useEffect(() => {
    latest.current = input;
  }, [input]);
  const { setDraft } = cal;
  // lifetime: OK — cleanup: clears the step's timers (next step, cancel or unmount)
  useEffect(() => {
    if (step === "idle" || step === "done") return;
    const { measure, ready } = step;
    if (!ready) {
      // lifetime: OK — cleared in the effect cleanup
      const go = setTimeout(() => setStep({ measure, ready: true }), READY_MS);
      return () => clearTimeout(go);
    }
    samples.current = [];
    const start = performance.now();
    // lifetime: OK — cleared when the step ends, or in the effect cleanup
    const id = setInterval(() => latest.current && samples.current.push({ at: performance.now() - start, r: latest.current }), 33);
    // lifetime: OK — cleared in the effect cleanup
    const done = setTimeout(() => {
      clearInterval(id);
      const all = samples.current.map((x) => x.r);
      if (all.length < 5) {
        setError(t("desktop.calib.noInput"));
        setStep("idle");
        return;
      }
      const miss: string[] = [];
      setDraft((d) => {
        const next = structuredClone(d);
        if (measure === "center") {
          next.sticks[0] = { ...next.sticks[0], ...fitCenter(all.map((r) => [r.leftStick.x, r.leftStick.y])) };
          next.sticks[1] = { ...next.sticks[1], ...fitCenter(all.map((r) => [r.rightStick.x, r.rightStick.y])) };
        } else if (measure === "edges") {
          ([0, 1] as const).forEach((i) => {
            // loop: NOT-WORTH — once per finished measurement, N ≤ ~150 samples (5 s at 30 Hz)
            const pts = all.map((r): [number, number] => (i === 0 ? [r.leftStick.x, r.leftStick.y] : [r.rightStick.x, r.rightStick.y]));
            const outer = fitOuter(pts, next.sticks[i].cx, next.sticks[i].cy);
            if (outer === null) miss.push(t(i === 0 ? "desktop.calib.leftStick" : "desktop.calib.rightStick"));
            else next.sticks[i].outer = outer;
          });
        } else if (measure === "triggers") {
          ([0, 1] as const).forEach((i) => {
            // loop: NOT-WORTH — once per finished measurement, N ≤ ~150 samples
            const fit = fitTrigger(all.map((r) => (i === 0 ? r.triggerLeft : r.triggerRight)));
            if (fit === null) miss.push(i === 0 ? "L2" : "R2");
            else next.triggers[i] = fit;
          });
        } else {
          // Report order (offsets 15, 17, 19): gyroX, gyroZ, gyroY.
          const still = samples.current.filter((x) => x.at >= GYRO_SETTLE_MS).map(({ r }): [number, number, number] => [r.gyroX, r.gyroZ, r.gyroY]);
          const fit = still.length >= 5 ? fitGyro(still) : null;
          if (fit === null) miss.push(t("desktop.calib.gyro"));
          else next.gyro = fit;
        }
        return normalizeCalibration(next);
      });
      if (miss.length) setMissed((m) => [...m, ...miss]);
      const i = order.indexOf(measure);
      setStep(i + 1 < order.length ? { measure: order[i + 1], ready: false } : "done");
    }, STEP_MS[measure]);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [step, t, setDraft, order]);
  const begin = () => {
    setMissed([]);
    setError(null);
    setStep({ measure: order[0], ready: false });
  };
  return { step, missed, error, begin, running: step !== "idle" && step !== "done" };
}

// The run's group: its button (or the step being measured) with Reset, the
// result, what stops it, then `children` (the part's values, if they belong
// in the same group).
function CalibrationGroup({
  title,
  order,
  input,
  info,
  reset,
  children,
}: {
  title: string;
  order: readonly Measure[];
  input: InputReport | null;
  info?: string;
  reset: (() => void) | null; // null: nothing to reset, so no button
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { calibration: cal } = useBoardDrafts();
  // Calibration belongs to the controller, not to a game's profile (said while one is on).
  const target = useProfileTarget();
  const run = useGuidedRun(order, input, cal);
  const { step } = run;
  return (
    <SectionGroup title={title} info={info}>
      {target && <Notice closable>{t("desktop.editing.calibrationNote", { title: target.title })}</Notice>}
      {run.running && step !== "idle" && step !== "done" ? (
        <div className="calib-step" role="status">
          <b>
            {order.indexOf(step.measure) + 1}/{order.length} · {t(`desktop.calib.step.${step.measure}`)}
          </b>
          {step.ready ? (
            <span className="calib-progress" key={step.measure} style={{ animationDuration: `${STEP_MS[step.measure]}ms` }} />
          ) : (
            <span className="dk-hint">{t("desktop.calib.getReady")}</span>
          )}
        </div>
      ) : (
        <div className="dk-row-btns">
          {/* With a controller only; without one, the hint below says so. */}
          {input && (
            <button type="button" className="dk-btn primary" onClick={run.begin}>
              {step === "done" ? t("desktop.calib.again") : t("desktop.calib.start")}
            </button>
          )}
          {/* Back to the controller's own values: a change like any other, kept by the save bar. Only when there's something to reset. */}
          {reset && (
            <button type="button" className="dk-btn danger" onClick={reset}>
              {t("desktop.calib.reset")}
            </button>
          )}
        </div>
      )}
      {step === "done" && !run.missed.length && <p className="dk-good">✓ {t("desktop.calib.measured")}</p>}
      {step === "done" && run.missed.length > 0 && <p className="dk-bad">{t("desktop.calib.missed", { parts: run.missed.join(", ") })}</p>}
      {run.error && <p className="dk-bad">{run.error}</p>}
      {!input && <p className="dk-hint">{t("desktop.calib.needsController")}</p>}
      {children}
      <SlotReadError error={cal.error} retry={cal.saved === null ? cal.retry : null} />
    </SectionGroup>
  );
}

// Whether a part is calibrated (the section statuses).
export const sticksCalibrated = (c: Cal) => JSON.stringify(c.sticks) !== JSON.stringify(DEFAULT_CALIBRATION.sticks);
export const triggersCalibrated = (c: Cal) => JSON.stringify(c.triggers) !== JSON.stringify(DEFAULT_CALIBRATION.triggers);
// loop: NOT-WORTH — N = 3 gyro axes
export const gyroCalibrated = (c: Cal) => c.gyro.some((g) => g !== 0);

// A part's calibration, once there's something to calibrate: nothing without
// a board, the firmware to update without calibration (protocol 1.5).
function CalibrationPart({ bridge, title, children }: { bridge: UseDs5BridgeResult; title: string; children: (cal: SlotDraft<Cal>) => ReactNode }) {
  const { t } = useTranslation();
  const { calibration } = useBoardDrafts();
  if (!bridge.client) return null;
  if (!calibration.supported)
    return (
      <SectionGroup title={title}>
        <p className="dk-hint">{t("desktop.calib.needsFirmware")}</p>
      </SectionGroup>
    );
  return children(calibration);
}

const STICK_RUN = ["center", "edges"] as const;
const TRIGGER_RUN = ["triggers"] as const;
const GYRO_RUN = ["gyro"] as const;
// One part of the calibration put back to the controller's own values.
const resetPart = (cal: SlotDraft<Cal>, part: Partial<Cal>) => cal.setDraft((d) => normalizeCalibration({ ...structuredClone(d), ...structuredClone(part) }));

// Sticks & calibration: center, deadzone and range of both sticks.
export function StickCalibration({ bridge, input }: { bridge: UseDs5BridgeResult; input: InputReport | null }) {
  const { t } = useTranslation();
  return (
    <CalibrationPart bridge={bridge} title={t("desktop.calib.sticksTitle")}>
      {(cal) => {
        const editStick = (i: 0 | 1, patch: Partial<Cal["sticks"][0]>) =>
          cal.setDraft((d) => {
            const next = structuredClone(d);
            next.sticks[i] = { ...next.sticks[i], ...patch };
            return normalizeCalibration(next);
          });
        return (
          <>
            <CalibrationGroup
              title={t("desktop.calib.sticksTitle")}
              order={STICK_RUN}
              input={input}
              info={t("desktop.calib.intro")}
              reset={sticksCalibrated(cal.draft) ? () => resetPart(cal, { sticks: DEFAULT_CALIBRATION.sticks }) : null}
            />
            {/* loop: HOT-PATH-OK — N = 2 sticks, per live frame while calibrating */}
            {(["left", "right"] as const).map((side, i) => {
              const s = cal.draft.sticks[i];
              const raw = input ? (i === 0 ? input.leftStick : input.rightStick) : { x: 128, y: 128 };
              const [cxOut, cyOut] = correctStick(raw.x, raw.y, s);
              return (
                <SectionGroup key={side} title={t(`desktop.calib.${side}Stick`)}>
                  <div className="calib-preview">
                    <StickDot label={t("desktop.calib.raw")} x={raw.x} y={raw.y} deadzone={s.deadzone} cx={s.cx} cy={s.cy} />
                    <StickDot label={t("desktop.calib.corrected")} x={cxOut} y={cyOut} />
                  </div>
                  <Slider
                    label={t("desktop.calib.deadzone")}
                    sub={t("desktop.calib.deadzoneSub")}
                    value={s.deadzone}
                    min={0}
                    max={64}
                    step={1}
                    onChange={(v) => editStick(i as 0 | 1, { deadzone: v })}
                  />
                  <Slider label={t("desktop.calib.outer")} sub={t("desktop.calib.outerSub")} value={s.outer} min={64} max={128} step={1} onChange={(v) => editStick(i as 0 | 1, { outer: v })} />
                  <p className="dk-hint dk-mono">{t("desktop.calib.center", { x: s.cx, y: s.cy })}</p>
                </SectionGroup>
              );
            })}
          </>
        );
      }}
    </CalibrationPart>
  );
}

// Adaptive triggers: how far each trigger travels (lo..hi stretched to 0..255).
export function TriggerCalibration({ bridge, input }: { bridge: UseDs5BridgeResult; input: InputReport | null }) {
  const { t } = useTranslation();
  return (
    <CalibrationPart bridge={bridge} title={t("desktop.calib.triggersTitle")}>
      {(cal) => (
        <CalibrationGroup
          title={t("desktop.calib.triggersTitle")}
          order={TRIGGER_RUN}
          input={input}
          reset={triggersCalibrated(cal.draft) ? () => resetPart(cal, { triggers: DEFAULT_CALIBRATION.triggers }) : null}
        >
          {/* loop: HOT-PATH-OK — N = 2 triggers, per live frame while calibrating */}
          {(["L2", "R2"] as const).map((name, i) => {
            const tr = cal.draft.triggers[i];
            const raw = input ? (i === 0 ? input.triggerLeft : input.triggerRight) : 0;
            return (
              <p key={name} className="dk-mono calib-trigger">
                {name}: {tr.lo}–{tr.hi} · {t("desktop.calib.now", { raw, out: correctTrigger(raw, tr) })}
              </p>
            );
          })}
        </CalibrationGroup>
      )}
    </CalibrationPart>
  );
}

// Gyroscope: its zero at rest (what a still controller reads).
export function GyroCalibration({ bridge, input }: { bridge: UseDs5BridgeResult; input: InputReport | null }) {
  const { t } = useTranslation();
  return (
    <CalibrationPart bridge={bridge} title={t("desktop.calib.gyroTitle")}>
      {(cal) => (
        <CalibrationGroup title={t("desktop.calib.gyroTitle")} order={GYRO_RUN} input={input} reset={gyroCalibrated(cal.draft) ? () => resetPart(cal, { gyro: [0, 0, 0] }) : null}>
          <p className="dk-mono">
            {t("desktop.calib.gyroZero")} {gyroCalibrated(cal.draft) ? cal.draft.gyro.join(" · ") : "—"}
          </p>
        </CalibrationGroup>
      )}
    </CalibrationPart>
  );
}

// A stick's position in a ring; with a deadzone, the zone around the center.
function StickDot({ label, x, y, deadzone, cx = 0, cy = 0 }: { label: string; x: number; y: number; deadzone?: number; cx?: number; cy?: number }) {
  const map = (v: number) => 30 + ((v - 128) / 128) * 26;
  return (
    <figure className="calib-dot">
      <svg viewBox="0 0 60 60" className="live-stick" aria-hidden="true">
        <circle cx="30" cy="30" r="26" className="ring" />
        <line x1="30" y1="4" x2="30" y2="56" className="cross" />
        <line x1="4" y1="30" x2="56" y2="30" className="cross" />
        {deadzone !== undefined && deadzone > 0 && <circle cx={map(128 + cx)} cy={map(128 + cy)} r={(deadzone / 128) * 26} className="calib-dz" />}
        <circle cx={map(x).toFixed(1)} cy={map(y).toFixed(1)} r="4" className="dot" />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
