// Tension (protocol 1.23): your own adaptive trigger effects, run by the
// board: the Controller page's Sets section (which set, its name, Feel it)
// and the Adaptive triggers section (its two triggers). A set holds L2
// and R2 together; each trigger is left to the game, filled in (ours only
// while the game sends nothing on it) or replaced (always ours), with up to 4
// stages that switch effects by pull position and hold time. Edits are staged
// drafts saved by the one save bar (tensionDraft.ts, page rule 4); Feel it
// runs the set being edited, unsaved, until it's stopped or the section closes.
//
// The picture (TensionPicture) is a static SVG drawn only when the set
// changes: 0 frames per second while shown and idle, nothing while hidden,
// the same on the CPU fallback (no animation, no canvas).
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import {
  cleanName,
  copySet,
  EFFECTS,
  effectSpec,
  fixStage,
  newStage,
  paramRange,
  programPicture,
  rampable,
  sameTensionStatus,
  stageValid,
  STARTER_KEYS,
  STARTERS,
  TENSION_SLOTS,
  TENSION_STAGES,
  withZoneLevel,
  zoneLevel,
  type TensionProgram,
  type TensionSet,
  type TensionStage,
  type TensionStatus,
} from "../../protocol/tension";
import { logged } from "../../errorText";
import { Row, Segmented, Slider, BusyButton } from "../controls";
import { SectionGroup } from "../accordion/Section";
import Notice from "../Notice";
import { useNoticeTasks } from "../notices";
import { usePoll } from "../usePoll";
import { useBoardDrafts } from "./boardDrafts";
import { tensionErrorText } from "./tensionDraft";

type T = ReturnType<typeof useTranslation>["t"];
const pct = (raw: number) => Math.round((raw * 100) / 255);
const raw = (percent: number) => Math.round((percent * 255) / 100);
// A set's name in the lists: "0 · Bow" (slots 0–7, like the OLED's zero-based names).
const slotLabel = (t: T, slot: number, set: TensionSet | null) => t("desktop.tension.slot", { slot, name: set ? set.name : t("desktop.tension.empty") });

// Protocol 1.24 (the firmware's docs/TENSION_BUTTONS.md §7.1, approved by the
// owner 2026-11-15): a set is triggers and buttons, so its own controls are a
// Sets section first in the panel (Runs, Editing, Name, Feel it, the starters,
// Delete last); Adaptive triggers keeps the edited set's L2 / R2 programs
// (TensionSection) and Button assignments its buttons (SetButtons.tsx).

