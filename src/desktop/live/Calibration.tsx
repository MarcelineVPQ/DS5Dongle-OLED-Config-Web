// Calibration (protocol 1.5): stick centers, deadzones and range, trigger
// travel and the gyro's zero, stored in the dongle per pairing slot and
// applied to what games see; nothing is written to the controller. A guided
// run measures each from the raw live input (every step starts with a short
// "get ready" pause; a step that didn't go all the way keeps the old value);
// every value can also be adjusted by hand, with the corrected result
// previewed live. Reset puts everything back to the controller's own
// (uncalibrated) values.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../errorText";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { FEATURES2, supportsFeature2, type Ds5BridgeClient } from "../../protocol/bridgeClient";
import { DEFAULT_CALIBRATION, correctStick, correctTrigger, fitCenter, fitGyro, fitOuter, fitTrigger, normalizeCalibration, type Calibration as Cal } from "../../protocol/calibration";
import { BusyButton, Slider } from "../controls";
import StickCurves from "./StickCurves";
import { useProfileTarget } from "../library/libraryContext";
import StickTests from "./StickTestCards";
import { SlotReadError, useSlotSettings, type SlotRead } from "./slotSettings";

type Measure = "center" | "edges" | "triggers" | "gyro";
type Step = "idle" | "done" | { measure: Measure; ready: boolean };
const STEP_MS: Record<Measure, number> = { center: 2000, edges: 5000, triggers: 4000, gyro: 2500 };
const READY_MS = 1500; // time to read the instruction and get into position
const GYRO_SETTLE_MS = 500; // the first moments of the gyro step are ignored
const ORDER: Measure[] = ["center", "edges", "triggers", "gyro"];

export const supportsCalibration = (identity: UseDs5BridgeResult["identity"]) => supportsFeature2(identity, 5, FEATURES2.calibration);

const readCal = (client: Ds5BridgeClient): Promise<SlotRead<Cal>> => client.readCalibration().then(({ slot, calibration }) => ({ slot, value: calibration }));

