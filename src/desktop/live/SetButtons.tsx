// Button assignments for a Tension set (protocol 1.24, build step 2: Press
// only; the firmware's docs/TENSION_BUTTONS.md §7.2-§7.5, §7.11). Button
// assignments stays the one place for buttons: with a set being edited it
// edits that set's buttons, with Without a set today's list (the legacy
// table, PartPanel's AllButtonsList). Every change is a draft of the set
// (tensionDraft.ts) the one save bar writes (page rule 4).
//
// Idle cost: none. The section is static controls; the target picker is a
// top-layer popover with listeners only while open; the drawing's badges
// (LiveController) are a static SVG overlay drawn when the layout changes.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  basePress,
  buttonTarget,
  changedSources,
  CONTROLLER_TARGETS,
  DISABLE,
  EDGE_SOURCES,
  emptyButtonPart,
  partFromLegacy,
  pressWarnings,
  SOURCE,
  SOURCE_COUNT,
  sameTarget,
  swapBase,
  TARGET_KIND,
  withBasePress,
  type ButtonPart,
  type Target,
} from "../../protocol/buttons";
import type { TensionSet } from "../../protocol/tension";
import { Row } from "../controls";
import { SectionGroup } from "../accordion/Section";
import { useTopLayer } from "../topLayer";
import { useNoticeTasks } from "../notices";
import type { PartId } from "./parts";
import type { Remap } from "./useRemap";
import type { TensionDraft } from "./tensionDraft";

type T = ReturnType<typeof useTranslation>["t"];

// Each source's part on the drawing (TENSION_BUTTONS.md §3.3 order).
export const SOURCE_PART: readonly PartId[] = [
  "l2",
  "l1",
  "create",
  "dpad-up",
  "dpad-left",
  "dpad-down",
  "dpad-right",
  "stick-l",
  "r2",
  "r1",
  "options",
  "triangle",
  "circle",
  "cross",
  "square",
  "stick-r",
  "touchpad",
  "ps",
  "fn-l",
  "fn-r",
  "paddle-l",
  "paddle-r",
];
// loop: NOT-WORTH — N = 22 sources, once at load
export const PART_SOURCE: ReadonlyMap<PartId, number> = new Map(SOURCE_PART.map((p, s) => [p, s]));

export const sourceName = (t: T, source: number) => t(`desktop.live.part.${SOURCE_PART[source]}`);
export const targetName = (t: T, target: Target) => (target.kind === TARGET_KIND.button ? sourceName(t, target.a) : t("remap.disabled"));

// The short job on a badge and in the picker: Sony's glyphs, L1…, arrows for the directional buttons.
const SHORT: Record<number, string> = {
  [SOURCE.l2]: "L2",
  [SOURCE.l1]: "L1",
  [SOURCE.up]: "↑",
  [SOURCE.left]: "←",
  [SOURCE.down]: "↓",
  [SOURCE.right]: "→",
  [SOURCE.l3]: "L3",
  [SOURCE.r2]: "R2",
  [SOURCE.r1]: "R1",
  [SOURCE.triangle]: "△",
  [SOURCE.circle]: "○",
  [SOURCE.cross]: "✕",
  [SOURCE.square]: "□",
  [SOURCE.r3]: "R3",
  [SOURCE.ps]: "PS",
};
const SHORT_KEY: Record<number, string> = { [SOURCE.create]: "create", [SOURCE.options]: "options", [SOURCE.touchpad]: "touchpad" };
const shortName = (t: T, button: number) => SHORT[button] ?? t(`desktop.buttons.badge.${SHORT_KEY[button]}`);
const targetShort = (t: T, target: Target) => (target.kind === TARGET_KIND.button ? shortName(t, target.a) : t("desktop.layouts.off"));

