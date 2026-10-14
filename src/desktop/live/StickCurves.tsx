// Stick response curves (protocol 1.10) in the Calibration view: a preset or
// a custom curve per stick, saved in the dongle per pairing slot and applied
// after calibration to what every game receives. The graph shows the curve
// against a dashed straight line, the custom points (drag them, or select one
// and use the arrow keys) and a live dot where the stick is now: its tilt in
// (after the calibration above) and what the dongle sends out.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { causeText } from "../shownError";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { FEATURES2, supportsFeature2, type Ds5BridgeClient } from "../../protocol/bridgeClient";
import { correctStick, type StickCal } from "../../protocol/calibration";
import { useLibrary, useProfileTarget } from "../library/libraryContext";
import { profileCurves, sameGameCurves, type GameCurves } from "../library/profileValues";
import {
  CURVE_PRESETS,
  CURVE_TYPES,
  DEFAULT_CURVES,
  LINEAR_CURVE,
  applyCurve,
  curveAt,
  curvesEqual,
  movePoint,
  tiltOf,
  type CurveType,
  type StickCurve,
  type StickCurvePair,
} from "../../protocol/stickCurve";
import { BusyButton, Segmented } from "../controls";
import { SlotReadError, useSlotSettings, type SlotRead } from "./slotSettings";

export const supportsStickCurves = (identity: UseDs5BridgeResult["identity"]) => supportsFeature2(identity, 10, FEATURES2.stickCurves);

const SIDES = ["left", "right"] as const;
const SIZE = 160; // graph size in SVG units (0..1 mapped onto it)
const PAD = 8;
const px = (v: number) => PAD + v * SIZE;
const py = (v: number) => PAD + (1 - v) * SIZE;

const readCurves = (client: Ds5BridgeClient): Promise<SlotRead<StickCurvePair> | null> => client.readStickCurves().then((r) => r && { slot: r.slot, value: r.saved });

// The stick now, after the calibration, and what the curve makes of it: the
// tilt in and out (0..1), or null with no controller input.
function stickTilt(input: InputReport | null, side: 0 | 1, cal: StickCal, curve: StickCurve): [number, number] | null {
  const raw = input ? (side === 0 ? input.leftStick : input.rightStick) : null;
  if (!raw) return null;
  const [x, y] = correctStick(raw.x, raw.y, cal);
  const [ox, oy] = applyCurve(x, y, curve);
  return [Math.min(1, tiltOf(x, y)), Math.min(1, tiltOf(ox, oy))];
}

