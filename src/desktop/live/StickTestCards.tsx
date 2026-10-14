// Stick tests in the Calibration view: a circularity test (the outline each
// stick reaches against a perfect circle, raw or with the calibration above
// applied) and a drift test (where the sticks sit and wander while nobody
// touches them). The math is in stickTests.ts.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import { correctStick, type StickCal } from "../../protocol/calibration";
import { Segmented } from "../controls";
import { DRIFT_MS, type DriftSample, type Outline, addPoint, circularity, driftStats, emptyOutline, normAxis } from "./stickTests";

const SAMPLE_MS = 33; // the live input arrives at ~30 Hz
const SIDES = ["left", "right"] as const;
const stickOf = (r: InputReport, i: number) => (i === 0 ? r.leftStick : r.rightStick);

interface Outlines {
  key: string; // the calibration the "what games see" outlines were drawn with
  raw: [Outline, Outline];
  cal: [Outline, Outline];
}
const fresh = (key: string): Outlines => ({ key, raw: [emptyOutline(), emptyOutline()], cal: [emptyOutline(), emptyOutline()] });

export default function StickTests({ input, sticks }: { input: InputReport | null; sticks: readonly [StickCal, StickCal] }) {
  const { t } = useTranslation();
  const latest = useRef(input);
  const cal = useRef(sticks);
  useEffect(() => {
    latest.current = input;
    cal.current = sticks;
  }, [input, sticks]);
  const calKey = JSON.stringify(sticks);

  // Circularity: always tracking while the view is open, until Reset.
  const [outlines, setOutlines] = useState<Outlines>(() => fresh(calKey));
  const [view, setView] = useState<0 | 1>(0);
  useEffect(() => {
    const id = setInterval(() => {
      const r = latest.current;
      if (!r) return;
      const key = JSON.stringify(cal.current);
      setOutlines((o) => {
        // A changed calibration starts the "what games see" outlines over.
        const base = o.key === key ? o : { ...o, key, cal: [emptyOutline(), emptyOutline()] as [Outline, Outline] };
        // loop: HOT-PATH-OK — N = 2 sticks per sample while the stick test is open
        const raw = base.raw.map((out, i) => {
          const s = stickOf(r, i);
          return addPoint(out, normAxis(s.x), normAxis(s.y));
        }) as [Outline, Outline];
        // loop: HOT-PATH-OK — N = 2 sticks per sample while the stick test is open
        const corrected = base.cal.map((out, i) => {
          const s = stickOf(r, i);
          const [x, y] = correctStick(s.x, s.y, cal.current[i]);
          return addPoint(out, normAxis(x), normAxis(y));
        }) as [Outline, Outline];
        // loop: HOT-PATH-OK — N = 2 outlines, skips the state update when nothing moved
        if (base === o && raw.every((v, i) => v === o.raw[i]) && corrected.every((v, i) => v === o.cal[i])) return o;
        return { key, raw, cal: corrected };
      });
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);
  const shown = view === 0 ? outlines.raw : outlines.key === calKey ? outlines.cal : [emptyOutline(), emptyOutline()];

  // Drift: sample the resting sticks for DRIFT_MS.
  const [drift, setDrift] = useState<"idle" | "running" | "short" | [DriftSample[], DriftSample[]]>("idle");
  // The results of a finished test: its samples don't change, so worked out
  // once, not on every live input frame (~30 a second).
  const driftResults = useMemo(() => (typeof drift === "object" ? ([driftStats(drift[0], sticks[0]), driftStats(drift[1], sticks[1])] as const) : null), [drift, sticks]);
  // cache: OK — key=stick; invalidated=reset when a drift test starts; bound=DRIFT_MS = 10 s at ~30 Hz, 2 sticks
  const samples = useRef<[DriftSample[], DriftSample[]]>([[], []]);
  useEffect(() => {
    if (drift !== "running") return;
    samples.current = [[], []];
    const start = performance.now();
    const id = setInterval(() => {
      const r = latest.current;
      if (!r) return;
      const at = performance.now() - start;
      // loop: HOT-PATH-OK — N = 2 sticks per 33 ms sample, only during the 10 s drift test
      samples.current.forEach((list, i) => list.push({ t: at, ...stickOf(r, i) }));
    }, SAMPLE_MS);
    const done = setTimeout(() => {
      clearInterval(id);
      setDrift(samples.current[0].length < 5 ? "short" : samples.current);
    }, DRIFT_MS);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [drift]);

  const pct = (v: number) => `${v.toFixed(1)}%`;
  return (
    <>
      <section className="dk-card">
        <h2>{t("desktop.stickTest.circleTitle")}</h2>
        <p className="dk-hint">{t("desktop.stickTest.circleHow")}</p>
        <Segmented
          label={t("desktop.stickTest.show")}
          value={view}
          options={[
            { value: 0, label: t("desktop.calib.raw") },
            { value: 1, label: t("desktop.calib.corrected") },
          ]}
          onChange={setView}
        />
        <div className="stest-pair">
          {/* loop: HOT-PATH-OK — N = 2 sticks per live frame (72-bucket outlines) */}
          {SIDES.map((side, i) => {
            const c = circularity(shown[i]);
            const now = input ? stickOf(input, i) : null;
            const dot = now ? (view === 0 ? [now.x, now.y] : correctStick(now.x, now.y, sticks[i])) : null;
            return (
              <figure className="stest-stick" key={side}>
                <CirclePlot outline={shown[i]} dot={dot ? [normAxis(dot[0]), normAxis(dot[1])] : null} />
                <figcaption>
                  <b>{t(`desktop.calib.${side}Stick`)}</b>
                  {c.errorPct === null ? (
                    <span className="dk-hint">{t("desktop.stickTest.notYet")}</span>
                  ) : (
                    <>
                      <span className="dk-mono">{t("desktop.stickTest.error", { pct: pct(c.errorPct) })}</span>
                      <span className="dk-mono">{t("desktop.stickTest.coverage", { pct: pct(c.coveragePct) })}</span>
                      <span className="dk-hint">{t("desktop.stickTest.overUnder", { over: pct(c.overPct), under: pct(c.underPct) })}</span>
                      {c.meanReach !== null && c.meanReach < 0.85 && <span className="dk-hint">{t("desktop.stickTest.short")}</span>}
                    </>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
        <p className="dk-hint">
          <svg className="stest-key" viewBox="0 0 20 6" aria-hidden="true">
            <line x1="1" y1="3" x2="19" y2="3" className="stest-ref" />
          </svg>
          {t("desktop.stickTest.keyCircle")}{" "}
          <svg className="stest-key" viewBox="0 0 20 6" aria-hidden="true">
            <line x1="1" y1="3" x2="19" y2="3" className="stest-outline" />
          </svg>
          {t("desktop.stickTest.keyOutline")}
        </p>
        <p className="dk-hint">{t("desktop.stickTest.circleGood")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn" onClick={() => setOutlines(fresh(calKey))}>
            {t("desktop.stickTest.reset")}
          </button>
        </div>
      </section>

      <section className="dk-card">
        <h2>{t("desktop.stickTest.driftTitle")}</h2>
        <p className="dk-hint">{t("desktop.stickTest.driftHow", { seconds: DRIFT_MS / 1000 })}</p>
        {drift === "running" ? (
          <div className="calib-step" role="status">
            <b>{t("desktop.stickTest.driftRunning")}</b>
            <span className="calib-progress" style={{ animationDuration: `${DRIFT_MS}ms` }} />
          </div>
        ) : (
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" disabled={!input} onClick={() => setDrift("running")}>
              {typeof drift === "object" ? t("desktop.stickTest.driftAgain") : t("desktop.stickTest.driftStart")}
            </button>
          </div>
        )}
        {drift === "short" && <p className="dk-bad">{t("desktop.calib.noInput")}</p>}
        {typeof drift === "object" &&
          // loop: HOT-PATH-OK — N = 2 sticks; the stats are memoized on the finished samples
          SIDES.map((side, i) => {
            const d = driftResults?.[i];
            if (!d) return null;
            return (
              <div className="stest-drift" key={side}>
                <b>{t(`desktop.calib.${side}Stick`)}</b>
                <DriftPlot samples={drift[i]} />
                <span className="dk-mono">{t("desktop.stickTest.driftStats", { max: pct(d.maxPct), avg: pct(d.avgPct) })}</span>
                <span className="dk-hint">
                  {d.beyondDeadzone === null
                    ? t("desktop.stickTest.noDeadzone")
                    : t(d.beyondDeadzone ? "desktop.stickTest.leavesDeadzone" : "desktop.stickTest.insideDeadzone", { dz: sticks[i].deadzone })}
                </span>
                {d.noticeable && d.beyondDeadzone !== false ? (
                  <span className="dk-bad">{t("desktop.stickTest.driftWarn")}</span>
                ) : d.noticeable ? (
                  <span className="dk-hint">{t("desktop.stickTest.driftHidden")}</span>
                ) : (
                  <span className="dk-good">✓ {t("desktop.stickTest.steady")}</span>
                )}
              </div>
            );
          })}
        {typeof drift === "object" && (
          <p className="dk-hint">
            <svg className="stest-key" viewBox="0 0 20 6" aria-hidden="true">
              <line x1="1" y1="3" x2="19" y2="3" className="stest-x" />
            </svg>
            {t("desktop.stickTest.keyX")}{" "}
            <svg className="stest-key" viewBox="0 0 20 6" aria-hidden="true">
              <line x1="1" y1="3" x2="19" y2="3" className="stest-y" />
            </svg>
            {t("desktop.stickTest.keyY")}
          </p>
        )}
      </section>
    </>
  );
}

// The reached outline (solid) over a perfect circle (dashed); unreached
// directions leave gaps.
function CirclePlot({ outline, dot }: { outline: Outline; dot: [number, number] | null }) {
  const R = 40; // full tilt, in viewBox units; the outline may go past it
  const step = (2 * Math.PI) / outline.length;
  const at = (r: number, i: number) => `${(50 + r * R * Math.cos((i + 0.5) * step)).toFixed(1)} ${(50 + r * R * Math.sin((i + 0.5) * step)).toFixed(1)}`;
  // loop: HOT-PATH-OK — N = 72 buckets per live frame
  const full = outline.every((r) => r > 0);
  let d = "";
  // loop: HOT-PATH-OK — N = 72 buckets, one path string per live frame
  outline.forEach((r, i) => {
    if (r <= 0) return;
    d += `${d && outline[i - 1] > 0 ? "L" : "M"}${at(Math.min(r, 1.2), i)} `;
  });
  if (full && d) d += "Z";
  return (
    <svg viewBox="0 0 100 100" className="stest-plot" aria-hidden="true">
      <line x1="50" y1="2" x2="50" y2="98" className="stest-axis" />
      <line x1="2" y1="50" x2="98" y2="50" className="stest-axis" />
      <circle cx="50" cy="50" r={R} className="stest-ref" />
      {d && <path d={d} className={`stest-outline${full ? " closed" : ""}`} />}
      {dot && <circle cx={(50 + dot[0] * R).toFixed(1)} cy={(50 + dot[1] * R).toFixed(1)} r="2.5" className="stest-dot" />}
    </svg>
  );
}

// X (solid) and Y (dashed) offset from the center over the test's time.
// memo(): its samples are fixed once the test ends.
const DriftPlot = memo(function DriftPlot({ samples }: { samples: DriftSample[] }) {
  const W = 200;
  const H = 50;
  // loop: HOT-PATH-OK — ~300 samples; memo()ed, once per finished test
  const pts = samples.map((s) => ({ t: s.t, x: normAxis(s.x), y: normAxis(s.y) }));
  // loop: HOT-PATH-OK — ~300 samples; memo()ed, once per finished test
  const scale = Math.max(0.05, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  // loop: HOT-PATH-OK — two ~300-point paths; memo()ed, once per finished test
  const line = (key: "x" | "y") => pts.map((p, i) => `${i ? "L" : "M"}${((p.t / DRIFT_MS) * W).toFixed(1)} ${(H / 2 - (p[key] / scale) * (H / 2 - 2)).toFixed(1)}`).join(" ");
  return (
    <figure className="stest-driftfig">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="stest-driftplot" aria-hidden="true">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="stest-axis" />
        <path d={line("x")} className="stest-x" />
        <path d={line("y")} className="stest-y" />
      </svg>
      <figcaption className="dk-hint">±{(scale * 100).toFixed(1)}%</figcaption>
    </figure>
  );
});