export default function Calibration({ bridge, input }: { bridge: UseDs5BridgeResult; input: InputReport | null }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const supported = supportsCalibration(bridge.identity);
  // Calibration belongs to the controller, not to a game's profile (said while one is on).
  const target = useProfileTarget();
  const { slot, saved, draft, setDraft, error, setError, loaded, retry } = useSlotSettings(bridge, supported, DEFAULT_CALIBRATION, readCal);
  const [step, setStep] = useState<Step>("idle");
  const [missed, setMissed] = useState<string[]>([]);

  // Guided run: a pause to get ready, then sample the raw input and fit.
  // cache: OK — key=sample time; invalidated=reset at each step; bound=one step (≤ 5 s at ~30 Hz)
  const samples = useRef<Array<{ at: number; r: InputReport }>>([]);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  useEffect(() => {
    if (step === "idle" || step === "done") return;
    const { measure, ready } = step;
    if (!ready) {
      const go = setTimeout(() => setStep({ measure, ready: true }), READY_MS);
      return () => clearTimeout(go);
    }
    samples.current = [];
    const start = performance.now();
    const id = setInterval(() => latest.current && samples.current.push({ at: performance.now() - start, r: latest.current }), 33);
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
      const i = ORDER.indexOf(measure);
      setStep(i + 1 < ORDER.length ? { measure: ORDER[i + 1], ready: false } : "done");
    }, STEP_MS[measure]);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [step, t, setDraft, setError]);

  if (!client) return null;
  if (!supported) {
    return (
      <section className="dk-card">
        <h2>{t("desktop.calib.title")}</h2>
        <p className="dk-hint">{t("desktop.calib.needsFirmware")}</p>
      </section>
    );
  }

  const changed = saved !== null && JSON.stringify(normalizeCalibration(draft)) !== JSON.stringify(saved);
  const save = async (c: Cal) => {
    setError(null);
    try {
      await client.setCalibration(slot, c);
      loaded(await readCal(client));
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const editStick = (i: 0 | 1, patch: Partial<Cal["sticks"][0]>) =>
    setDraft((d) => {
      const next = structuredClone(d);
      next.sticks[i] = { ...next.sticks[i], ...patch };
      return normalizeCalibration(next);
    });
  const begin = () => {
    setMissed([]);
    setError(null);
    setStep({ measure: "center", ready: false });
  };

  const running = step !== "idle" && step !== "done";
  return (
    <>
      <section className="dk-card">
        <h2>{t("desktop.calib.title")}</h2>
        <p className="dk-hint">{t("desktop.calib.intro")}</p>
        <p className="dk-hint">{t("desktop.calib.forSlot", { slot })}</p>
        {target && <div className="dk-notice">{t("desktop.editing.calibrationNote", { title: target.title })}</div>}
        {running ? (
          <div className="calib-step" role="status">
            <b>
              {ORDER.indexOf(step.measure) + 1}/{ORDER.length} · {t(`desktop.calib.step.${step.measure}`)}
            </b>
            {step.ready ? (
              <span className="calib-progress" key={step.measure} style={{ animationDuration: `${STEP_MS[step.measure]}ms` }} />
            ) : (
              <span className="dk-hint">{t("desktop.calib.getReady")}</span>
            )}
          </div>
        ) : (
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" disabled={!input} onClick={begin}>
              {step === "done" ? t("desktop.calib.again") : t("desktop.calib.start")}
            </button>
          </div>
        )}
        {step === "done" && !missed.length && <p className="dk-good">✓ {t("desktop.calib.measured")}</p>}
        {step === "done" && missed.length > 0 && <p className="dk-bad">{t("desktop.calib.missed", { parts: missed.join(", ") })}</p>}
        {!input && <p className="dk-hint">{t("desktop.calib.needsController")}</p>}
      </section>

      {/* loop: HOT-PATH-OK — N = 2 sticks, per live frame while calibrating */}
      {(["left", "right"] as const).map((side, i) => {
        const s = draft.sticks[i];
        const raw = input ? (i === 0 ? input.leftStick : input.rightStick) : { x: 128, y: 128 };
        const [cxOut, cyOut] = correctStick(raw.x, raw.y, s);
        return (
          <section className="dk-card" key={side}>
            <h2>{t(`desktop.calib.${side}Stick`)}</h2>
            <div className="calib-preview">
              <StickDot label={t("desktop.calib.raw")} x={raw.x} y={raw.y} deadzone={s.deadzone} cx={s.cx} cy={s.cy} />
              <StickDot label={t("desktop.calib.corrected")} x={cxOut} y={cyOut} />
            </div>
            <Slider label={t("desktop.calib.deadzone")} sub={t("desktop.calib.deadzoneSub")} value={s.deadzone} min={0} max={64} step={1} onChange={(v) => editStick(i as 0 | 1, { deadzone: v })} />
            <Slider label={t("desktop.calib.outer")} sub={t("desktop.calib.outerSub")} value={s.outer} min={64} max={128} step={1} onChange={(v) => editStick(i as 0 | 1, { outer: v })} />
            <p className="dk-hint dk-mono">{t("desktop.calib.center", { x: s.cx, y: s.cy })}</p>
          </section>
        );
      })}

      <StickCurves bridge={bridge} input={input} sticks={draft.sticks} />

      <StickTests input={input} sticks={draft.sticks} />

      <section className="dk-card">
        <h2>{t("desktop.calib.triggers")}</h2>
        {/* loop: HOT-PATH-OK — N = 2 triggers, per live frame while calibrating */}
        {(["L2", "R2"] as const).map((name, i) => {
          const tr = draft.triggers[i];
          const raw = input ? (i === 0 ? input.triggerLeft : input.triggerRight) : 0;
          return (
            <p key={name} className="dk-mono calib-trigger">
              {name}: {tr.lo}–{tr.hi} · {t("desktop.calib.now", { raw, out: correctTrigger(raw, tr) })}
            </p>
          );
        })}
        <h2>{t("desktop.calib.gyro")}</h2>
        <p className="dk-mono">
          {/* loop: HOT-PATH-OK — N = 3 gyro axes */}
          {t("desktop.calib.gyroZero")} {draft.gyro.every((g) => g === 0) ? "—" : draft.gyro.join(" · ")}
        </p>
      </section>

      <section className="dk-card">
        <div className="dk-row-btns">
          <BusyButton className="dk-btn primary" disabled={!changed || running} onClick={() => save(draft)}>
            {t("desktop.calib.save")}
          </BusyButton>
          <button type="button" className="dk-btn" disabled={!changed || running} onClick={() => saved && setDraft(saved)}>
            {t("desktop.calib.revert")}
          </button>
          <BusyButton className="dk-btn danger" disabled={running || saved === null} onClick={() => save(DEFAULT_CALIBRATION)}>
            {t("desktop.calib.reset")}
          </BusyButton>
        </div>
        <p className="dk-hint">{t("desktop.calib.saveHint")}</p>
        <SlotReadError error={error} retry={saved === null ? retry : null} />
      </section>
    </>
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