export default function StickCurves({ bridge, input, sticks }: { bridge: UseDs5BridgeResult; input: InputReport | null; sticks: readonly [StickCal, StickCal] }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const supported = supportsStickCurves(bridge.identity);
  const { slot, saved, draft, setDraft, error, setError, loaded, retry } = useSlotSettings(bridge, supported, DEFAULT_CURVES, readCurves, t("desktop.curves.readFailed"));
  const [side, setSide] = useState<0 | 1>(0);
  // A game's profile on (edited, or its game running): the curves picked here
  // go into that profile (undefined = that stick keeps the normal curve) and
  // the profile hook puts them on the dongle for now (RAM only). The draft is
  // the profile's (kept when this panel closes), saved with "Save to profile".
  const { library, curvesDraft, setCurvesDraft, saveToProfile } = useLibrary();
  const target = useProfileTarget();
  const profile = target ? library.games[target.gameKey]?.profile : undefined;
  const stored = profileCurves(profile?.settings);

  if (!client) return null;
  if (!supported) {
    return (
      <section className="dk-card">
        <h2>{t("desktop.curves.title")}</h2>
        <p className="dk-hint">{t("desktop.curves.needsFirmware")}</p>
      </section>
    );
  }

  if (profile && target)
    return (
      <GameStickCurves
        title={target.title}
        saved={saved}
        draft={curvesDraft ?? stored}
        onDraft={setCurvesDraft}
        side={side}
        onSide={setSide}
        input={input}
        sticks={sticks}
        stored={stored}
        onSave={saveToProfile}
      />
    );

  const curve = draft[side];
  const setCurve = (c: StickCurve) => setDraft((d) => (side === 0 ? [c, d[1]] : [d[0], c]));
  // loop: HOT-PATH-OK — N = 2 sticks per render
  const changed = saved !== null && !draft.every((c, i) => curvesEqual(c, saved[i]));
  const save = async (pair: StickCurvePair) => {
    setError(null);
    try {
      await client.applyStickCurves(slot, pair[0], pair[1], false);
      const back = await readCurves(client);
      if (back) loaded(back);
    } catch (cause) {
      // error: SHOWN — desktop.errors.boardFailed (causeText; other board errors English, batch E3)
      setError(causeText(cause));
    }
  };

  const tilt = stickTilt(input, side, sticks[side], curve);

  return (
    <section className="dk-card">
      <h2>{t("desktop.curves.title")}</h2>
      <p className="dk-hint">{t("desktop.curves.intro")}</p>
      <div className="dk-seg curve-tabs" role="tablist" aria-label={t("desktop.curves.title")}>
        {/* loop: HOT-PATH-OK — N = 2 tabs per render */}
        {SIDES.map((s, i) => (
          <button type="button" role="tab" key={s} className={side === i ? "on" : ""} aria-selected={side === i} onClick={() => setSide(i as 0 | 1)}>
            {t(`desktop.calib.${s}Stick`)}
          </button>
        ))}
      </div>
      <Segmented
        label={t("desktop.curves.curve")}
        value={CURVE_TYPES.indexOf(curve.type)}
        /* loop: HOT-PATH-OK — N = 6 curve types per render */
        options={CURVE_TYPES.map((type, i) => ({ value: i, label: t(`desktop.curves.type.${type}`), title: t(`desktop.curves.typeHint.${type}`) }))}
        onChange={(i) => setCurve({ ...curve, type: CURVE_TYPES[i] as CurveType })}
      />
      <p className="dk-hint">{t(`desktop.curves.typeHint.${curve.type}`)}</p>
      <CurveGraph curve={curve} live={tilt} onPoints={(points) => setCurve({ ...curve, points })} />
      {curve.type === "custom" && <p className="dk-hint">{t("desktop.curves.customHint")}</p>}
      <p className="dk-mono curve-now">{tilt ? t("desktop.curves.now", { in: Math.round(tilt[0] * 100), out: Math.round(tilt[1] * 100) }) : t("desktop.calib.needsController")}</p>
      {bridge.identity?.curvesTemporary && <p className="dk-hint">{t("desktop.curves.gameOn")}</p>}
      <div className="dk-row-btns">
        <BusyButton className="dk-btn primary" disabled={!changed} onClick={() => save(draft)}>
          {t("desktop.calib.save")}
        </BusyButton>
        <button type="button" className="dk-btn" disabled={!changed} onClick={() => saved && setDraft(saved)}>
          {t("desktop.calib.revert")}
        </button>
        <BusyButton
          className="dk-btn"
          /* loop: HOT-PATH-OK — N = 2 sticks per render */
          disabled={saved === null || saved.every((c) => c.type === "linear")}
          onClick={() =>
            save([
              { ...LINEAR_CURVE, points: draft[0].points },
              { ...LINEAR_CURVE, points: draft[1].points },
            ])
          }
        >
          {t("desktop.curves.resetLinear")}
        </BusyButton>
      </div>
      <p className="dk-hint">{t("desktop.curves.saveHint", { slot })}</p>
      <SlotReadError error={error} retry={saved === null ? retry : null} />
    </section>
  );
}

