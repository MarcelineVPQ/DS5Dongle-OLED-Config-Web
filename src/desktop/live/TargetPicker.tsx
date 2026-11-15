// What a button's row does (protocol 1.24, docs/design/button-layouts-2026-11.md
// §2.2): one popover per row, in the top layer under its button, with tabs
// Controller · Key · Mouse · Layer · Gyro (each only when the board has its
// piece). A focus trap: Tab stays inside, Escape closes it and puts the focus
// back on the row's button. Idle cost: none; listeners only while open.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { buttonTarget, DISABLE, SOURCE, TARGET_KIND, sameTarget, type ButtonPart, type Target } from "../../protocol/buttons";
import { heldMods, KEY_GROUPS, KEYS, keyForCode, MOD, MOD_CODES, MOD_KEYS, leftMods } from "../../protocol/keys";
import { useTopLayer } from "../topLayer";
import { Slider } from "../controls";
import { GYRO_MODES, layerName, MOTIONS, MOUSE_BUTTONS, shortName, sourceName } from "./buttonWords";

// The controller laid out on a 7 × 5 grid (the approved mock-up's Controller
// tab): [source, column, row].
export const PAD: ReadonlyArray<[number, number, number]> = [
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

// A button that opens a dialog in the top layer under it, with a focus trap.
export function Popover({ label, buttonText, buttonClass, children }: { label: string; buttonText: string; buttonClass: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useTopLayer(pop, open, { anchor: button, gap: 4 });
  // lifetime: OK — cleanup: removes the outside-click listener (popover closes / unmount)
  useEffect(() => {
    if (!open) return;
    (pop.current?.querySelector<HTMLElement>('[data-first="1"]') ?? pop.current?.querySelector<HTMLElement>('[tabindex="0"], button'))?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    // lifetime: OK — removed in the effect cleanup (popover closes / unmount)
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  // Closing hands the focus back to the row's button, after the popover is gone
  // (an effect, so close itself touches no ref and can be handed to children).
  const [refocus, setRefocus] = useState(0);
  // lifetime: OK — acquires nothing (moves the focus back to the row's button)
  useEffect(() => {
    if (refocus) button.current?.focus();
  }, [refocus]);
  const close = () => {
    setOpen(false);
    setRefocus((n) => n + 1);
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the drawer's Escape too
      close();
    } else if (e.key === "Tab") {
      // The focus trap: every stop inside the dialog (a grid is one stop).
      const stops = [...(pop.current?.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), input, select, [tabindex='0']") ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
      const i = stops.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };
  return (
    <>
      <button ref={button} type="button" className={buttonClass} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {buttonText}
      </button>
      {open && (
        <div ref={pop} className="bt-pop top-layer" role="dialog" aria-label={label} onKeyDown={onKeys}>
          {children(close)}
        </div>
      )}
    </>
  );
}

// The controller grid: a roving tabindex (arrows, Home, End), Enter / click picks.
export function PadGrid({
  label,
  cells,
  current,
  own,
  onPick,
}: {
  label: string;
  cells: ReadonlyArray<[number, number, number]>;
  current: number | null;
  own: number | null;
  onPick: (s: number) => void;
}) {
  const { t } = useTranslation();
  // loop: NOT-WORTH — N = 18 cells, on open
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      cells.findIndex(([s]) => s === current),
    ),
  );
  const grid = useRef<HTMLDivElement>(null);
  const move = (i: number) => {
    setAt(i);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${i}"]`)?.focus();
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      move(e.key === "Home" ? 0 : cells.length - 1);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      move(nextCell(cells, at, e.key));
    }
  };
  return (
    <div ref={grid} className="bt-pad" role="group" aria-label={label} onKeyDown={onKeys}>
      {/* loop: HOT-PATH-OK — N = 18 cells, while the popover is open */}
      {cells.map(([s, c, r], i) => {
        const name = sourceName(t, s) + (s === own ? ` (${t("desktop.live.remapDefault")})` : "");
        return (
          <button
            key={s}
            type="button"
            data-cell={i}
            data-first={i === at ? "1" : undefined}
            tabIndex={i === at ? 0 : -1}
            className={`bt-cell${s === current ? " on" : ""}${s === own ? " own" : ""}`}
            style={{ gridColumn: c + 1, gridRow: r + 1 }}
            aria-label={name}
            aria-pressed={s === current}
            title={name}
            onClick={() => onPick(s)}
            onFocus={() => setAt(i)}
          >
            {shortName(t, s)}
          </button>
        );
      })}
    </div>
  );
}

export interface PickerCaps {
  keys: boolean; // key and mouse-button targets ([58] bit 4)
  motion: boolean; // mouse motion and the gyro ([58] bit 5)
  layers: boolean; // layer targets ([58] bit 2)
}
type Tab = "controller" | "key" | "mouse" | "layer" | "gyro";

// A row's target. `own` = the button itself (marked "(default)"; picking it
// clears the row); `unset` = what the button reads while the row is empty.
export function TargetPicker({
  label,
  part,
  layer,
  source,
  value,
  unset,
  caps,
  onPick,
}: {
  label: string;
  part: ButtonPart;
  layer: number;
  source: number;
  value: Target | null;
  unset: string;
  caps: PickerCaps;
  onPick: (t: Target | null) => void;
}) {
  const { t } = useTranslation();
  const own = source < 18 ? source : null;
  // loop: NOT-WORTH — N ≤ 3 layers
  const otherLayers = caps.layers ? part.layers.map((_, i) => i + 1).filter((l) => l !== layer) : [];
  const tabs: Tab[] = ["controller", ...(caps.keys ? (["key", "mouse"] as const) : []), ...(otherLayers.length ? (["layer"] as const) : []), ...(caps.motion && part.gyro ? (["gyro"] as const) : [])];
  const startTab: Tab =
    value?.kind === TARGET_KIND.key && caps.keys
      ? "key"
      : (value?.kind === TARGET_KIND.mouseButton || value?.kind === TARGET_KIND.mouseMove) && caps.keys
        ? "mouse"
        : value?.kind === TARGET_KIND.layer && otherLayers.length
          ? "layer"
          : value?.kind === TARGET_KIND.gyro && tabs.includes("gyro")
            ? "gyro"
            : "controller";
  return (
    <Popover label={t("desktop.buttons.target.title", { row: label })} buttonText={unset} buttonClass="dk-btn bt-target">
      {(close) => (
        <PickerBody
          part={part}
          own={own}
          value={value}
          tabs={tabs}
          startTab={startTab}
          otherLayers={otherLayers}
          caps={caps}
          label={label}
          onPick={(x) => {
            onPick(x);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function PickerBody({
  part,
  own,
  value,
  tabs,
  startTab,
  otherLayers,
  caps,
  label,
  onPick,
}: {
  part: ButtonPart;
  own: number | null;
  value: Target | null;
  tabs: Tab[];
  startTab: Tab;
  otherLayers: number[];
  caps: PickerCaps;
  label: string;
  onPick: (t: Target | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(startTab);
  const current = value === null ? own : value.kind === TARGET_KIND.button ? value.a : null;
  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const to = tabs[(next + tabs.length) % tabs.length];
    setTab(to);
    (e.currentTarget.querySelector(`[data-tab="${to}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <>
      {tabs.length > 1 && (
        <div className="bt-tabs" role="tablist" aria-label={t("desktop.buttons.target.title", { row: label })} onKeyDown={onTabKeys}>
          {/* loop: HOT-PATH-OK — N ≤ 5 tabs, while the popover is open */}
          {tabs.map((x) => (
            <button key={x} type="button" role="tab" data-tab={x} aria-selected={x === tab} tabIndex={x === tab ? 0 : -1} className={`bt-tab${x === tab ? " on" : ""}`} onClick={() => setTab(x)}>
              {t(`desktop.buttons.tab.${x}`)}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel">
        {tab === "controller" && (
          <>
            <PadGrid label={t("desktop.buttons.tab.controller")} cells={PAD} current={current} own={own} onPick={(s) => onPick(s === own ? null : buttonTarget(s))} />
            <p className="dk-hint">{t("desktop.buttons.target.gridHint")}</p>
            <button
              type="button"
              className={`dk-btn bt-pop-off${value && sameTarget(value, DISABLE) ? " on" : ""}`}
              aria-pressed={!!value && sameTarget(value, DISABLE)}
              onClick={() => onPick(DISABLE)}
            >
              {t("remap.disabled")}
            </button>
          </>
        )}
        {tab === "key" && <KeyTab value={value} onPick={onPick} />}
        {tab === "mouse" && <MouseTab value={value} motion={caps.motion} onPick={onPick} />}
        {tab === "layer" && (
          <div className="bt-list">
            {/* loop: HOT-PATH-OK — N ≤ 3 layers, while the popover is open */}
            {otherLayers.map((l) => (
              <div key={l} className="bt-list-row">
                <span className={`bt-swatch layer-c${part.layers[l - 1]?.colour ?? 0}`} aria-hidden="true" />
                <span className="bt-list-name">{layerName(t, part, l)}</span>
                {/* loop: NOT-WORTH — N = 2 modes */}
                {([0, 1] as const).map((b) => {
                  const on = value?.kind === TARGET_KIND.layer && value.a === l && value.b === b;
                  return (
                    <button key={b} type="button" className={`dk-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onPick({ kind: TARGET_KIND.layer, a: l, b })}>
                      {t(`desktop.buttons.layerMode.${b === 1 ? "switch" : "held"}`)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {tab === "gyro" && (
          <div className="dk-row-btns">
            {/* loop: NOT-WORTH — N = 3 gyro targets */}
            {GYRO_MODES.map((m, a) => {
              const on = value?.kind === TARGET_KIND.gyro && value.a === a;
              return (
                <button key={m} type="button" className={`dk-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onPick({ kind: TARGET_KIND.gyro, a, b: 0 })}>
                  {t(`desktop.buttons.gyro.${m}`)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// Key: press the key you want (armed by a click or Enter, the modifiers held
// count, Escape cancels; Tab is never taken unless armed), the four modifier
// switches, and Show all for keys the field can't catch.
function KeyTab({ value, onPick }: { value: Target | null; onPick: (t: Target) => void }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  const [mods, setMods] = useState(value?.kind === TARGET_KIND.key ? leftMods(value.b) : 0);
  const [all, setAll] = useState(false);
  const pick = (usage: number, held = 0) => onPick({ kind: TARGET_KIND.key, a: usage, b: mods | held });
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!armed) return;
    if (MOD_CODES[e.code] !== undefined) return; // a modifier alone: wait for the key
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setArmed(false);
    const key = keyForCode(e.code);
    if (key) pick(key.usage, heldMods(e));
  };
  return (
    <div className="bt-keys">
      <button type="button" data-first="1" className={`dk-btn bt-capture${armed ? " on" : ""}`} aria-pressed={armed} onClick={() => setArmed(!armed)} onKeyDown={onKey} onBlur={() => setArmed(false)}>
        {armed ? t("desktop.buttons.target.pressKeyArmed") : t("desktop.buttons.target.pressKey")}
      </button>
      <div className="dk-row-btns" role="group" aria-label={t("desktop.buttons.target.mods")}>
        {/* loop: NOT-WORTH — N = 4 modifiers */}
        {MOD_KEYS.map((m) => {
          const on = (mods & MOD[m]) !== 0;
          return (
            <button key={m} type="button" role="switch" aria-checked={on} className={`dk-btn${on ? " on" : ""}`} onClick={() => setMods(mods ^ MOD[m])}>
              {t(`desktop.buttons.mod.${m}`)}
            </button>
          );
        })}
        {mods !== 0 && (
          <button type="button" className="dk-btn" onClick={() => onPick({ kind: TARGET_KIND.key, a: 0, b: mods })}>
            {t("desktop.buttons.target.modsOnly")}
          </button>
        )}
      </div>
      <button type="button" className="dk-btn" aria-expanded={all} onClick={() => setAll(!all)}>
        {t("desktop.buttons.target.showAll")}
      </button>
      {all && (
        <div className="bt-allkeys">
          {/* loop: NOT-WORTH — N = 6 groups, while Show all is open */}
          {KEY_GROUPS.map((g) => (
            <div key={g} role="group" aria-label={t(`desktop.buttons.keyGroup.${g}`)}>
              <strong>{t(`desktop.buttons.keyGroup.${g}`)}</strong>
              <div className="bt-keygrid">
                {/* loop: NOT-WORTH — N ≈ 110 keys, while Show all is open */}
                {KEYS.filter((k) => k.group === g).map((k) => (
                  <button
                    key={k.usage}
                    type="button"
                    className={`bt-key${value?.kind === TARGET_KIND.key && value.a === k.usage ? " on" : ""}`}
                    aria-pressed={value?.kind === TARGET_KIND.key && value.a === k.usage}
                    onClick={() => pick(k.usage)}
                  >
                    {k.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const POINTER_SPEED = 40; // × 25 counts a second = 1000 (§3.4; a starting value, tunable)
const WHEEL_SPEED = 5; // notches a second

function MouseTab({ value, motion, onPick }: { value: Target | null; motion: boolean; onPick: (t: Target) => void }) {
  const { t } = useTranslation();
  const moving = value?.kind === TARGET_KIND.mouseMove ? value : null;
  const [speed, setSpeed] = useState(moving && moving.a <= 3 ? moving.b : POINTER_SPEED);
  const [wheel, setWheel] = useState(moving && moving.a > 3 ? moving.b : WHEEL_SPEED);
  return (
    <div className="bt-list">
      <div className="dk-row-btns">
        {/* loop: NOT-WORTH — N = 5 mouse buttons */}
        {MOUSE_BUTTONS.map((m, i) => {
          const on = value?.kind === TARGET_KIND.mouseButton && value.a === i + 1;
          return (
            <button
              key={m}
              type="button"
              data-first={i === 0 ? "1" : undefined}
              className={`dk-btn${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onPick({ kind: TARGET_KIND.mouseButton, a: i + 1, b: 0 })}
            >
              {t(`desktop.buttons.mouse.${m}`)}
            </button>
          );
        })}
      </div>
      {motion && (
        <>
          <div className="dk-row-btns">
            {/* loop: NOT-WORTH — N = 6 motions */}
            {MOTIONS.map((m, a) => {
              const on = moving?.a === a;
              return (
                <button key={m} type="button" className={`dk-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => onPick({ kind: TARGET_KIND.mouseMove, a, b: a <= 3 ? speed : wheel })}>
                  {t(`desktop.buttons.move.${m}`)}
                </button>
              );
            })}
          </div>
          <Slider label={t("desktop.buttons.speed")} value={speed} min={1} max={255} step={1} onChange={setSpeed} />
          <Slider label={t("desktop.buttons.wheelSpeed")} value={wheel} min={1} max={30} step={1} onChange={setWheel} />
        </>
      )}
    </div>
  );
}
