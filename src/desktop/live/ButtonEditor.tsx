// Button assignments: the button layout editor (protocol 1.24,
// docs/design/button-layouts-2026-11.md §2.1). It opens on the editor, no
// prerequisite: pick a button (the list, a click on the drawing or a press on
// the controller), read its rows as sentences (at most five: Press, Hold,
// Double press, With PS, Toggle / Turbo), change any row's target, swap, reset;
// layers on the tabs above the drawing; starting points; the live line; the
// Button layouts list; Reset all last. Every change is a draft of the layout
// in the editor (layoutEditor.ts) the one save bar writes (page rule 4). Each
// piece shows only when the board has it (identity [58]); nothing greyed out.
//
// Idle cost: none. Static controls; the popovers have listeners only while
// open; the drawing's badges are a static SVG overlay drawn when the layout
// or the tab changes (LiveController); the live line's poll is LiveTruth's.
import { X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { FEATURES5, KEYS_MOUSE_FLAGS } from "../../protocol/bridgeClient";
import {
  addLayer,
  buttonPartValid,
  deleteLayer,
  EDGE_SOURCES,
  effectiveEntry,
  emptyButtonPart,
  enteredBy,
  entryAt,
  HOLD_TIME_DEFAULT,
  itself,
  LAYER_COLOURS,
  LAYER_NAME_LEN,
  MAX_LAYERS,
  oneHand,
  pressTakesToggle,
  pressWarnings,
  resetLayer,
  SOURCE,
  SOURCE_COUNT,
  swapIn,
  switchesInto,
  TARGET_KIND,
  toggleInsteadOfHold,
  withLayer,
  withRow,
  withSameAsBase,
  withSwitch,
  withTime,
  withEntry,
  changedSources,
  type ButtonPart,
  type LiveTruth,
  type RowKey,
  type Target,
} from "../../protocol/buttons";
import { cleanName, TENSION_SLOTS } from "../../protocol/tension";
import { InfoTip, Row, Segmented, Slider, Toggle } from "../controls";
import { KeysMouseReconnect } from "../pages/SettingsPage";
import { SectionGroup } from "../accordion/Section";
import Notice from "../Notice";
import { useNoticeTasks } from "../notices";
import { useBoardDrafts } from "./boardDrafts";
import { changedLine, layerName, PART_SOURCE, sourceName, targetName } from "./buttonWords";
import { LiveLine } from "./LiveTruth";
import { LayoutList } from "./LayoutList";
import type { PartId } from "./parts";
import { PAD, PadGrid, Popover, TargetPicker, type PickerCaps } from "./TargetPicker";

type T = ReturnType<typeof useTranslation>["t"];
// The chosen button's Press row: where a click on the drawing lands (a deep link, ControllerView).
export const PRESS_ROW = "btn-press";
const seconds = (tens: number) => (tens / 100).toFixed(2);

// The sources this controller has (the Edge's four only on an Edge).
// loop: NOT-WORTH — N = 22 sources, per render of the section
const sourcesFor = (edge: boolean) => Array.from({ length: SOURCE_COUNT }, (_, s) => s).filter((s) => edge || !EDGE_SOURCES.includes(s));

// The Button assignments header: "Racing · 4 changed", plus its layers.
export function layoutStatus(t: T, name: string, part: ButtonPart): string {
  // loop: NOT-WORTH — N ≤ 4 layers, per render of the panel
  const changed = part.entries.length === 0 ? 0 : new Set(part.entries.map((e) => e.source)).size;
  return part.layers.length ? t("desktop.buttons.statusLayers", { name, changed, count: part.layers.length }) : t("desktop.buttons.status", { name, count: changed });
}

// Older firmware (no identity [58] bit 0): today's list, plus what to update.
export function ButtonsNeedFirmware() {
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

// Rising edges in the live input (the 0xF0 poll the drawing already runs):
// the first source newly pressed, or null (pick by pressing).
export function newlyPressed(before: ReadonlySet<PartId>, now: ReadonlySet<PartId>): number | null {
  // loop: HOT-PATH-OK — N ≤ 19 pressed parts per live frame, only while Button assignments is open
  for (const part of now) if (!before.has(part) && PART_SOURCE.has(part)) return PART_SOURCE.get(part)!;
  return null;
}

// The layer tabs above the drawing (navigation, never a setting): Base, each
// layer in its colour (a dot when it has changes), "+ Layer". A tablist:
// arrows, Home, End.
export function LayerTabs({ part, layer, onLayer, onChange }: { part: ButtonPart; layer: number; onLayer: (l: number) => void; onChange: (p: ButtonPart) => void }) {
  const { t } = useTranslation();
  const count = part.layers.length + 1;
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === "ArrowRight" ? layer + 1 : e.key === "ArrowLeft" ? layer - 1 : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const to = (next + count) % count;
    onLayer(to);
    (e.currentTarget.querySelector(`[data-layer="${to}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="bt-layers">
      <div role="tablist" aria-label={t("desktop.layers.tabs")} onKeyDown={onKeys}>
        {/* loop: HOT-PATH-OK — N ≤ 4 tabs, per render of the page */}
        {Array.from({ length: count }, (_, l) => (
          <button
            key={l}
            type="button"
            role="tab"
            data-layer={l}
            aria-selected={l === layer}
            tabIndex={l === layer ? 0 : -1}
            className={`bt-layer-tab${l === layer ? " on" : ""}${l > 0 ? ` layer-c${part.layers[l - 1].colour}` : ""}`}
            onClick={() => onLayer(l)}
          >
            {layerName(t, part, l)}
            {changedSources(part, l).length > 0 && <span className="bt-dot" aria-label={t("desktop.layouts.changed")} />}
          </button>
        ))}
      </div>
      {part.layers.length < MAX_LAYERS && (
        <button
          type="button"
          className="dk-btn bt-layer-add"
          onClick={() => {
            onChange(addLayer(part));
            onLayer(part.layers.length + 1);
          }}
        >
          {t("desktop.layers.add")}
        </button>
      )}
    </div>
  );
}

export interface EditorCaps extends PickerCaps {
  pressTypes: boolean; // [58] bit 1
  live: boolean; // [58] bit 3
}

export function editorCaps(bridge: UseDs5BridgeResult): EditorCaps {
  const c = bridge.client;
  const has = (bit: number) => !!c?.has5(bit);
  return { pressTypes: has(FEATURES5.pressTypes), layers: has(FEATURES5.layers), live: has(FEATURES5.liveTruth), keys: has(FEATURES5.keysMouse), motion: has(FEATURES5.gyroMouse) };
}

// The section's body with the layout editor (firmware with layouts on the board).
export function ButtonAssignments({
  bridge,
  pick,
  onPick,
  layer,
  onLayer,
  edge,
  live,
}: {
  bridge: UseDs5BridgeResult;
  pick: number | null;
  onPick: (source: number | null) => void;
  layer: number;
  onLayer: (l: number) => void;
  edge: boolean;
  // error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText, usePoll) in Live from the board's line (LiveLine)
  live: { truth: LiveTruth | null; error: string | null };
}) {
  const { t } = useTranslation();
  const { layout: editor, tension: tn } = useBoardDrafts();
  const caps = editorCaps(bridge);
  const set = editor.layout;
  const part = set.buttons ?? emptyButtonPart();
  const [refused, setRefused] = useState(false);
  // Every edit stays a layout the board takes; one past the pool is refused and said (warn.full).
  const update = (buttons: ButtonPart) => {
    const ok = buttonPartValid(buttons);
    setRefused(!ok);
    if (ok) editor.edit({ ...set, buttons });
  };
  const warnings = useMemo(() => pressWarnings(part, layer), [part, layer]);
  const sources = sourcesFor(edge);
  const shown = pick !== null && sources.includes(pick) ? pick : null;
  // loop: HOT-PATH-OK — N ≤ 22 changed buttons per render of the section
  const changed = changedSources(part, layer).filter((s) => sources.includes(s));
  const keys = bridge.identity?.keysMouseFlags ?? 0;
  const layoutWarnings = (
    <>
      {warnings.noCross && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.noCross")}</p>}
      {warnings.noCircle && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.noCircle")}</p>}
      {warnings.sixKeys && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.sixKeys")}</p>}
      {refused && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.full")}</p>}
    </>
  );
  return (
    <>
      <Row label={t("desktop.buttons.name")} sub={t("desktop.buttons.nameSub")} invalid={!set.name}>
        <input
          className="dk-input tn-name"
          type="text"
          maxLength={16}
          value={set.name}
          aria-label={t("desktop.buttons.name")}
          onChange={(e) => editor.edit({ ...set, name: cleanName(e.target.value) })}
        />
      </Row>
      {editor.full && (
        <Row label={t("desktop.buttons.saveInto")} info={t("desktop.buttons.saveIntoInfo")}>
          <select className="dk-select" value={editor.slot ?? ""} onChange={(e) => editor.pickSlot(Number(e.target.value))}>
            <option value="" disabled>
              {t("desktop.buttons.saveIntoPick")}
            </option>
            {/* loop: HOT-PATH-OK — N = 8 slots */}
            {Array.from({ length: TENSION_SLOTS }, (_, i) => (
              <option key={i} value={i}>
                {t("desktop.tension.slot", { slot: i, name: tn.sets[i]?.name ?? t("desktop.tension.empty") })}
              </option>
            ))}
          </select>
        </Row>
      )}
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
        <SectionGroup title={layer > 0 ? t("desktop.layers.title", { name: layerName(t, part, layer) }) : t("desktop.buttons.changed")}>
          {changed.length === 0 ? (
            <p className="dk-hint">{t("desktop.buttons.noneChanged")}</p>
          ) : (
            <ul className="bt-changed">
              {/* loop: HOT-PATH-OK — N ≤ 22 changed buttons */}
              {changed.map((s) => (
                <li key={s}>
                  <button type="button" className="bt-link" onClick={() => onPick(s)}>
                    {changedLine(t, part, layer, s)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {layoutWarnings}
        </SectionGroup>
      ) : (
        <ChosenButton bridge={bridge} part={part} layer={layer} source={shown} sources={sources} caps={caps} warnings={warnings} keysFlags={keys} layoutWarnings={layoutWarnings} onChange={update} />
      )}
      {layer > 0 && caps.layers && <LayerGroup part={part} layer={layer} caps={caps} onPick={onPick} onChange={update} onLayer={onLayer} />}
      {caps.pressTypes && (
        <SectionGroup title={t("desktop.buttons.presets")} info={t("desktop.buttons.presetsInfo")}>
          <div className="dk-row-btns">
            {caps.layers && (
              <>
                <button type="button" className="dk-btn" onClick={() => update(oneHand("left", part.gyro))}>
                  {t("desktop.buttons.preset.oneLeft")}
                </button>
                <button type="button" className="dk-btn" onClick={() => update(oneHand("right", part.gyro))}>
                  {t("desktop.buttons.preset.oneRight")}
                </button>
              </>
            )}
            <button type="button" className="dk-btn" onClick={() => update(toggleInsteadOfHold(part))}>
              {t("desktop.buttons.preset.toggle")}
            </button>
          </div>
        </SectionGroup>
      )}
      {caps.live && (
        <SectionGroup title={t("desktop.buttons.live.title")}>
          <LiveLine truth={live.truth} error={live.error} part={part} connected={!!bridge.identity?.controllerConnected} />
        </SectionGroup>
      )}
      <LayoutList />
      {/* The danger zone, last (page rule 10): every button of this layout back to itself, its layers gone. */}
      <div className="dk-row-btns">
        <button
          type="button"
          className="dk-btn danger"
          onClick={() => {
            update({ ...emptyButtonPart(), gyro: part.gyro });
            onLayer(0);
          }}
        >
          {t("desktop.live.remapReset")}
        </button>
      </div>
    </>
  );
}

// "Keys and mouse are off on the board" with Turn on, or "Reconnect to start keys and mouse" with Reconnect.
export function KeysWarning({ bridge, flags }: { bridge: UseDs5BridgeResult; flags: number }) {
  const { t } = useTranslation();
  const on = bridge.draft.keysMouse;
  if (!on)
    return (
      <Notice
        action={
          <button type="button" className="dk-btn" onClick={() => bridge.setDraftField("keysMouse", true)}>
            {t("desktop.buttons.turnOn")}
          </button>
        }
      >
        {t("desktop.buttons.warn.needsKeys")}
      </Notice>
    );
  if ((flags & KEYS_MOUSE_FLAGS.saved) !== 0 && (flags & KEYS_MOUSE_FLAGS.up) === 0) return <KeysMouseReconnect bridge={bridge} />;
  return null;
}

const keyish = (x: Target | undefined) => !!x && (x.kind === TARGET_KIND.key || x.kind === TARGET_KIND.mouseButton || x.kind === TARGET_KIND.mouseMove);

function ChosenButton({
  bridge,
  part,
  layer,
  source,
  sources,
  caps,
  warnings,
  keysFlags,
  layoutWarnings,
  onChange,
}: {
  bridge: UseDs5BridgeResult;
  part: ButtonPart;
  layer: number;
  source: number;
  sources: number[];
  caps: EditorCaps;
  warnings: ReturnType<typeof pressWarnings>;
  keysFlags: number;
  layoutWarnings: ReactNode;
  onChange: (p: ButtonPart) => void;
}) {
  const { t } = useTranslation();
  const name = sourceName(t, source);
  const ps = source === SOURCE.ps;
  const e = effectiveEntry(part, layer, source);
  const own = layer === 0 || !!entryAt(part, layer, source);
  const locked = switchesInto(part, layer, source);
  const readOnly = !own;
  const dups = warnings.duplicates.get(source);
  // Swap with…: the buttons that have a job to hand over (not PS, whose Press stays; not the Edge's four).
  // loop: HOT-PATH-OK — N ≤ 22 sources
  const swappable = sources.filter((s) => s !== SOURCE.ps && !EDGE_SOURCES.includes(s));
  const trigger = (source === SOURCE.l2 || source === SOURCE.r2) && !!e?.press;
  const selfText = itself(source) ? `${name} (${t("desktop.live.remapDefault")})` : t("desktop.layouts.extraSelf");
  const rowText = (row: RowKey) => {
    const x = e?.[row];
    return x ? targetName(t, part, x) : row === "press" ? selfText : t("desktop.buttons.notSet");
  };
  const set = (row: RowKey, x: Target | null) => onChange(withRow(part, layer, source, row, x));
  const picker = (row: RowKey) =>
    readOnly ? (
      <span className="bt-fixed">{rowText(row)}</span>
    ) : (
      <span className="bt-row-ctl">
        <TargetPicker label={t(`desktop.buttons.row.${row}`)} part={part} layer={layer} source={source} value={e?.[row] ?? null} unset={rowText(row)} caps={caps} onPick={(x) => set(row, x)} />
        {row !== "press" && e?.[row] && (
          <button
            type="button"
            className="dk-btn tn-icon"
            aria-label={t("desktop.buttons.clearRow", { row: t(`desktop.buttons.row.${row}`) })}
            title={t("desktop.buttons.clearRow", { row: t(`desktop.buttons.row.${row}`) })}
            onClick={() => set(row, null)}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </span>
    );
  // loop: NOT-WORTH — N = 4 rows
  const sendsKeys = [e?.press, e?.hold, e?.double, e?.withPs].some(keyish);
  return (
    <SectionGroup title={t("desktop.buttons.does", { button: name })}>
      {layer > 0 &&
        (locked ? (
          <p className="dk-hint">{t("desktop.layers.switchBack")}</p>
        ) : (
          <Toggle label={t("desktop.layers.sameAsBase")} value={!own} onChange={(same) => onChange(withSameAsBase(part, layer, source, same))} />
        ))}
      <Row id={PRESS_ROW} label={t("desktop.buttons.row.press")} info={trigger ? t("desktop.buttons.warn.triggerEffectInfo") : undefined}>
        {ps ? <span className="bt-fixed">{t("desktop.buttons.psFixed")}</span> : picker("press")}
      </Row>
      {caps.pressTypes && (
        <>
          <Row label={t("desktop.buttons.row.hold")}>{picker("hold")}</Row>
          {e?.hold && (
            <>
              {!readOnly && (
                <Slider
                  label={t("desktop.buttons.holdTime")}
                  value={(e.holdTime ?? HOLD_TIME_DEFAULT) / 100}
                  min={0.15}
                  max={2}
                  step={0.05}
                  digits={2}
                  unit="s"
                  onChange={(v) => onChange(withTime(part, layer, source, "holdTime", Math.round(v * 100)))}
                />
              )}
              <p className="dk-hint dk-bad">
                {t("desktop.buttons.warn.holdCost", { button: name })} <InfoTip text={t("desktop.buttons.warn.holdCostInfo", { time: `${seconds(e.holdTime ?? HOLD_TIME_DEFAULT)} s` })} />
              </p>
            </>
          )}
          <Row label={t("desktop.buttons.row.double")}>{picker("double")}</Row>
          {e?.double && (
            <p className="dk-hint dk-bad">
              {t("desktop.buttons.warn.doubleCost", { button: name, time: `${seconds(part.doubleWindow)} s` })}{" "}
              <InfoTip text={t("desktop.buttons.warn.doubleCostInfo", { time: `${seconds(part.doubleWindow)} s` })} />
            </p>
          )}
          {!ps && (
            <>
              <Row label={t("desktop.buttons.row.withPs")}>{picker("withPs")}</Row>
              {warnings.psCost && (
                <p className="dk-hint dk-bad">
                  {t("desktop.buttons.warn.psCost")} <InfoTip text={t("desktop.buttons.warn.psCostInfo")} />
                </p>
              )}
            </>
          )}
          {!ps && pressTakesToggle(e?.press) && !readOnly && (
            <>
              <Toggle label={t("desktop.buttons.row.toggle")} value={!!e?.toggle} onChange={(v) => onChange(withSwitch(part, layer, source, "toggle", v))} />
              <Toggle label={t("desktop.buttons.row.turbo")} value={!!e?.turbo} onChange={(v) => onChange(withSwitch(part, layer, source, "turbo", v))} />
              {e?.turbo && (
                <Slider label={t("desktop.buttons.turboRate")} value={e.turboRate ?? 10} min={2} max={30} step={1} onChange={(v) => onChange(withTime(part, layer, source, "turboRate", v))} />
              )}
            </>
          )}
        </>
      )}
      {/* loop: HOT-PATH-OK — N ≤ 21 other buttons with the same Press, one section's render */}
      {dups && <p className="dk-hint dk-bad">{t("desktop.buttons.warn.duplicate", { other: dups.map((o) => sourceName(t, o)).join(", ") })}</p>}
      {sendsKeys && <KeysWarning bridge={bridge} flags={keysFlags} />}
      {layoutWarnings}
      {!ps && !readOnly && (
        <div className="dk-row-btns">
          {swappable.includes(source) && (
            <Popover label={t("desktop.buttons.swap")} buttonText={t("desktop.buttons.swap")} buttonClass="dk-btn">
              {(close) => (
                <PadGrid
                  label={t("desktop.buttons.swap")}
                  // loop: NOT-WORTH — N = 18 cells, while the popover is open
                  cells={PAD.filter(([s]) => swappable.includes(s) && s !== source)}
                  current={null}
                  own={null}
                  onPick={(other) => {
                    onChange(swapIn(part, layer, source, other));
                    close();
                  }}
                />
              )}
            </Popover>
          )}
          <button type="button" className="dk-btn" onClick={() => onChange(withEntry(part, layer, source, null))}>
            {t("desktop.buttons.resetButton")}
          </button>
        </div>
      )}
    </SectionGroup>
  );
}

// The layer shown: its name, colour, who enters it, its gyro, Reset and Delete.
function LayerGroup({
  part,
  layer,
  caps,
  onPick,
  onChange,
  onLayer,
}: {
  part: ButtonPart;
  layer: number;
  caps: EditorCaps;
  onPick: (s: number) => void;
  onChange: (p: ButtonPart) => void;
  onLayer: (l: number) => void;
}) {
  const { t } = useTranslation();
  const l = part.layers[layer - 1];
  if (!l) return null;
  const entries = enteredBy(part, layer);
  return (
    <SectionGroup title={t("desktop.layers.title", { name: layerName(t, part, layer) })}>
      <Row label={t("desktop.layers.name")} sub={t("desktop.layers.nameSub")}>
        <input
          className="dk-input tn-name"
          type="text"
          maxLength={LAYER_NAME_LEN}
          value={l.name}
          placeholder={t("desktop.layers.defaultName", { n: layer })}
          aria-label={t("desktop.layers.name")}
          onChange={(e) => onChange(withLayer(part, layer, { name: e.target.value.replace(/[^\x20-\x7e]/g, "").slice(0, LAYER_NAME_LEN) }))}
        />
      </Row>
      <Row label={t("desktop.layers.colour")}>
        <div className="bt-swatches" role="radiogroup" aria-label={t("desktop.layers.colour")}>
          {/* loop: NOT-WORTH — N = 6 colours */}
          {Array.from({ length: LAYER_COLOURS }, (_, c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={l.colour === c}
              aria-label={t("desktop.layers.colourN", { n: c + 1 })}
              className={`bt-swatch layer-c${c}${l.colour === c ? " on" : ""}`}
              onClick={() => onChange(withLayer(part, layer, { colour: c }))}
            />
          ))}
        </div>
      </Row>
      <Row label={t("desktop.layers.enteredBy")} info={entries.length ? undefined : t("desktop.buttons.warn.layerNoEntryInfo")}>
        {entries.length === 0 ? (
          <span className="dk-hint dk-bad">{t("desktop.buttons.warn.layerNoEntry")}</span>
        ) : (
          <span className="bt-entered">
            {/* loop: HOT-PATH-OK — N ≤ 22 buttons that enter the layer */}
            {entries.map((x) => (
              <button key={`${x.source}-${x.row}-${x.from}`} type="button" className="bt-link" onClick={() => onPick(x.source)}>
                {t("desktop.layers.enteredLine", { button: sourceName(t, x.source), row: t(`desktop.buttons.row.${x.row}`), mode: t(`desktop.buttons.layerMode.${x.mode}`) })}
              </button>
            ))}
          </span>
        )}
      </Row>
      {caps.motion && part.gyro && (
        <Segmented
          label={t("desktop.layers.gyro")}
          value={l.gyro}
          options={[
            { value: 0, label: t("desktop.layers.gyroMode.same") },
            { value: 1, label: t("desktop.layers.gyroMode.on") },
            { value: 2, label: t("desktop.layers.gyroMode.off") },
          ]}
          onChange={(gyro) => onChange(withLayer(part, layer, { gyro }))}
        />
      )}
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" onClick={() => onChange(resetLayer(part, layer))}>
          {t("desktop.layers.reset")}
        </button>
        <button
          type="button"
          className="dk-btn danger"
          onClick={() => {
            onChange(deleteLayer(part, layer));
            onLayer(layer - 1);
          }}
        >
          {t("desktop.layers.delete")}
        </button>
      </div>
    </SectionGroup>
  );
}