// The drawing's badges for a set's base layer: only changed buttons, "→ △" (§7.2).
export interface Badge {
  text: string;
  title: string;
}
export function setBadges(t: T, part: ButtonPart): Map<PartId, Badge> {
  const out = new Map<PartId, Badge>();
  // loop: NOT-WORTH — N ≤ 22 changed buttons, when the layout changes (useMemo)
  for (const s of changedSources(part)) {
    const press = basePress(part, s);
    if (!press) continue;
    out.set(SOURCE_PART[s], { text: `→ ${targetShort(t, press)}`, title: t("desktop.buttons.changedLine", { from: sourceName(t, s), to: targetName(t, press) }) });
  }
  return out;
}

// The sources this controller has (the Edge's four only on an Edge).
// loop: NOT-WORTH — N = 22 sources, per render of the section
const sourcesFor = (edge: boolean) => Array.from({ length: SOURCE_COUNT }, (_, s) => s).filter((s) => edge || !EDGE_SOURCES.includes(s));

// The Button assignments header for a set with buttons.
export function setButtonsStatus(t: T, set: TensionSet): string | null {
  if (!set.buttons) return null;
  return t("desktop.buttons.status", { set: set.name, count: changedSources(set.buttons).length });
}

// Today's buttons (the legacy table and the Edge extras) as a new set: the
// first empty slot (the one being edited if it's empty), or one the user
// picks to replace; it becomes the saved choice. A draft like any edit (§7.4).
export function MakeSetFromButtons({ tn, remap }: { tn: TensionDraft; remap: Remap }) {
  const { t } = useTranslation();
  const [replace, setReplace] = useState(0);
  const editingEmpty = tn.editing !== null && !tn.sets[tn.editing] ? tn.editing : -1;
  // loop: HOT-PATH-OK — N = 8 slots per render
  const empty = editingEmpty >= 0 ? editingEmpty : tn.sets.findIndex((s) => !s);
  const slot = empty >= 0 ? empty : replace;
  const make = () => {
    const buttons = partFromLegacy(remap.draft, remap.extraDevice ? remap.extraDraft : null);
    tn.edit(slot, { name: "Buttons", l2: { stages: [], policy: "fill" }, r2: { stages: [], policy: "fill" }, buttons });
    tn.choose(slot);
    tn.setEditing(slot);
  };
  return (
    <>
      {empty < 0 && (
        <Row label={t("desktop.buttons.makeSetReplace")}>
          <select className="dk-select" value={replace} onChange={(e) => setReplace(Number(e.target.value))}>
            {/* loop: HOT-PATH-OK — N = 8 slots */}
            {tn.sets.map((s, i) => (
              <option key={i} value={i}>
                {t("desktop.tension.slot", { slot: i, name: s ? s.name : t("desktop.tension.empty") })}
              </option>
            ))}
          </select>
        </Row>
      )}
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" onClick={make}>
          {t("desktop.buttons.makeSet")}
        </button>
      </div>
    </>
  );
}

// Older firmware (no identity [58] bit 0): today's editor, plus what to update (§7.11).
export function SetButtonsNeedFirmware() {
  const { t } = useTranslation();
  const { goTo } = useNoticeTasks();
  return (
    <>
      {/* hint: MUST-SHOW — why Hold, double press and layers aren't here: the firmware to update, with the link (page rules 7 and 9) */}
      <p className="dk-hint">{t("desktop.buttons.needsFirmware")}</p>
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" onClick={() => goTo("dongle", "firmware")}>
          {t("desktop.settings2.firmwareLink")}
        </button>
      </div>
    </>
  );
}

// A set whose buttons aren't used yet (first run, §7.11).
export function SetLeavesButtons({ onUse }: { onUse: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="dk-hint">{t("desktop.buttons.setLeaves")}</p>
      <div className="dk-row-btns">
        <button type="button" className="dk-btn primary" onClick={onUse}>
          {t("desktop.buttons.useInSet")}
        </button>
      </div>
    </>
  );
}

// "Change buttons in this set" starts from today's changes (the legacy table).
export const buttonsFromLegacy = (remap: Remap): ButtonPart => (remap.supported ? partFromLegacy(remap.draft, remap.extraDevice ? remap.extraDraft : null) : emptyButtonPart());