// The curve (solid) against a straight line (dashed), with the custom points
// as squares (the selected one larger, with a ring) and the live stick as a
// circle with crosshair lines: shapes and dashes carry the meaning, not color.
function CurveGraph({ curve, live, onPoints }: { curve: StickCurve; live: [number, number] | null; onPoints?: (p: StickCurve["points"]) => void }) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Custom points are dragged only where they can be saved (not into a game's profile yet).
  const custom = curve.type === "custom" && !!onPoints;

  // 65 points: drawn once per curve, not on every live input frame.
  const path = useMemo(() => {
    const steps = 64;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const x = i / steps;
      return `${i ? "L" : "M"}${px(x).toFixed(1)},${py(curveAt(curve, x)).toFixed(1)}`;
    }).join("");
  }, [curve]);

  const toPoint = (e: PointerEvent): [number, number] | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const scale = (SIZE + 2 * PAD) / box.width;
    const x = ((e.clientX - box.left) * scale - PAD) / SIZE;
    const y = 1 - ((e.clientY - box.top) * scale - PAD) / SIZE;
    return [x * 255, y * 255];
  };
  const move = (i: number, x: number, y: number) => onPoints?.(movePoint(curve.points, i, x, y));
  const onKey = (i: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const [x, y] = curve.points[i];
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    move(i, x + delta[0], y + delta[1]);
  };

  return (
    <div className="curve-graph">
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE + 2 * PAD} ${SIZE + 2 * PAD}`}
        role="group"
        aria-label={t("desktop.curves.graph")}
        onPointerMove={(e) => {
          if (dragging === null) return;
          const p = toPoint(e);
          if (p) move(dragging, p[0], p[1]);
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <rect x={PAD} y={PAD} width={SIZE} height={SIZE} className="curve-frame" />
        {/* loop: HOT-PATH-OK — N = 3 grid lines per render */}
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g}>
            <line x1={px(g)} y1={py(0)} x2={px(g)} y2={py(1)} className="curve-grid" />
            <line x1={px(0)} y1={py(g)} x2={px(1)} y2={py(g)} className="curve-grid" />
          </g>
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="curve-ref" />
        <path d={path} className="curve-line" />
        {live && (
          <g className="curve-live" aria-hidden="true">
            <line x1={px(live[0])} y1={py(0)} x2={px(live[0])} y2={py(live[1])} />
            <line x1={px(0)} y1={py(live[1])} x2={px(live[0])} y2={py(live[1])} />
            <circle cx={px(live[0])} cy={py(live[1])} r="4" />
          </g>
        )}
        {custom &&
          // loop: HOT-PATH-OK — N ≤ 4 curve points per render
          curve.points.map(([x, y], i) => {
            const on = selected === i;
            const r = on ? 6 : 4.5;
            return (
              <g key={i}>
                {on && <circle cx={px(x / 255)} cy={py(y / 255)} r={r + 3.5} className="curve-ring" />}
                <rect
                  x={px(x / 255) - r}
                  y={py(y / 255) - r}
                  width={2 * r}
                  height={2 * r}
                  className={`curve-point${on ? " on" : ""}`}
                  tabIndex={0}
                  role="slider"
                  aria-label={t("desktop.curves.point", { n: i + 1 })}
                  aria-valuetext={t("desktop.curves.pointValue", { x: Math.round((x / 255) * 100), y: Math.round((y / 255) * 100) })}
                  aria-valuenow={y}
                  aria-valuemin={0}
                  aria-valuemax={255}
                  onFocus={() => setSelected(i)}
                  onKeyDown={onKey(i)}
                  onPointerDown={(e) => {
                    e.currentTarget.focus();
                    setSelected(i);
                    setDragging(i);
                    svg.current?.setPointerCapture(e.pointerId);
                  }}
                />
              </g>
            );
          })}
      </svg>
      <p className="curve-axes dk-hint">
        <span>{t("desktop.curves.axisIn")}</span>
        <span>{t("desktop.curves.axisOut")}</span>
      </p>
      <p className="curve-key dk-hint">
        <svg viewBox="0 0 20 6" className="stest-key" aria-hidden="true">
          <line x1="0" y1="3" x2="20" y2="3" className="curve-ref" />
        </svg>
        {t("desktop.curves.keyLinear")}{" "}
        {live && (
          <>
            <svg viewBox="0 0 10 10" className="curve-key-dot" aria-hidden="true">
              <circle cx="5" cy="5" r="3.5" className="curve-live-dot" />
            </svg>
            {t("desktop.curves.keyLive")}
          </>
        )}
      </p>
    </div>
  );
}

// The curves panel while a game's profile is on: per stick, the normal
// (saved) curve or a preset for this game, saved into the profile and felt
// right away. Custom points per game aren't edited here (a later step).
function GameStickCurves({
  title,
  saved,
  draft,
  onDraft,
  side,
  onSide,
  input,
  sticks,
  stored,
  onSave,
}: {
  title: string;
  saved: StickCurvePair | null;
  draft: GameCurves;
  onDraft: (d: GameCurves) => void;
  side: 0 | 1;
  onSide: (s: 0 | 1) => void;
  input: InputReport | null;
  sticks: readonly [StickCal, StickCal];
  stored: GameCurves;
  onSave: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const own = draft[side];
  const curve = own ?? saved?.[side] ?? LINEAR_CURVE;
  // "normal" first, then the presets (and custom only when the profile already has one).
  const choices: Array<"normal" | CurveType> = ["normal", ...CURVE_PRESETS, ...(own?.type === "custom" ? (["custom"] as const) : [])];
  const pick = (choice: "normal" | CurveType) => {
    const next: StickCurve | undefined = choice === "normal" ? undefined : { type: choice, points: (own ?? saved?.[side] ?? LINEAR_CURVE).points };
    onDraft(side === 0 ? [next, draft[1]] : [draft[0], next]);
  };
  const changed = !sameGameCurves(draft, stored);
  const tilt = stickTilt(input, side, sticks[side], curve);
  return (
    <section className="dk-card">
      <h2>{t("desktop.curves.title")}</h2>
      <div className="dk-notice">{t("desktop.editing.curvesNote", { title })}</div>
      <div className="dk-seg curve-tabs" role="tablist" aria-label={t("desktop.curves.title")}>
        {/* loop: HOT-PATH-OK — N = 2 tabs per render */}
        {SIDES.map((s, i) => (
          <button type="button" role="tab" key={s} className={side === i ? "on" : ""} aria-selected={side === i} onClick={() => onSide(i as 0 | 1)}>
            {t(`desktop.calib.${s}Stick`)}
          </button>
        ))}
      </div>
      <Segmented
        label={t("desktop.curves.curve")}
        value={choices.indexOf(own ? own.type : "normal")}
        /* loop: HOT-PATH-OK — N ≤ 7 curve choices per render */
        options={choices.map((c, i) => ({
          value: i,
          label: c === "normal" ? t("desktop.curves.profileSaved") : t(`desktop.curves.type.${c}`),
          title: c === "normal" ? undefined : t(`desktop.curves.typeHint.${c}`),
        }))}
        onChange={(i) => pick(choices[i])}
      />
      <p className="dk-hint">{own ? t(`desktop.curves.typeHint.${own.type}`) : t("desktop.editing.curvesNormal")}</p>
      <CurveGraph curve={curve} live={tilt} />
      <p className="dk-mono curve-now">{tilt ? t("desktop.curves.now", { in: Math.round(tilt[0] * 100), out: Math.round(tilt[1] * 100) }) : t("desktop.calib.needsController")}</p>
      <div className="dk-row-btns">
        <BusyButton className="dk-btn primary" disabled={!changed} onClick={onSave}>
          {t("desktop.bar.saveProfile")}
        </BusyButton>
        <button type="button" className="dk-btn" disabled={!changed} onClick={() => onDraft(stored)}>
          {t("desktop.calib.revert")}
        </button>
      </div>
    </section>
  );
}
