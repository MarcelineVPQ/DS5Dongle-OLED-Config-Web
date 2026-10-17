// Stick response curves (protocol 1.10) in Sticks & calibration: a preset or
// a custom curve per stick, saved in the dongle per pairing slot (by the save
// bar: the draft is the app's one, boardDrafts.tsx) and applied after
// calibration to what every game receives. The graph shows the curve
// against a dashed straight line, the custom points (drag them, or select one
// and use the arrow keys) and a live dot where the stick is now: its tilt in
// (after the calibration above) and what the dongle sends out.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { correctStick, type StickCal } from "../../protocol/calibration";
import { SectionGroup } from "../accordion/Section";
import { useLibrary, useProfileTarget } from "../library/libraryContext";
import { profileCurves, type GameCurves } from "../library/profileValues";
import { CURVE_PRESETS, CURVE_TYPES, LINEAR_CURVE, applyCurve, curveAt, movePoint, tiltOf, type CurveType, type StickCurve, type StickCurvePair } from "../../protocol/stickCurve";
import { Segmented } from "../controls";
import { SlotReadError } from "./slotSettings";
import { useBoardDrafts } from "./boardDrafts";
import Notice from "../Notice";

export { supportsStickCurves } from "./boardDrafts";

const SIDES = ["left", "right"] as const;
const SIZE = 160; // graph size in SVG units (0..1 mapped onto it)
const PAD = 8;
const px = (v: number) => PAD + v * SIZE;
const py = (v: number) => PAD + (1 - v) * SIZE;

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
  const { supported, saved, draft, setDraft, error, retry } = useBoardDrafts().curves;
  const [side, setSide] = useState<0 | 1>(0);
  // A game's profile on (edited, or its game running): the curves picked here
  // go into that profile (undefined = that stick keeps the normal curve) and
  // the profile hook puts them on the dongle for now (RAM only). The draft is
  // the profile's (kept when this panel closes), saved with the bar's "Save to profile".
  const { library, curvesDraft, setCurvesDraft } = useLibrary();
  const target = useProfileTarget();
  const profile = target ? library.games[target.gameKey]?.profile : undefined;
  const stored = profileCurves(profile?.settings);

  if (!client) return null;
  if (!supported) {
    return (
      <SectionGroup title={t("desktop.curves.title")}>
        <p className="dk-hint">{t("desktop.curves.needsFirmware")}</p>
      </SectionGroup>
    );
  }

  if (profile && target)
    return <GameStickCurves title={target.title} saved={saved} draft={curvesDraft ?? stored} onDraft={setCurvesDraft} side={side} onSide={setSide} input={input} sticks={sticks} />;

  const curve = draft[side];
  const setCurve = (c: StickCurve) => setDraft((d) => (side === 0 ? [c, d[1]] : [d[0], c]));

  const tilt = stickTilt(input, side, sticks[side], curve);

  return (
    <SectionGroup title={t("desktop.curves.title")} info={t("desktop.curves.intro")}>
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
      {/* hint: MUST-SHOW — how to move the points, keyboard included: needed before you can edit */}
      {curve.type === "custom" && <p className="dk-hint">{t("desktop.curves.customHint")}</p>}
      <p className="dk-mono curve-now">{tilt ? t("desktop.curves.now", { in: Math.round(tilt[0] * 100), out: Math.round(tilt[1] * 100) }) : t("desktop.calib.needsController")}</p>
      {/* hint: MUST-SHOW — a warning: saving ends a game's curves */}
      {bridge.identity?.curvesTemporary && <p className="dk-hint">{t("desktop.curves.gameOn")}</p>}
      <div className="dk-row-btns">
        {/* Both sticks back to Linear: a change like any other, kept by the save bar. */}
        <button
          type="button"
          className="dk-btn"
          /* loop: HOT-PATH-OK — N = 2 sticks per render */
          disabled={draft.every((c) => c.type === "linear")}
          onClick={() =>
            setDraft([
              { ...LINEAR_CURVE, points: draft[0].points },
              { ...LINEAR_CURVE, points: draft[1].points },
            ])
          }
        >
          {t("desktop.curves.resetLinear")}
        </button>
      </div>
      <SlotReadError error={error} retry={saved === null ? retry : null} />
    </SectionGroup>
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
// (saved) curve or a preset for this game, saved into the profile by the
// bar's Save to profile and felt from then on. Custom points per game aren't
// edited here (a later step).
function GameStickCurves({
  title,
  saved,
  draft,
  onDraft,
  side,
  onSide,
  input,
  sticks,
}: {
  title: string;
  saved: StickCurvePair | null;
  draft: GameCurves;
  onDraft: (d: GameCurves) => void;
  side: 0 | 1;
  onSide: (s: 0 | 1) => void;
  input: InputReport | null;
  sticks: readonly [StickCal, StickCal];
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
  const tilt = stickTilt(input, side, sticks[side], curve);
  return (
    <SectionGroup title={t("desktop.curves.title")}>
      <Notice closable>{t("desktop.editing.curvesNote", { title })}</Notice>
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
    </SectionGroup>
  );
}