// The Sets section's body.
export function SetsSection({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const { tension: tn } = useBoardDrafts();
  const [error, setError] = useState<string | null>(null);
  const { load } = tn;
  // lifetime: OK — acquires nothing (reads the board's sets once per connection; the read is the draft's)
  useEffect(() => load(), [load]);
  if (!bridge.identity || !tn.supported) return null;
  const shownError = tn.error ?? error;
  const header = shownError && (
    <Notice
      error
      // The board's read or save error stays until Read again or the next Save; Feel it's can be dismissed.
      onDismiss={tn.error ? undefined : () => setError(null)}
      action={
        !tn.loaded ? (
          <BusyButton className="dk-btn" onClick={tn.retry}>
            {t("desktop.tension.retry")}
          </BusyButton>
        ) : undefined
      }
    >
      {shownError}
    </Notice>
  );
  if (!tn.loaded)
    return (
      <>
        {header}
        {!shownError && <p className="dk-hint">{t("desktop.tension.reading")}</p>}
      </>
    );
  if (tn.readOnly)
    return (
      <>
        {header}
        {/* hint: MUST-SHOW — why the sets can't be changed here (a newer firmware's sets are kept safe) */}
        <p className="dk-hint">{t("desktop.tension.readOnly")}</p>
      </>
    );
  const editing = tn.editing;
  const set = editing === null ? null : tn.sets[editing];
  // loop: HOT-PATH-OK — N = 8 slots per render of the section
  const used = tn.sets.map((s, i) => [i, s] as const).filter(([, s]) => s);
  return (
    <>
      {header}
      {used.length > 0 && (
        <Row label={t("desktop.tension.runs")} info={t("desktop.tension.runsInfo")}>
          <select className="dk-select" value={tn.choice ?? ""} onChange={(e) => tn.choose(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">{t("desktop.tension.none")}</option>
            {/* loop: HOT-PATH-OK — N ≤ 8 saved sets */}
            {used.map(([i, s]) => (
              <option key={i} value={i}>
                {slotLabel(t, i, s)}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t("desktop.tension.edit")} info={t(tn.buttons ? "desktop.sets.info" : "desktop.tension.info")}>
        <select className="dk-select" value={editing ?? ""} onChange={(e) => tn.setEditing(e.target.value === "" ? null : Number(e.target.value))}>
          {tn.buttons && <option value="">{t("desktop.sets.without")}</option>}
          {/* loop: HOT-PATH-OK — N = 8 slots */}
          {Array.from({ length: TENSION_SLOTS }, (_, i) => (
            <option key={i} value={i}>
              {slotLabel(t, i, tn.sets[i])}
              {tn.changed(i) ? " •" : ""}
            </option>
          ))}
        </select>
      </Row>
      {editing !== null &&
        (set ? (
          <SetEditor key={editing} bridge={bridge} set={set} onChange={(next) => tn.edit(editing, next)} onDelete={() => tn.edit(editing, null)} onError={setError} />
        ) : (
          <>
            <p className="dk-hint">{t("desktop.tension.startFrom")}</p>
            <div className="dk-row-btns">
              {/* loop: HOT-PATH-OK — N = 5 starter sets */}
              {STARTER_KEYS.map((k) => (
                <button key={k} type="button" className="dk-btn" onClick={() => tn.edit(editing, copySet(STARTERS[k]))}>
                  {t(`desktop.tension.starters.${k}`)}
                </button>
              ))}
            </div>
          </>
        ))}
    </>
  );
}

// The Sets section's status: which set runs from power-on.
export function setsStatus(t: T, tn: { loaded: boolean; choice: number | null; sets: (TensionSet | null)[] }): string {
  if (!tn.loaded) return t("desktop.tension.reading");
  const set = tn.choice === null ? null : tn.sets[tn.choice];
  return t("desktop.sets.status", { name: set ? set.name : t("desktop.tension.none") });
}

// Adaptive triggers' Tension group: the edited set's two triggers side by side.
export function TensionSection({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const { tension: tn } = useBoardDrafts();
  const { goTo } = useNoticeTasks();
  const { load } = tn;
  // lifetime: OK — acquires nothing (reads the board's sets once per connection; the read is the draft's)
  useEffect(() => load(), [load]);

  if (!bridge.identity) return null;
  if (!tn.supported)
    return (
      <SectionGroup title={t("desktop.tension.title")}>
        {/* hint: MUST-SHOW — why Tension isn't here: the firmware to update, with the link to it (page rules 7 and 9) */}
        <p className="dk-hint">{t("desktop.tension.needsFirmware")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn" onClick={() => goTo("dongle", "firmware")}>
            {t("desktop.settings2.firmwareLink")}
          </button>
        </div>
      </SectionGroup>
    );
  // Reading, a read error or a newer store: the Sets section says so (one fact, one place).
  if (!tn.loaded || tn.readOnly) return null;
  const editing = tn.editing;
  const set = editing === null ? null : tn.sets[editing];
  if (editing === null || !set)
    return (
      <SectionGroup title={t("desktop.tension.title")} info={t("desktop.tension.info")}>
        <p className="dk-hint">{t("desktop.sets.editInSets")}</p>
      </SectionGroup>
    );
  return (
    <SectionGroup title={t("desktop.tension.title")} info={t("desktop.tension.info")}>
      <div className="tn-pair">
        <TriggerEditor label="L2" program={set.l2} onChange={(l2) => tn.edit(editing, { ...set, l2 })} />
        <TriggerEditor label="R2" program={set.r2} onChange={(r2) => tn.edit(editing, { ...set, r2 })} />
      </div>
    </SectionGroup>
  );
}

// The edited set's own controls (the Sets section): Name, Feel it, Delete
// (last). Feel it runs the whole set, triggers and (from 1.24) buttons.
function SetEditor({
  bridge,
  set,
  onChange,
  onDelete,
  onError,
}: {
  bridge: UseDs5BridgeResult;
  set: TensionSet;
  onChange: (s: TensionSet) => void;
  onDelete: () => void;
  onError: (e: string | null) => void;
}) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [feeling, setFeeling] = useState(false);
  // Feel it follows the edits (debounced), and stops when the editor goes
  // (the section folds, another set is picked, the page changes).
  // lifetime: OK — cleanup: clears the debounce timer (next edit / Feel it off / unmount)
  useEffect(() => {
    if (!feeling || !client) return;
    // lifetime: OK — cleared in the cleanup
    const timer = setTimeout(() => {
      onError(null);
      // error: SHOWN — desktop.tension.errors.invalid and the board's keyed errors (tensionErrorText) in the section's error line
      client.feelTension(set).catch((cause: unknown) => {
        setFeeling(false);
        onError(tensionErrorText(cause));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [feeling, client, set, onError]);
  // lifetime: OK — acquires nothing; the cleanup stops Feel it on the board (unmount / board change)
  useEffect(
    () => () => {
      // error: LOGGED-OK — leaving the editor; a failed stop leaves the unsaved set running until the board restarts or Feel it is used again
      if (client && feeling) client.feelTension(null).catch(logged("stopping Feel it on leaving the editor"));
    },
    [client, feeling],
  );
  return (
    <>
      <Row label={t("desktop.tension.name")} sub={t("desktop.tension.nameSub")} invalid={!set.name}>
        <input
          className="dk-input tn-name"
          type="text"
          maxLength={16}
          value={set.name}
          aria-label={t("desktop.tension.name")}
          onChange={(e) => onChange({ ...set, name: cleanName(e.target.value) })}
        />
      </Row>
      <div className="dk-row-btns">
        <button type="button" className={`dk-btn${feeling ? " on" : ""}`} aria-pressed={feeling} title={t("desktop.tension.feelHint")} onClick={() => setFeeling((f) => !f)}>
          {feeling ? t("desktop.tension.feelStop") : t("desktop.tension.feel")}
        </button>
        <button type="button" className="dk-btn danger" onClick={onDelete}>
          {t("desktop.tension.delete")}
        </button>
      </div>
    </>
  );
}

type Use = "game" | "fill" | "replace";

function TriggerEditor({ label, program, onChange }: { label: string; program: TensionProgram; onChange: (p: TensionProgram) => void }) {
  const { t } = useTranslation();
  const use: Use = program.stages.length === 0 ? "game" : program.policy;
  const setUse = (u: Use) => {
    if (u === "game") onChange({ ...program, stages: [] });
    else onChange({ policy: u, stages: program.stages.length ? program.stages : [newStage(1)] });
  };
  const setStage = (i: number, s: TensionStage | null) => {
    const stages = [...program.stages];
    if (s) stages[i] = fixStage(s);
    else stages.splice(i, 1);
    onChange({ ...program, stages });
  };
  const move = (i: number, by: number) => {
    const stages = [...program.stages];
    [stages[i], stages[i + by]] = [stages[i + by], stages[i]];
    onChange({ ...program, stages });
  };
  return (
    <div className="tn-trigger">
      <Segmented
        label={label}
        info={t("desktop.tension.useInfo")}
        value={use}
        options={[
          { value: "game", label: t("desktop.tension.use.game") },
          { value: "fill", label: t("desktop.tension.use.fill") },
          { value: "replace", label: t("desktop.tension.use.replace") },
        ]}
        onChange={setUse}
      />
      {use !== "game" && (
        <>
          <TensionPicture program={program} label={label} />
          {/* loop: HOT-PATH-OK — N ≤ 4 stages */}
          {program.stages.map((s, i) => (
            <StageEditor key={i} index={i} stage={s} count={program.stages.length} onChange={(next) => setStage(i, next)} onMove={(by) => move(i, by)} onRemove={() => setStage(i, null)} />
          ))}
          {program.stages.length < TENSION_STAGES && (
            <div className="dk-row-btns">
              <button type="button" className="dk-btn" onClick={() => onChange({ ...program, stages: [...program.stages, newStage(1)] })}>
                {t("desktop.tension.addStage")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const effectLabel = (t: T, mode: number) => {
  const spec = effectSpec(mode);
  if (!spec) return `${mode}`;
  const name = t(`desktop.tension.effects.${spec.key}`);
  return spec.official ? name : t("desktop.tension.unofficialName", { name });
};

function StageEditor({
  index,
  stage,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  stage: TensionStage;
  count: number;
  onChange: (s: TensionStage) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const spec = effectSpec(stage.mode)!;
  const param = (i: number, v: number) => onChange({ ...stage, p: stage.p.map((x, k) => (k === i ? v : x)) });
  const paramName = (i: number) => t(`desktop.tension.params.${spec.params[i].key}`);
  const ramp = stage.ramp;
  // loop: HOT-PATH-OK — N ≤ 6 parameters
  const rampParams = spec.params.map((_, i) => i).filter((i) => rampable(stage.mode, i));
  // Another effect keeps the stage's pull window and hold time.
  const pickEffect = (mode: number) => onChange({ ...newStage(mode), pullMin: stage.pullMin, pullMax: stage.pullMax, holdTenths: stage.holdTenths });
  // The window's ends: moving one past the other takes it along.
  const setFrom = (v: number) => onChange({ ...stage, pullMin: raw(v), pullMax: Math.max(stage.pullMax, raw(v)) });
  const setTo = (v: number) => onChange({ ...stage, pullMax: raw(v), pullMin: Math.min(stage.pullMin, raw(v)) });
  // A ramp starts at the parameter's own value and keeps how it builds.
  const pickRamp = (value: string) => {
    if (value === "") return onChange({ ...stage, ramp: null });
    const param = Number(value);
    const to = stage.p[param];
    onChange({ ...stage, ramp: ramp?.by === "hold" ? { param, to, by: "hold", tenths: ramp.tenths } : { param, to, by: "pull" } });
  };
  return (
    <div className="tn-stage">
      <div className="tn-stage-head">
        <strong>{t("desktop.tension.stage", { n: index })}</strong>
        <span className="dk-spacer" />
        {index > 0 && (
          <button type="button" className="dk-btn tn-icon" aria-label={t("desktop.tension.moveUp")} title={t("desktop.tension.moveUp")} onClick={() => onMove(-1)}>
            <ArrowUp size={12} aria-hidden="true" />
          </button>
        )}
        {index < count - 1 && (
          <button type="button" className="dk-btn tn-icon" aria-label={t("desktop.tension.moveDown")} title={t("desktop.tension.moveDown")} onClick={() => onMove(1)}>
            <ArrowDown size={13} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="dk-btn tn-icon" aria-label={t("desktop.tension.removeStage")} title={t("desktop.tension.removeStage")} onClick={onRemove}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <Row label={t("desktop.tension.effect")} info={spec.official ? undefined : t("desktop.tension.unofficialInfo")}>
        <select className="dk-select" value={stage.mode} onChange={(e) => pickEffect(Number(e.target.value))}>
          {/* loop: HOT-PATH-OK — N = 10 effects */}
          {EFFECTS.map((e) => (
            <option key={e.id} value={e.id}>
              {effectLabel(t, e.id)}
            </option>
          ))}
        </select>
      </Row>
      {/* loop: HOT-PATH-OK — N ≤ 6 parameters */}
      {spec.params.map((ps, i) => {
        const [min, max] = paramRange(stage.mode, i, stage.p);
        const seconds = ps.key === "period";
        return (
          <Slider
            key={ps.key}
            label={paramName(i)}
            value={seconds ? stage.p[i] / 10 : stage.p[i]}
            min={seconds ? min / 10 : min}
            max={seconds ? max / 10 : max}
            step={seconds ? 0.1 : 1}
            digits={seconds ? 1 : 0}
            unit={ps.key === "frequency" ? "Hz" : seconds ? "s" : undefined}
            info={/strength|amplitude/i.test(ps.key) ? t("desktop.tension.levelsInfo") : ps.key === "start" && spec.key === "weapon" ? t("desktop.tension.weaponInfo") : undefined}
            onChange={(v) => param(i, seconds ? Math.round(v * 10) : v)}
          />
        );
      })}
      {spec.zonesAt !== undefined && <Zones p={stage.p} at={spec.zonesAt} onChange={(p) => onChange({ ...stage, p })} />}
      <Slider label={t("desktop.tension.pullFrom")} value={pct(stage.pullMin)} min={0} max={100} step={1} unit="%" onChange={setFrom} />
      <Slider label={t("desktop.tension.pullTo")} value={pct(stage.pullMax)} min={0} max={100} step={1} unit="%" onChange={setTo} />
      <Slider
        label={t("desktop.tension.hold")}
        info={t("desktop.tension.holdInfo")}
        value={stage.holdTenths / 10}
        min={0}
        max={25.5}
        step={0.1}
        digits={1}
        unit="s"
        onChange={(v) => onChange({ ...stage, holdTenths: Math.round(v * 10) })}
      />
      {rampParams.length > 0 && (
        <Row label={t("desktop.tension.ramp")} info={t("desktop.tension.rampInfo")}>
          <select className="dk-select" value={ramp ? ramp.param : ""} onChange={(e) => pickRamp(e.target.value)}>
            <option value="">{t("desktop.tension.noRamp")}</option>
            {/* loop: HOT-PATH-OK — N ≤ 6 parameters */}
            {rampParams.map((i) => (
              <option key={i} value={i}>
                {paramName(i)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {ramp && (
        <>
          <Segmented
            label={t("desktop.tension.rampBy")}
            value={ramp.by}
            options={[
              { value: "pull", label: t("desktop.tension.byPull") },
              { value: "hold", label: t("desktop.tension.byHold") },
            ]}
            onChange={(by) => onChange({ ...stage, ramp: by === "hold" ? { param: ramp.param, to: ramp.to, by, tenths: 10 } : { param: ramp.param, to: ramp.to, by } })}
          />
          {(() => {
            const [min, max] = paramRange(stage.mode, ramp.param, stage.p, true);
            return <Slider label={t("desktop.tension.rampTo")} value={ramp.to} min={min} max={max} step={1} onChange={(to) => onChange({ ...stage, ramp: { ...ramp, to } })} />;
          })()}
          {ramp.by === "hold" && (
            <Slider
              label={t("desktop.tension.rampOver")}
              value={ramp.tenths / 10}
              min={0.1}
              max={25.5}
              step={0.1}
              digits={1}
              unit="s"
              onChange={(v) => onChange({ ...stage, ramp: { ...ramp, tenths: Math.max(1, Math.round(v * 10)) } })}
            />
          )}
        </>
      )}
      {!stageValid(stage) && <p className="dk-hint invalid">{t("desktop.tension.rampNeedsWindow")}</p>}
    </div>
  );
}

// The ten zones of a Multiple Position effect, one level 0..8 each.
function Zones({ p, at, onChange }: { p: number[]; at: number; onChange: (p: number[]) => void }) {
  const { t } = useTranslation();
  return (
    <Row label={t("desktop.tension.zones")} info={t("desktop.tension.zonesInfo")} stack>
      <div className="tn-zones">
        {/* loop: HOT-PATH-OK — N = 10 zones */}
        {Array.from({ length: 10 }, (_, z) => (
          <input
            key={z}
            className="dk-input"
            type="number"
            min={0}
            max={8}
            value={zoneLevel(p, at, z)}
            aria-label={t("desktop.tension.zone", { n: z })}
            onChange={(e) => onChange(withZoneLevel(p, at, z, Math.min(8, Math.max(0, Math.round(Number(e.target.value) || 0)))))}
          />
        ))}
      </div>
    </Row>
  );
}

// What a trigger's program feels like over the pull: per stage its level
// (strength or amplitude, 0..8) across its pull window. Solid = resistance,
// the accent colour; vibration in the warning colour; dashed = runs only after
// its hold time; a thin dashed line = where a ramp by hold ends. Where an
// earlier stage takes the pull first, the stage is cut short (a gap, said
// below). Drawn when the program changes (memo), never per frame.
const W = 200;
const H = 56;
const x = (pull: number) => ((pull / 255) * W).toFixed(1);
const y = (level: number) => (H - 2 - (level / 8) * (H - 6)).toFixed(1);
const paths = (points: Array<[number, number] | null>) => {
  let d = "";
  let pen = false;
  // loop: NOT-WORTH — ≤ 65 points per stage, when the program changes (memo)
  for (const pt of points) {
    if (!pt) pen = false;
    else {
      d += `${pen ? "L" : "M"}${x(pt[0])} ${y(pt[1])} `;
      pen = true;
    }
  }
  return d.trim();
};

export const TensionPicture = memo(function TensionPicture({ program, label }: { program: TensionProgram; label: string }) {
  const { t } = useTranslation();
  const pics = useMemo(() => programPicture(program), [program]);
  // loop: NOT-WORTH — N ≤ 4 stages, when the program changes (memo)
  const notes = pics.filter((p) => p.cutShort || p.never).map((p) => t(p.never ? "desktop.tension.neverRuns" : "desktop.tension.cutShort", { n: p.stage }));
  return (
    <figure className="tn-picture">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("desktop.tension.pictureLabel", { trigger: label })}>
        <line className="tn-axis" x1="0" y1={H - 2} x2={W} y2={H - 2} />
        {/* loop: NOT-WORTH — N ≤ 4 stages, when the program changes (memo) */}
        {pics.map((p) => (
          <g key={p.stage} className={`tn-${p.kind}${p.waits ? " tn-wait" : ""}`}>
            <path d={paths(p.points)} />
            {p.holdEnd && <path className="tn-ramp-end" d={paths(p.holdEnd)} />}
          </g>
        ))}
      </svg>
      <figcaption className="dk-hint">{notes.length ? notes.join(" · ") : t("desktop.tension.pictureCaption")}</figcaption>
    </figure>
  );
});

// The live meter (page rule 5, exception Q2): what runs on each trigger now,
// from the board's 0xE9 status, read 10 times a second while the section is
// open and the window shown (usePoll pauses while hidden); an unchanged
// reading keeps the last object, so nothing re-renders.
export function TensionLive({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const { tension: tn } = useBoardDrafts();
  const client = bridge.client;
  // cache: OK — key=none (the last status read); invalidated=every poll (replaced when it differs); bound=1 entry
  const last = useRef<TensionStatus | null>(null);
  // lifetime: OK — usePoll stops on unmount (section folded) and while hidden
  const { value: status, error } = usePoll(
    async () => {
      const next = await client!.readTensionStatus();
      if (!sameTensionStatus(last.current, next)) last.current = next;
      return last.current;
    },
    100,
    tn.supported && !!client,
  );
  if (!tn.supported) return null;
  const runningName = status && status.choiceNow !== null ? (tn.sets[status.choiceNow]?.name ?? t("desktop.tension.slot", { slot: status.choiceNow, name: "" })) : null;
  const line = !status
    ? null
    : status.paused
      ? t("desktop.tension.livePaused")
      : status.feelIt
        ? t("desktop.tension.liveFeel")
        : runningName
          ? t(status.temporary ? "desktop.tension.liveGame" : "desktop.tension.liveSet", { name: runningName })
          : t("desktop.tension.liveNone");
  return (
    <SectionGroup title={t("desktop.tension.liveTitle")}>
      {error && <p className="dk-hint invalid">{error}</p>}
      {line && <p className="dk-hint">{line}</p>}
      {status?.running &&
        !status.paused &&
        // loop: HOT-PATH-OK — N = 2 triggers per status poll
        status.triggers.map((tr, i) => (
          <p key={i} className="dk-mono">
            {i === 0 ? "L2" : "R2"} · {t(`desktop.tension.owner.${tr.owner}`)}
            {tr.owner === "tension" && tr.stage !== null ? ` · ${t("desktop.tension.stage", { n: tr.stage })} · ${(tr.heldTenths / 10).toFixed(1)} s` : ""} · {pct(tr.pull)}%
          </p>
        ))}
    </SectionGroup>
  );
}