// The editor for a set with buttons: pick a button (the list, a click on the
// drawing or a press on the controller), then its Press row, Swap with… and
// Reset this button; with none picked, the Changed list. Reset all last.
export function SetButtonsEditor({
  set,
  onChange,
  pick,
  onPick,
  edge,
}: {
  set: TensionSet;
  onChange: (s: TensionSet) => void;
  pick: number | null;
  onPick: (source: number | null) => void;
  edge: boolean;
}) {
  const { t } = useTranslation();
  const part = set.buttons!;
  const update = (buttons: ButtonPart) => onChange({ ...set, buttons });
  const warnings = useMemo(() => pressWarnings(part), [part]);
  const sources = sourcesFor(edge);
  const shown = pick !== null && sources.includes(pick) ? pick : null;
  // loop: HOT-PATH-OK — N ≤ 22 changed buttons per render of the section
  const changed = changedSources(part).filter((s) => sources.includes(s));
  const layoutWarnings = (
    <>
      {warnings.noCross && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.noCross")}</p>}
      {warnings.noCircle && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.noCircle")}</p>}
    </>
  );
  return (
    <>
      <Row label={t("desktop.buttons.pick")} sub={t("desktop.buttons.pickHint")} info={t("desktop.buttons.warn.promptsInfo")}>
        <select className="dk-select" value={shown ?? ""} onChange={(e) => onPick(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">{t("desktop.buttons.pickNone")}</option>
          {/* loop: HOT-PATH-OK — N ≤ 22 sources */}
          {sources.map((s) => (
            <option key={s} value={s}>
              {sourceName(t, s)}
            </option>
          ))}
        </select>
      </Row>
      {shown === null ? (
        <SectionGroup title={t("desktop.buttons.changed")}>
          {changed.length === 0 ? (
            <p className="dk-hint">{t("desktop.buttons.noneChanged")}</p>
          ) : (
            <ul className="bt-changed">
              {/* loop: HOT-PATH-OK — N ≤ 22 changed buttons */}
              {changed.map((s) => (
                <li key={s}>
                  <button type="button" className="bt-link" onClick={() => onPick(s)}>
                    {t("desktop.buttons.changedLine", { from: sourceName(t, s), to: targetName(t, basePress(part, s)!) })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {layoutWarnings}
        </SectionGroup>
      ) : (
        <ChosenButton part={part} source={shown} sources={sources} warnings={warnings} layoutWarnings={layoutWarnings} onChange={update} />
      )}
      {/* The danger zone, last (page rule 10): every button of this set back to itself. */}
      <div className="dk-row-btns">
        <button type="button" className="dk-btn danger" onClick={() => update({ ...part, entries: part.entries.filter((e) => e.layer !== 0) })}>
          {t("desktop.live.remapReset")}
        </button>
      </div>
    </>
  );
}

function ChosenButton({
  part,
  source,
  sources,
  warnings,
  layoutWarnings,
  onChange,
}: {
  part: ButtonPart;
  source: number;
  sources: number[];
  warnings: ReturnType<typeof pressWarnings>;
  layoutWarnings: ReactNode;
  onChange: (p: ButtonPart) => void;
}) {
  const { t } = useTranslation();
  const name = sourceName(t, source);
  const ps = source === SOURCE.ps;
  const press = basePress(part, source);
  const dups = warnings.duplicates.get(source);
  // Swap with…: the buttons that have a job to hand over (not PS, whose Press stays; not the Edge's four).
  // loop: HOT-PATH-OK — N ≤ 22 sources
  const swappable = sources.filter((s) => s !== SOURCE.ps && !EDGE_SOURCES.includes(s));
  const trigger = (source === SOURCE.l2 || source === SOURCE.r2) && press !== null;
  return (
    <SectionGroup title={t("desktop.buttons.does", { button: name })}>
      <Row label={t("desktop.buttons.row.press")} info={trigger ? t("desktop.buttons.warn.triggerEffectInfo") : undefined}>
        {ps ? (
          <span className="bt-fixed">{t("desktop.buttons.psFixed")}</span>
        ) : (
          <TargetPicker label={t("desktop.buttons.row.press")} source={source} value={press} onPick={(to) => onChange(withBasePress(part, source, to))} />
        )}
      </Row>
      {dups && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.duplicate", { other: dups.map((o) => sourceName(t, o)).join(", ") })}</p>}
      {layoutWarnings}
      {!ps && (
        <div className="dk-row-btns">
          {swappable.includes(source) && <SwapPicker sources={swappable.filter((s) => s !== source)} onPick={(other) => onChange(swapBase(part, source, other))} />}
          <button type="button" className="dk-btn" onClick={() => onChange(withBasePress(part, source, null))}>
            {t("desktop.buttons.resetButton")}
          </button>
        </div>
      )}
    </SectionGroup>
  );
}

// The controller laid out on a 7 × 5 grid (the approved mock-up's Controller
// tab): [source, column, row].
const PAD: ReadonlyArray<[number, number, number]> = [
  [SOURCE.l2, 0, 0],
  [SOURCE.l1, 1, 0],
  [SOURCE.r1, 5, 0],
  [SOURCE.r2, 6, 0],
  [SOURCE.up, 1, 1],
  [SOURCE.ps, 3, 1],
  [SOURCE.triangle, 5, 1],
  [SOURCE.left, 0, 2],
  [SOURCE.right, 2, 2],
  [SOURCE.touchpad, 3, 2],
  [SOURCE.square, 4, 2],
  [SOURCE.circle, 6, 2],
  [SOURCE.down, 1, 3],
  [SOURCE.cross, 5, 3],
  [SOURCE.create, 0, 4],
  [SOURCE.l3, 2, 4],
  [SOURCE.r3, 4, 4],
  [SOURCE.options, 6, 4],
];

// Arrow keys move to the nearest cell that way (rows weigh more than columns).
function nextCell(cells: ReadonlyArray<[number, number, number]>, from: number, key: string): number {
  const [, c, r] = cells[from];
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!dir) return from;
  let best = from;
  let cost = Infinity;
  // loop: NOT-WORTH — N = 18 cells, one key press
  cells.forEach(([, cc, rr], i) => {
    const dc = cc - c;
    const dr = rr - r;
    if (dir[0] !== 0 ? Math.sign(dc) !== dir[0] : Math.sign(dr) !== dir[1]) return;
    const k = dir[0] !== 0 ? Math.abs(dc) + 3 * Math.abs(dr) : Math.abs(dr) + 3 * Math.abs(dc);
    if (k < cost) [best, cost] = [i, k];
  });
  return best;
}

// One popover (top layer, under its button): a controller grid with a roving
// tabindex (arrows, Home, End), Enter / click picks, Escape and Tab stay
// inside (a focus trap) and Escape puts the focus back on the button.
function GridPopover({
  label,
  buttonText,
  buttonClass,
  cells,
  current,
  own,
  disable,
  onPick,
}: {
  label: string;
  buttonText: string;
  buttonClass: string;
  cells: ReadonlyArray<[number, number, number]>;
  current: number | null; // the cell that is the value now
  own: number | null; // the button itself, marked "(default)"
  disable?: { label: string; on: boolean; pick: () => void };
  onPick: (source: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useTopLayer(pop, open, { anchor: button, gap: 4 });
  // loop: NOT-WORTH — N = 18 cells, on open
  const startAt = () =>
    Math.max(
      0,
      cells.findIndex(([s]) => s === current),
    );
  // lifetime: OK — cleanup: removes the outside-click listener (popover closes / unmount)
  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    // lifetime: OK — removed in the effect cleanup (popover closes / unmount)
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  // lifetime: OK — acquires nothing (moves the focus with the roving tabindex)
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>(`[data-cell="${at}"]`)?.focus();
  }, [open, at]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (s: number) => {
    onPick(s);
    close();
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the drawer's Escape too
      close();
    } else if (e.key === "Tab") {
      // The focus trap: the grid (one stop) and Disable.
      const stops = [...(pop.current?.querySelectorAll<HTMLElement>('[tabindex="0"], .bt-pop-off') ?? [])];
      const i = stops.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    } else if ((e.target as HTMLElement).dataset.cell !== undefined) {
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        setAt(e.key === "Home" ? 0 : cells.length - 1);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        setAt((i) => nextCell(cells, i, e.key));
      }
    }
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={buttonClass}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setAt(startAt());
          setOpen(!open);
        }}
      >
        {buttonText}
      </button>
      {open && (
        <div ref={pop} className="bt-pop top-layer" role="dialog" aria-label={label} onKeyDown={onKeys}>
          <div className="bt-pad" role="group" aria-label={label}>
            {/* loop: HOT-PATH-OK — N = 18 cells, while the popover is open */}
            {cells.map(([s, c, r], i) => {
              const name = sourceName(t, s) + (s === own ? ` (${t("desktop.live.remapDefault")})` : "");
              return (
                <button
                  key={s}
                  type="button"
                  data-cell={i}
                  tabIndex={i === at ? 0 : -1}
                  className={`bt-cell${s === current ? " on" : ""}${s === own ? " own" : ""}`}
                  style={{ gridColumn: c + 1, gridRow: r + 1 }}
                  aria-label={name}
                  aria-pressed={s === current}
                  title={name}
                  onClick={() => pick(s)}
                  onFocus={() => setAt(i)}
                >
                  {shortName(t, s)}
                </button>
              );
            })}
          </div>
          <p className="dk-hint">{t("desktop.buttons.target.gridHint")}</p>
          {disable && (
            <button
              type="button"
              className={`dk-btn bt-pop-off${disable.on ? " on" : ""}`}
              aria-pressed={disable.on}
              onClick={() => {
                disable.pick();
                close();
              }}
            >
              {disable.label}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// A row's target (§7.5): the Controller tab (build step 2; Key, Mouse and
// Layer come with their firmware pieces) and Disable. The button itself is
// "(default)"; picking it clears the row.
function TargetPicker({ label, source, value, onPick }: { label: string; source: number; value: Target | null; onPick: (t: Target | null) => void }) {
  const { t } = useTranslation();
  const own = source < CONTROLLER_TARGETS ? source : null;
  const current = value === null ? own : value.kind === TARGET_KIND.button ? value.a : null;
  const text = value === null ? (own === null ? t("desktop.layouts.extraSelf") : `${sourceName(t, source)} (${t("desktop.live.remapDefault")})`) : targetName(t, value);
  return (
    <GridPopover
      label={t("desktop.buttons.target.title", { row: label })}
      buttonText={text}
      buttonClass="dk-btn bt-target"
      cells={PAD}
      current={current}
      own={own}
      disable={{ label: t("remap.disabled"), on: !!value && sameTarget(value, DISABLE), pick: () => onPick(DISABLE) }}
      onPick={(s) => onPick(s === own ? null : buttonTarget(s))}
    />
  );
}

// Swap with…: the same grid, of the other buttons.
function SwapPicker({ sources, onPick }: { sources: number[]; onPick: (other: number) => void }) {
  const { t } = useTranslation();
  // loop: NOT-WORTH — N = 18 cells, per render of the chosen button
  const cells = PAD.filter(([s]) => sources.includes(s));
  return <GridPopover label={t("desktop.buttons.swap")} buttonText={t("desktop.buttons.swap")} buttonClass="dk-btn" cells={cells} current={null} own={null} onPick={onPick} />;
}

// Rising edges in the live input (the 0xF0 poll the drawing already runs):
// the first source newly pressed, or null (§7.2, pick by pressing).
export function newlyPressed(before: ReadonlySet<PartId>, now: ReadonlySet<PartId>): number | null {
  // loop: HOT-PATH-OK — N ≤ 19 pressed parts per live frame, only while Button assignments is open
  for (const part of now) if (!before.has(part) && PART_SOURCE.has(part)) return PART_SOURCE.get(part)!;
  return null;
}
