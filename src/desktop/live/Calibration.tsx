// Calibration (protocol 1.5): stick centers, deadzones and range, trigger
// travel and the gyro's zero, stored in the dongle and applied to what games
// see; nothing is written to the controller. A guided run measures each from
// the raw live input; every value can also be adjusted by hand, with the
// corrected result previewed live. Reset puts everything back to the
// controller's own (uncalibrated) values.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { FEATURES2 } from "../../protocol/bridgeClient";
import { DEFAULT_CALIBRATION, correctStick, correctTrigger, fitCenter, fitOuter, fitTrigger, normalizeCalibration, type Calibration as Cal } from "../../protocol/calibration";
import { BusyButton, Slider } from "../controls";

type Step = "idle" | "center" | "edges" | "triggers" | "gyro" | "done";
const STEP_MS: Record<Exclude<Step, "idle" | "done">, number> = { center: 2000, edges: 5000, triggers: 4000, gyro: 2500 };
const ORDER: Array<Exclude<Step, "idle" | "done">> = ["center", "edges", "triggers", "gyro"];

export function supportsCalibration(identity: UseDs5BridgeResult["identity"]): boolean {
  return !!identity && (identity.protoMajor > 1 || identity.protoMinor >= 5) && (identity.features2 & FEATURES2.calibration) !== 0;
}

export default function Calibration({ bridge, input }: { bridge: UseDs5BridgeResult; input: InputReport | null }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [saved, setSaved] = useState<Cal | null>(null);
  const [draft, setDraft] = useState<Cal>(DEFAULT_CALIBRATION);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.readCalibration().then((c) => {
      setSaved(c);
      setDraft(c);
    });
  }, [client]);

  // Guided run: each step samples the raw input for a moment, then fits.
  const samples = useRef<InputReport[]>([]);
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (step === "idle" || step === "done") return;
    samples.current = [];
    const id = setInterval(() => latest.current && samples.current.push(latest.current), 33);
    const done = setTimeout(() => {
      clearInterval(id);
      const s = samples.current;
      if (s.length < 5) {
        setError(t("desktop.calib.noInput"));
        setStep("idle");
        return;
      }
      setDraft((d) => {
        const next = structuredClone(d);
        if (step === "center") {
          next.sticks[0] = { ...next.sticks[0], ...fitCenter(s.map((r) => [r.leftStick.x, r.leftStick.y])) };
          next.sticks[1] = { ...next.sticks[1], ...fitCenter(s.map((r) => [r.rightStick.x, r.rightStick.y])) };
        } else if (step === "edges") {
          next.sticks[0].outer = fitOuter(
            s.map((r) => [r.leftStick.x, r.leftStick.y]),
            next.sticks[0].cx,
            next.sticks[0].cy,
          );
          next.sticks[1].outer = fitOuter(
            s.map((r) => [r.rightStick.x, r.rightStick.y]),
            next.sticks[1].cx,
            next.sticks[1].cy,
          );
        } else if (step === "triggers") {
          next.triggers = [fitTrigger(s.map((r) => r.triggerLeft)), fitTrigger(s.map((r) => r.triggerRight))];
        } else {
          const avg = (k: "gyroX" | "gyroY" | "gyroZ") => Math.round(s.reduce((a, r) => a + r[k], 0) / s.length);
          next.gyro = [avg("gyroX"), avg("gyroY"), avg("gyroZ")];
        }
        return normalizeCalibration(next);
      });
      const i = ORDER.indexOf(step);
      setStep(i + 1 < ORDER.length ? ORDER[i + 1] : "done");
    }, STEP_MS[step]);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [step, t]);

  if (!client) return null;
  if (!supportsCalibration(bridge.identity)) {
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
      await client.setCalibration(c);
      const back = await client.readCalibration();
      setSaved(back);
      setDraft(back);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const editStick = (i: 0 | 1, patch: Partial<Cal["sticks"][0]>) =>
    setDraft((d) => {
      const next = structuredClone(d);
      next.sticks[i] = { ...next.sticks[i], ...patch };
      return normalizeCalibration(next);
    });

  const running = step !== "idle" && step !== "done";
  return (
    <>
      <section className="dk-card">
        <h2>{t("desktop.calib.title")}</h2>
        <p className="dk-hint">{t("desktop.calib.intro")}</p>
        {running ? (
          <div className="calib-step" role="status">
            <b>
              {ORDER.indexOf(step as never) + 1}/{ORDER.length} · {t(`desktop.calib.step.${step}`)}
            </b>
            <span className="calib-progress" key={step} style={{ animationDuration: `${STEP_MS[step as keyof typeof STEP_MS]}ms` }} />
          </div>
        ) : (
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" disabled={!input} onClick={() => setStep("center")}>
              {step === "done" ? t("desktop.calib.again") : t("desktop.calib.start")}
            </button>
          </div>
        )}
        {step === "done" && <p className="dk-good">✓ {t("desktop.calib.measured")}</p>}
        {!input && <p className="dk-hint">{t("desktop.calib.needsController")}</p>}
      </section>

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
            <Slider label={t("desktop.calib.deadzone")} sub={t("desktop.calib.deadzoneSub")} value={s.deadzone} min={0} max={40} step={1} onChange={(v) => editStick(i as 0 | 1, { deadzone: v })} />
            <Slider label={t("desktop.calib.outer")} sub={t("desktop.calib.outerSub")} value={s.outer} min={64} max={128} step={1} onChange={(v) => editStick(i as 0 | 1, { outer: v })} />
            <p className="dk-hint dk-mono">{t("desktop.calib.center", { x: s.cx, y: s.cy })}</p>
          </section>
        );
      })}

      <section className="dk-card">
        <h2>{t("desktop.calib.triggers")}</h2>
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
          {t("desktop.calib.gyroZero")} {draft.gyro.join(" · ")}
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
          <BusyButton className="dk-btn danger" disabled={running} onClick={() => save(DEFAULT_CALIBRATION)}>
            {t("desktop.calib.reset")}
          </BusyButton>
        </div>
        <p className="dk-hint">{t("desktop.calib.saveHint")}</p>
        {error && <p className="dk-hint">{error}</p>}
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
