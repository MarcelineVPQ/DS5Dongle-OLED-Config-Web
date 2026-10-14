// The side panel of the one-screen view: the settings for whatever is
// selected (a part of the controller, the dongle, or the app itself). The
// sections are the same components the old pages used.
import { PanelRightClose, X } from "lucide-react";
import Markdown from "../Markdown";
import type { DevChannelPreview } from "../api";
import { hardwareName } from "../hardwareName";
import HdrTest from "../dev/HdrTest";
import Calibration from "./Calibration";
import { KNOBS, knob, useKnob, type Knob } from "../lookKnobs";
import { COLORWAYS, colorway } from "./colorways";
import { COLOR_PARTS, FALLBACK_BASE, hasCustomColors, mergeColors, useCustomColors } from "./customColors";
import { MODEL_COLORWAYS, SIM_CORE1_KEY, SIM_CORE1_STAGES, SIMULATED_KEY, useDevPreview, useDevToolsShown, useFakeSlots, type DevModel } from "../devPreview";
import { UPDATE_PREVIEWS, useUpdatePreview, type UpdatePreview } from "../updatePreview";
import { REDUCE_MOTION_KEY } from "../motion";
import { ACCENT_KEY, ACCENTS, useControllerCode, useDesktopAccentUnreadable } from "./controllerAccent";
import { GLASS_KEY } from "../glass/glassPref";
import { BACKGROUNDS, useBackground, type Background } from "./ArtBackdrop";
import { writePref, useFlagPref, usePref } from "../storage";
import { startSpeakerTest, stopSpeakerTest, useSpeakerPlayback } from "./speakerPlayer";
import { LISTEN_SECONDS, listenBack, startMicTest, type MicClip, type MicProblem, type MicSession } from "./micTest";
import { useWindowShown } from "../useWindowShown";
import { memo, useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../../components/LanguageToggle";
import ThemeToggle from "../../components/ThemeToggle";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED, REMAP_EXTRA_OFF, REMAP_EXTRA_SELF, tablesEqual } from "../../protocol/remap";
import { useLibrary, useProfileTarget } from "../library/libraryContext";
import { buttonLabel, layoutSummary } from "./layoutSummary";
import type { DesktopSettings, FirmwareLookup } from "../api";
import type { SpeakerSelect } from "../../protocol/config";
import ColorPicker from "../colorPicker/ColorPicker";
import { firmwareOffer } from "../useUpdates";
import { BusyButton, Row, Segmented, Toggle, Slider } from "../controls";
import { COLOR_VISIONS, type ColorVision, setColorVision, useColorVision } from "../colorVision";
import { say, setCaptions, setNarrator, useCaptionsOn, useNarrator } from "../narrator";
import { TOUR_ENABLED, startTour } from "../tour/Tour";
import FirmwarePage from "../pages/FirmwarePage";
import LightbarPage from "../pages/LightbarPage";
import {
  AutoHapticsSection,
  DisplaySection,
  EchoCancelToggle,
  HapticsSection,
  MicLevelSlider,
  MicSection,
  PcSleepSection,
  PowerSection,
  SpeakerSection,
  StatusPinSection,
  TriggerIntensitySection,
  UsbSection,
} from "../pages/SettingsPage";
import SlotsPage from "../pages/SlotsPage";
import TriggersPage from "../pages/TriggersPage";
import { usePoll } from "../usePoll";
import { gamesSupported, protonApplies } from "../games/platform";
import { onGamesAllowed, setGamesAllowed } from "../games/consent";
import type { FirmwareUpdate } from "../useUpdates";
import { EDGE_PARTS, EDGE_REMAP_ROWS, REMAP_INDEX, type PartId } from "./parts";
import type { Remap } from "./useRemap";
import { logged } from "../../errorText";
import { shown } from "../shownError";

export type PanelView = "overview" | "dongle" | "app" | "calibration" | "buttons" | { part: PartId };

interface Props {
  view: PanelView;
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  input: InputReport | null;
  remap: Remap;
  onClose: () => void;
  onOpen: (part: PartId) => void;
  onCalibrate: () => void;
  onButtons: (index?: number) => void;
  // The Buttons list: the focused row (also lit on the drawing) and hovers.
  buttonFocus: number | null;
  onButtonFocus: (index: number | null) => void;
  onButtonHover: (index: number | null) => void;
  edge: boolean; // a DualSense Edge (or its preview): the Buttons list adds its Fn buttons and paddles
  onHide: () => void;
}

export default function PartPanel({ view, bridge, fw, input, remap, onClose, onOpen, onCalibrate, onButtons, buttonFocus, onButtonFocus, onButtonHover, edge, onHide }: Props) {
  const { t } = useTranslation();
  const title =
    view === "overview"
      ? t("desktop.live.overview", "Your controller")
      : view === "dongle"
        ? hardwareName(bridge.identity)
        : view === "app"
          ? t("desktop.live.app", "App settings")
          : view === "calibration"
            ? t("desktop.calib.title")
            : view === "buttons"
              ? t("desktop.layouts.allTitle")
              : view.part === "l2" || view.part === "r2"
                ? t("desktop.live.triggersTitle")
                : partName(t, view.part);

  return (
    <div className="dk-stack">
      <header className="live-panel-head">
        <h2 tabIndex={-1}>{title}</h2>
        {view === "overview" && (
          <button type="button" className="dk-btn dk-icon-btn" onClick={onHide} title={t("desktop.live.hidePanel")} aria-label={t("desktop.live.hidePanel")}>
            <PanelRightClose size={14} />
          </button>
        )}
        {view !== "overview" && (
          <button type="button" className="dk-btn dk-icon-btn" onClick={onClose} title={t("desktop.live.close", "Close")} aria-label={t("desktop.live.close", "Close")}>
            <X size={14} />
          </button>
        )}
      </header>
      {view === "overview" && <Overview onOpen={onOpen} onCalibrate={onCalibrate} onButtons={() => onButtons()} />}
      {view === "buttons" && <AllButtonsList remap={remap} focus={buttonFocus} onFocus={onButtonFocus} onHover={onButtonHover} edge={edge} />}
      {view === "buttons" && remap.supported && <SavedLayouts remap={remap} />}
      {view === "calibration" && <Calibration bridge={bridge} input={input} />}
      {view === "dongle" && <DongleSections bridge={bridge} fw={fw} />}
      {view === "app" && <AppSettings bridge={bridge} fw={fw} />}
      {typeof view === "object" && <PartSections part={view.part} bridge={bridge} input={input} remap={remap} onButtons={onButtons} />}
    </div>
  );
}

function partName(t: (k: string) => string, part: PartId): string {
  return part === "body" ? t("desktop.live.part.body") : t(`desktop.live.part.${part}`);
}

// Shortcuts to every panel, so nobody has to guess where on the drawing a
// setting lives (the grips for haptics weren't obvious).
const SHORTCUTS: Array<[key: string, part: PartId]> = [
  ["lightbar", "lightbar"],
  ["triggers", "r2"],
  ["haptics", "body"],
  ["speaker", "speaker"],
  ["mic", "mute"],
  ["slots", "ps"],
];

function Overview({ onOpen, onCalibrate, onButtons }: { onOpen: (part: PartId) => void; onCalibrate: () => void; onButtons: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="dk-card">
      <p>{t("desktop.live.go.intro")}</p>
      <div className="live-shortcuts">
        {/* loop: HOT-PATH-OK — N ≈ 6 shortcuts per render */}
        {SHORTCUTS.map(([key, part]) => (
          <button key={key} type="button" className="live-shortcut" onClick={() => onOpen(part)}>
            <strong>{t(`desktop.live.go.${key}.title`)}</strong>
            <span>{t(`desktop.live.go.${key}.sub`)}</span>
          </button>
        ))}
        <button type="button" className="live-shortcut" data-view="buttons" onClick={onButtons}>
          <strong>{t("desktop.layouts.shortcutTitle")}</strong>
          <span>{t("desktop.layouts.shortcutSub")}</span>
        </button>
        <button type="button" className="live-shortcut" onClick={onCalibrate}>
          <strong>{t("desktop.calib.title")}</strong>
          <span>{t("desktop.calib.shortcut")}</span>
        </button>
      </div>
      <p className="dk-hint">{t("desktop.live.go.buttons")}</p>
    </section>
  );
}

function PartSections({ part, bridge, input, remap, onButtons }: { part: PartId; bridge: UseDs5BridgeResult; input: InputReport | null; remap: Remap; onButtons: (index?: number) => void }) {
  const index = REMAP_INDEX[part];
  return (
    <>
      {part === "lightbar" && <LightbarPage bridge={bridge} />}
      {(part === "l2" || part === "r2") && <TriggerLive input={input} side={part} />}
      {(part === "l2" || part === "r2") && <TriggerIntensitySection bridge={bridge} />}
      {(part === "l2" || part === "r2") && <TriggersPage bridge={bridge} />}
      {(part === "stick-l" || part === "stick-r") && <StickLive input={input} side={part} />}
      {part === "touchpad" && <TouchLive input={input} />}
      {part === "speaker" && <SpeakerSection bridge={bridge} />}
      {part === "speaker" && <LevelMeter bridge={bridge} which="speaker" />}
      {part === "speaker" && <SpeakerTest />}
      {part === "body" && <HapticsSection bridge={bridge} />}
      {part === "body" && <LevelMeter bridge={bridge} which="haptic" />}
      {part === "body" && <AutoHapticsSection bridge={bridge} />}
      {part === "mute" && <MicSection bridge={bridge} />}
      {part === "mute" && (
        <MicTest
          headset={input?.headphones ?? false}
          output={bridge.draft.speakerSelect}
          level={
            <>
              <MicLevelSlider bridge={bridge} />
              <EchoCancelToggle bridge={bridge} />
            </>
          }
        />
      )}
      {part === "ps" && <SlotsPage bridge={bridge} />}
      {EDGE_PARTS.has(part) && <EdgePartInfo part={part} />}
      {index !== undefined && <RemapSection index={index} remap={remap} onButtons={onButtons} />}
    </>
  );
}

function RemapSection({ index, remap, onButtons }: { index: number; remap: Remap; onButtons: (index?: number) => void }) {
  const { t } = useTranslation();
  const target = remap.draft[index];
  const game = useGameLayoutSave();
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.remapButton", { button: buttonLabel(index) })}</h2>
      {remap.supported === false ? (
        <p className="dk-hint">{t("remap.unsupported")}</p>
      ) : (
        <>
          <div className="dk-row">
            <label htmlFor={`remap-${index}`}>{t("desktop.live.remapActs", "Acts as")}</label>
            <select id={`remap-${index}`} className="dk-select" value={target} disabled={remap.busy || remap.supported !== true} onChange={(e) => remap.setTarget(index, Number(e.target.value))}>
              {/* loop: HOT-PATH-OK — N ≈ 17 options in one select per render */}
              {REMAP_BUTTON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === index ? `${o.label} (${t("desktop.live.remapDefault", "default")})` : o.label}
                </option>
              ))}
              <option value={REMAP_DISABLED}>{t("remap.disabled")}</option>
            </select>
          </div>
          {game.target ? (
            <div className="dk-notice">{t("desktop.editing.buttonsNote", { title: game.target.title })}</div>
          ) : (
            <p className="dk-hint">{t("desktop.live.remapHint", "Button assignments are written to {{device}} when you press Apply and work in every game, with no software on the PC.")}</p>
          )}
          <button type="button" className="dk-btn dk-btn-wrap" onClick={() => onButtons(index)}>
            {t("desktop.layouts.seeAll")}
          </button>
          {remap.error && <div className="dk-notice error">{remap.error}</div>}
          <RemapActions remap={remap} onSave={game.target ? game.saveToProfile : null} />
        </>
      )}
    </section>
  );
}

// The remap actions under the button pickers: Save to profile while a
// game's profile is on (the buttons go into its layout), else Apply remap.
function RemapActions({ remap, onSave }: { remap: Remap; onSave: (() => Promise<unknown>) | null }) {
  const { t } = useTranslation();
  return (
    <div className="dk-row-btns">
      {onSave ? (
        <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={onSave}>
          {t("desktop.bar.saveProfile")}
        </BusyButton>
      ) : (
        <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={remap.apply}>
          {t("desktop.live.remapApply", "Apply assignments")}
        </BusyButton>
      )}
      <button type="button" className="dk-btn" disabled={!remap.dirty || remap.busy} onClick={remap.revert}>
        {t("desktop.bar.revert", "Revert")}
      </button>
      <button type="button" className="dk-btn" disabled={remap.busy} onClick={remap.resetAll} title={t("desktop.live.remapResetHint", "Every button back to itself")}>
        {t("desktop.live.remapReset", "Reset all")}
      </button>
    </div>
  );
}

// Buttons edited while a game's profile is on go into that game's own layout
// (a new one named after the game if it has none) with "Save to profile",
// together with everything else changed for it; the profile hook then puts it
// on the dongle (temporary remap, RAM only). ControllerView hands the draft over.
function useGameLayoutSave() {
  const { library, saveToProfile } = useLibrary();
  const target = useProfileTarget();
  const profile = target ? library.games[target.gameKey]?.profile : undefined;
  return { target: profile ? target : null, saveToProfile };
}

// Every button in one list (the same draft as clicking them on the drawing),
// with what's changed from the controller's own buttons marked. memo()ed with
// the saved layouts below: the controller view re-renders on every live input
// frame (~30 a second) and neither depends on the input (useRemap's result
// only changes when the remap does).
export const AllButtonsList = memo(AllButtonsSection);
function AllButtonsSection({ remap, focus, onFocus, onHover, edge }: { remap: Remap; focus: number | null; onFocus: (i: number | null) => void; onHover: (i: number | null) => void; edge: boolean }) {
  const { t } = useTranslation();
  const table = useRef<HTMLDivElement>(null);
  // A button picked on the drawing: its row scrolls into view and its picker
  // gets the focus, ready to change.
  // lifetime: OK — acquires nothing (scrolls the picked row into view)
  useEffect(() => {
    if (focus === null) return;
    const sel = table.current?.querySelector<HTMLSelectElement>(`#all-remap-${focus}`);
    sel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    sel?.focus({ preventScroll: true });
  }, [focus]);
  // lifetime: OK — cleanup: clears the hovered row on unmount
  useEffect(() => () => onHover(null), [onHover]);
  // loop: HOT-PATH-OK — N = 16 + 4 slots per render
  const changed = remap.draft.filter((v, i) => v !== i).length + (edge && remap.extraDevice ? remap.extraDraft.filter((v) => v !== REMAP_EXTRA_SELF).length : 0);
  // A game's profile on (edited, or its game running): the buttons go into
  // that game's layout (switched in while it plays), never into the normal
  // buttons on the dongle.
  const { target, saveToProfile } = useGameLayoutSave();
  const { active } = useLibrary();
  // Not saved yet: in a profile, into its layout; else onto the dongle.
  const pendingLabel = target ? t("desktop.layouts.notSaved") : t("desktop.layouts.notApplied");
  if (remap.supported === false)
    return (
      <section className="dk-card">
        <p className="dk-hint">{t("remap.unsupported")}</p>
      </section>
    );
  return (
    <section className="dk-card">
      <h2>{t("desktop.layouts.allHeading")}</h2>
      {target && <div className="dk-notice">{t("desktop.editing.buttonsNote", { title: target.title })}</div>}
      <LoadedLayout remap={remap} />
      <p className="dk-hint">{t("desktop.layouts.allHint", { count: changed })}</p>
      {remap.temporary && !target && <div className="dk-notice">{t("desktop.layouts.activeNotice", { game: active?.title ?? t("desktop.layouts.aGame") })}</div>}
      <div className="dk-buttons-table" role="table" ref={table} onMouseLeave={() => onHover(null)}>
        {/* loop: HOT-PATH-OK — N = 16 rows; memo()ed, re-renders on a remap or focus change, not per live frame */}
        {remap.draft.map((target, i) => {
          const isChanged = target !== i;
          const pending = target !== remap.device[i];
          return (
            <div key={i} role="row" className={`dk-buttons-row${isChanged ? " changed" : ""}${focus === i ? " focused" : ""}`} onMouseEnter={() => onHover(i)} onFocus={() => onFocus(i)}>
              <label role="rowheader" htmlFor={`all-remap-${i}`}>
                {isChanged && <span aria-hidden="true">● </span>}
                {buttonLabel(i)}
                {(pending || isChanged) && <small>{pending ? pendingLabel : t("desktop.layouts.changed")}</small>}
              </label>
              <select
                id={`all-remap-${i}`}
                role="cell"
                className="dk-select"
                value={target}
                disabled={remap.busy || remap.supported !== true}
                onChange={(e) => remap.setTarget(i, Number(e.target.value))}
              >
                {/* loop: HOT-PATH-OK — 16 x ~17 options; memo()ed, only on a remap or focus change */}
                {REMAP_BUTTON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value === i ? `${o.label} (${t("desktop.live.remapDefault", "default")})` : o.label}
                  </option>
                ))}
                <option value={REMAP_DISABLED}>{t("remap.disabled")}</option>
              </select>
            </div>
          );
        })}
        {edge &&
          remap.extraDevice &&
          // loop: HOT-PATH-OK — N = 4 Edge rows; memo()ed, only on a remap or focus change
          EDGE_REMAP_ROWS.map((part, n) => {
            const i = 16 + n;
            const value = remap.extraDraft[n];
            const isChanged = value !== REMAP_EXTRA_SELF;
            const pending = value !== remap.extraDevice?.[n];
            return (
              <div key={part} role="row" className={`dk-buttons-row${isChanged ? " changed" : ""}${focus === i ? " focused" : ""}`} onMouseEnter={() => onHover(i)} onFocus={() => onFocus(i)}>
                <label role="rowheader" htmlFor={`all-remap-${i}`}>
                  {isChanged && <span aria-hidden="true">● </span>}
                  {t(`desktop.live.part.${part}`)}
                  {(pending || isChanged) && <small>{pending ? pendingLabel : t("desktop.layouts.changed")}</small>}
                </label>
                <select id={`all-remap-${i}`} role="cell" className="dk-select" value={value} disabled={remap.busy} onChange={(e) => remap.setExtra(n, Number(e.target.value))}>
                  <option value={REMAP_EXTRA_SELF}>{t("desktop.layouts.extraSelf")}</option>
                  {/* loop: HOT-PATH-OK — 4 x ~17 options; memo()ed, only on a remap or focus change */}
                  {REMAP_BUTTON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  <option value={REMAP_EXTRA_OFF}>{t("remap.disabled")}</option>
                </select>
              </div>
            );
          })}
      </div>
      {remap.error && <div className="dk-notice error">{remap.error}</div>}
      <RemapActions remap={remap} onSave={target ? saveToProfile : null} />
    </section>
  );
}

// Which saved layout is in the editor, and where it stands, said plainly.
function LoadedLayout({ remap }: { remap: Remap }) {
  const { t } = useTranslation();
  const { library } = useLibrary();
  const l = remap.loaded;
  if (!l) return null;
  const name = library.layouts?.[l.id]?.name ?? l.name;
  const edited = !tablesEqual(remap.draft, l.table);
  const applied = !edited && tablesEqual(remap.device, l.table);
  const state = edited ? "edited" : applied ? "applied" : "notApplied";
  return (
    <div className="dk-loaded" role="status">
      <strong>
        {t("desktop.layouts.loaded", { name })}
        {edited && ` (${t("desktop.layouts.loadedEdited")})`}
      </strong>
      <span>{t(`desktop.layouts.loadedState.${state}`)}</span>
    </div>
  );
}

// Saved button layouts: the buttons above under a name, for any game's profile.
export const SavedLayouts = memo(ButtonLayoutsSection);
function ButtonLayoutsSection({ remap }: { remap: Remap }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const { library, setLibrary } = useLibrary();
  const [name, setName] = useState("");
  // loop: HOT-PATH-OK — N = saved layouts (a few); once per library change (useMemo + memo)
  const layouts = useMemo(() => Object.entries(library.layouts ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name)), [library.layouts]);
  // How many game profiles use each layout: one pass over the games per library change.
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    // loop: HOT-PATH-OK — N = games with a profile (tens to hundreds); once per library change
    for (const g of Object.values(library.games)) {
      const id = g.profile?.settings.buttonLayout;
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [library.games]);
  const usedBy = (id: string) => uses.get(id) ?? 0;
  if (!desktop) return null;
  // loop: HOT-PATH-OK — N = 4 Edge names per render
  const extraNames = EDGE_REMAP_ROWS.map((p) => t(`desktop.live.part.${p}`));
  const save = (id: string, layoutName: string) =>
    void desktop
      .librarySetLayout({ id, name: layoutName, table: remap.draft, ...(remap.extraDevice ? { extra: remap.extraDraft } : {}) })
      .then(setLibrary)
      .catch(shown("desktop.errors.layoutSave"));
  return (
    <section className="dk-card">
      <h2>{t("desktop.layouts.title")}</h2>
      <p className="dk-hint">{t("desktop.layouts.hint")}</p>
      {layouts.length === 0 ? (
        <p className="dk-hint">{t("desktop.layouts.none")}</p>
      ) : (
        <ul className="dk-layouts">
          {/* loop: HOT-PATH-OK — N = saved layouts (a few); memo()ed, only on a remap or library change */}
          {layouts.map(([id, l]) => (
            <li key={id} className={remap.loaded?.id === id ? "loaded" : undefined}>
              <div className="dk-layout-info">
                <span className="dk-layout-name" title={l.name}>
                  {l.name}
                </span>
                {remap.loaded?.id === id && <span className="dk-chip ok">{t("desktop.layouts.loadedChip")}</span>}
                {usedBy(id) > 0 && <span className="dk-hint"> · {t("desktop.layouts.usedBy", { count: usedBy(id) })}</span>}
                <span className="dk-layout-changes">
                  {layoutSummary(l.table, t("desktop.layouts.off"), t("desktop.layouts.noChanges"), l.extra ? { values: l.extra, names: extraNames } : undefined)}
                </span>
              </div>
              <div className="dk-layout-btns">
                <button type="button" className="dk-btn" title={t("desktop.layouts.loadHint")} onClick={() => remap.load(l.table, { id, name: l.name }, l.extra)}>
                  {t("desktop.layouts.load")}
                </button>
                <button
                  type="button"
                  className="dk-btn"
                  title={t("desktop.layouts.updateHint", { name: l.name })}
                  onClick={() => {
                    save(id, l.name);
                    remap.load(remap.draft, { id, name: l.name });
                  }}
                >
                  {t("desktop.layouts.update")}
                </button>
                <button
                  type="button"
                  className="dk-btn danger"
                  title={t("desktop.layouts.deleteHint")}
                  onClick={() => void desktop.libraryDeleteLayout(id).then(setLibrary).catch(shown("desktop.errors.layoutDelete"))}
                >
                  {t("desktop.layouts.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="dk-row dk-layout-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = `l-${Date.now().toString(36)}`;
          save(id, name.trim());
          remap.load(remap.draft, { id, name: name.trim() });
          setName("");
        }}
      >
        <input
          className="dk-input"
          maxLength={40}
          placeholder={t("desktop.layouts.namePlaceholder")}
          aria-label={t("desktop.layouts.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="dk-btn primary" disabled={!name.trim()}>
          {t("desktop.layouts.saveAs")}
        </button>
      </form>
    </section>
  );
}

function Meter({ value, hold }: { value: number; hold?: number }) {
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
  return (
    <div className="live-meter" aria-hidden="true">
      <span style={{ "--level": Math.min(1, Math.max(0, value)) } as React.CSSProperties} />
      {hold !== undefined && hold > 0.01 && <i style={{ left: pct(hold) }} />}
    </div>
  );
}

// Both triggers: the trigger test (and games) set effects on both, so both
// pulls show, the one picked on the drawing first.
function TriggerLive({ input, side }: { input: InputReport | null; side: "l2" | "r2" }) {
  const { t } = useTranslation();
  const sides: Array<"l2" | "r2"> = side === "l2" ? ["l2", "r2"] : ["r2", "l2"];
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.pull", "Pull")}</h2>
      {/* loop: HOT-PATH-OK — N = 2 triggers per live frame */}
      {sides.map((sd) => {
        const value = input ? (sd === "l2" ? input.triggerLeft : input.triggerRight) : 0;
        const effect = input ? (sd === "l2" ? input.triggerEffectLeft : input.triggerEffectRight) : 0;
        return (
          <div key={sd} className={`live-trigger-pull${sd === side ? " picked" : ""}`}>
            <strong>{sd.toUpperCase()}</strong>
            <Meter value={value / 255} />
            <p className="dk-hint">
              {Math.round((value / 255) * 100)}% · {t("desktop.live.effect", "Effect")}: {t(`desktop.live.effects.${effect}`, t("desktop.live.effectOther", { n: effect }))}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function StickLive({ input, side }: { input: InputReport | null; side: "stick-l" | "stick-r" }) {
  const { t } = useTranslation();
  const s = input ? (side === "stick-l" ? input.leftStick : input.rightStick) : { x: 128, y: 128 };
  const pct = (v: number) => Math.round(((v - 128) / 127) * 100);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.position", "Position")}</h2>
      <p className="dk-mono">
        X {pct(s.x)}% · Y {pct(s.y)}%
      </p>
    </section>
  );
}

// The DualSense Edge's Fn buttons and back paddles: what they are; they light
// up on the drawing when pressed, remapping them comes later.
function EdgePartInfo({ part }: { part: PartId }) {
  const { t } = useTranslation();
  const kind = part === "fn-l" || part === "fn-r" ? "fn" : "paddle";
  return (
    <section className="dk-card">
      <p>{t(`desktop.live.edgePart.${kind}`)}</p>
      <p className="dk-hint">{t("desktop.live.edgePart.soon")}</p>
    </section>
  );
}

function TouchLive({ input }: { input: InputReport | null }) {
  const { t } = useTranslation();
  // loop: HOT-PATH-OK — N ≤ 2 fingers per live frame
  const touching = input?.fingers.filter((f) => f.touching) ?? [];
  return (
    <section className="dk-card">
      <p className="dk-hint">{t("desktop.live.touchHint", "Touch the touch pad to see your fingers here. There's nothing to set up for it.")}</p>
      {/* loop: HOT-PATH-OK — N ≤ 2 fingers per live frame */}
      {touching.map((f, i) => (
        <p key={i} className="dk-mono">
          {t("desktop.live.finger", { n: i + 1, defaultValue: "Finger {{n}}" })}: {f.x}, {f.y}
        </p>
      ))}
    </section>
  );
}

// The live level from the dongle's audio pipeline (0xFB peak, which decays
// on every read), with a short peak-hold line, a percentage, and what it
// means when it sits at zero.
function LevelMeter({ bridge, which }: { bridge: UseDs5BridgeResult; which: "speaker" | "haptic" }) {
  const { t } = useTranslation();
  const client = bridge.client;
  // The level, and its peak held for 1.5 s (kept with each reading).
  const hold = useRef({ value: 0, at: 0 });
  // lifetime: OK — usePoll stops on unmount (panel closed) and while hidden
  const reading = usePoll(
    async () => {
      const diag = await client!.readDiag();
      const level = (which === "speaker" ? diag.peakSpeaker : diag.peakHaptic) / 255;
      const now = Date.now();
      if (level >= hold.current.value || now - hold.current.at > 1500) hold.current = { value: level, at: now };
      return { level, hold: hold.current.value };
    },
    120,
    Boolean(client),
  ).value;
  const level = reading?.level ?? 0;
  const held = reading?.hold ?? 0;
  const silent = held < 0.01;
  return (
    <section className="dk-card">
      <h2>{which === "speaker" ? t("desktop.live.speakerLevel", "Speaker level now") : t("desktop.live.hapticLevel", "Haptic feedback now")}</h2>
      <div className="live-level">
        <Meter value={level} hold={held} />
        <span className="live-level-pct">{Math.round(level * 100)}%</span>
      </div>
      <p className="dk-hint">{silent ? t(which === "speaker" ? "desktop.live.speakerSilent" : "desktop.live.hapticSilent") : t("desktop.live.levelLive")}</p>
    </section>
  );
}

// The dongle-wide settings aren't part of a game's profile: say so while one is
// on, since the save bar then saves to the profile (these stay normal settings,
// kept after the profile ends, to save to the dongle then).
function ProfileDongleNote() {
  const { t } = useTranslation();
  const target = useProfileTarget();
  return target ? <div className="dk-notice">{t("desktop.editing.dongleNote", { title: target.title })}</div> : null;
}

function DongleSections({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  return (
    <>
      <FirmwarePage bridge={bridge} fw={fw} />
      <ProfileDongleNote />
      <PowerSection bridge={bridge} />
      <PcSleepSection bridge={bridge} />
      <DisplaySection bridge={bridge} />
      <UsbSection bridge={bridge} />
      <StatusPinSection bridge={bridge} />
    </>
  );
}

// The app's own settings (stored by the main process), plus theme and language.
function AppSettings({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  // Joining the Development channel asks first (what it means, what's in it).
  const [joiningDev, setJoiningDev] = useState(false);
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [gpuChanged, setGpuChanged] = useState(false);
  const [hdrChanged, setHdrChanged] = useState(false);
  // lifetime: OK — acquires nothing (one settings read)
  useEffect(() => {
    window.desktop?.getSettings().then(setSettings).catch(shown("desktop.errors.settingsRead"));
  }, []);
  // error: SHOWN — desktop.errors.settingNotSaved (was SILENT-BUG: a toggle that didn't save showed nothing)
  const set = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    window.desktop?.setSetting(key, value).then(setSettings).catch(shown("desktop.errors.settingNotSaved"));
  };
  return (
    <>
      <section className="dk-card">
        <h2>{t("desktop.settings2.language")}</h2>
        <div className="dk-row-btns">
          <LanguageToggle />
        </div>
      </section>
      <section className="dk-card">
        <h2>{t("desktop.settings2.appearance")}</h2>
        <Row label={t("desktop.settings2.theme")}>
          <ThemeToggle />
        </Row>
        <GlassSetting />
        <AccentSetting />
        <BackdropSetting />
        {/* loop: HOT-PATH-OK — N ≈ 10 look knobs per render */}
        {KNOBS.filter((k) => !k.hidden).map((k) => (
          <KnobSlider key={k.key} k={k} />
        ))}
        <CustomColorsSetting />
      </section>
      <section className="dk-card">
        <h2>{t("desktop.settings2.accessibility")}</h2>
        <ColorVisionSetting />
        <ReduceMotionSetting />
        <NarratorSettings />
      </section>
      {settings && (
        <>
          <section className="dk-card">
            <h2>{t("desktop.settings2.startup")}</h2>
            <Toggle label={t("desktop.live.closeToTray")} value={settings.closeToTray} onChange={(v) => set("closeToTray", v)} />
            <Toggle label={t("desktop.live.launchAtLogin")} value={settings.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} />
            <Toggle label={t("desktop.live.startMinimized")} value={settings.startMinimized} onChange={(v) => set("startMinimized", v)} />
          </section>
          {gamesSupported() && <GameLaunchersSetting />}
          <section className="dk-card">
            <h2>{t("desktop.settings2.advanced")}</h2>
            <Toggle
              label={t("desktop.live.hardwareAcceleration")}
              sub={gpuChanged ? t("desktop.live.restartToApply") : t("desktop.live.hardwareAccelerationSub")}
              value={settings.hardwareAcceleration}
              onChange={(v) => {
                setGpuChanged(true);
                set("hardwareAcceleration", v);
              }}
            />
            <Toggle
              label={t("desktop.hdr.label")}
              sub={hdrChanged ? t("desktop.live.restartToApply") : t("desktop.hdr.sub")}
              value={settings.hdrLighting}
              disabled={!settings.hardwareAcceleration}
              onChange={(v) => {
                setHdrChanged(true);
                set("hdrLighting", v);
              }}
            />
            {settings.hdrLighting && <KnobSlider k={knob("hdrNits")} />}
          </section>
          <section className="dk-card">
            <h2>{t("desktop.settings2.updates")}</h2>
            <Toggle label={t("desktop.live.checkForUpdates")} sub={t("desktop.live.checkForUpdatesSub")} value={settings.checkForUpdates} onChange={(v) => set("checkForUpdates", v)} />
            <Toggle
              label={t("desktop.live.autoInstall")}
              sub={t("desktop.live.autoInstallSub")}
              value={settings.checkForUpdates && settings.autoInstallUpdates}
              disabled={!settings.checkForUpdates}
              onChange={(v) => {
                set("autoInstallUpdates", v);
                set("updatesAsked", true);
              }}
            />
            <Segmented
              label={t("desktop.channel.label")}
              value={settings.updateChannel === "dev" ? 1 : 0}
              options={[
                { value: 0, label: t("desktop.channel.stable") },
                { value: 1, label: t("desktop.channel.dev") },
              ]}
              onChange={(v) => (v === 1 ? setJoiningDev(true) : set("updateChannel", "stable"))}
            />
            {joiningDev && (
              <DevChannelDialog
                automatic={settings.checkForUpdates}
                onJoin={() => {
                  setJoiningDev(false);
                  set("updateChannel", "dev");
                }}
                onCancel={() => setJoiningDev(false)}
              />
            )}
            <p className="dk-hint">{settings.updateChannel === "dev" ? t("desktop.channel.devHint") : t("desktop.channel.stableHint")}</p>
            <CheckNow firmwareInstalled={bridge.firmwareVersion} refreshFirmware={fw.refreshLatest} />
            {settings.updateChannel === "dev" && (
              <div className="dk-row-btns">
                <BusyButton
                  className="dk-btn"
                  onClick={async () => {
                    await window.desktop?.backToStable();
                    setSettings((await window.desktop?.getSettings()) ?? settings);
                  }}
                >
                  {t("desktop.channel.backToStable")}
                </BusyButton>
              </div>
            )}
          </section>
        </>
      )}
      <DeveloperSettings devChannel={settings?.updateChannel === "dev"} />
      {TOUR_ENABLED && (
        <section className="dk-card">
          <h2>{t("desktop.tour.helpTitle")}</h2>
          <p className="dk-hint">{t("desktop.tour.helpHint")}</p>
          <div className="dk-row-btns">
            <button type="button" className="dk-btn" onClick={startTour}>
              {t("desktop.tour.replay")}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

// Privacy: whether Games may read the game launchers (its first-visit consent).
// Turning it off asks first, since the library and per-game controller profiles
// hide until it's back on; turning it on is the same as "Check my launchers".
export function GameLaunchersSetting() {
  const { t } = useTranslation();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // lifetime: OK — cleanup: drops a late read, unsubscribes the games-allowed event
  useEffect(() => {
    let live = true;
    window.desktop
      ?.getSettings()
      .then((s) => live && setAllowed(s.gamesScanAllowed))
      .catch(logged("reading the Games consent for App settings (the card stays hidden)"));
    // lifetime: OK — off() in the effect cleanup
    const off = onGamesAllowed(setAllowed);
    return () => {
      live = false;
      off();
    };
  }, []);
  if (allowed === null) return null;
  const reads = t("desktop.games.readLaunchersSub", { what: t(protonApplies() ? "desktop.games.consentLaunchers" : "desktop.games.consentLaunchersWindows") });
  const offText = t("desktop.games.readLaunchersOff");
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings2.privacy")}</h2>
      <Toggle
        label={t("desktop.games.readLaunchers")}
        sub={`${reads} ${offText}`}
        value={allowed}
        disabled={confirmOff}
        onChange={(v) => (v ? setGamesAllowed(true).catch(shown("desktop.errors.settingNotSaved")) : setConfirmOff(true))}
      />
      {confirmOff && (
        <div className="dk-row-btns" role="alert">
          <span className="dk-bad">{offText}</span>
          <span className="dk-spacer" />
          <button type="button" className="dk-btn" onClick={() => setConfirmOff(false)}>
            {t("desktop.common.cancel")}
          </button>
          <BusyButton
            className="dk-btn danger"
            onClick={async () => {
              await setGamesAllowed(false).catch(shown("desktop.errors.settingNotSaved"));
              setConfirmOff(false);
            }}
          >
            {t("desktop.games.readLaunchersTurnOff")}
          </BusyButton>
        </div>
      )}
    </section>
  );
}

// Checks the chosen channel now, the app and the dongle's firmware, instead
// of waiting for the next automatic check (every 6 hours). Anything new shows
// up in the banners at the top; this says what was found for both.
function CheckNow({ firmwareInstalled, refreshFirmware }: { firmwareInstalled: string | null | undefined; refreshFirmware: () => Promise<FirmwareLookup> }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<string[]>([]);
  const desktop = window.desktop;
  if (!desktop) return null;
  const check = async () => {
    setResult([]);
    // error: SHOWN — desktop.setup.checkFailed (null: the line below says the check failed)
    const app = await desktop.checkForUpdates().catch(() => null);
    const lines: string[] = [];
    if (!app || app.phase === "failed") lines.push(t("desktop.setup.checkFailed"));
    else if (app.phase === "up-to-date") lines.push(t("desktop.setup.checkedCurrent", { version: app.version }));
    else if (app.phase !== "idle" && app.phase !== "checking") lines.push(t("desktop.setup.checkedNewer", { version: app.version }));
    // The firmware: only with a dongle connected (its version is what's compared).
    if (firmwareInstalled && app && app.phase !== "failed") {
      const lookup = await refreshFirmware();
      const latest = lookup.latest?.version;
      if (latest && firmwareOffer(latest, firmwareInstalled).available) lines.push(t("desktop.setup.checkedFwNewer", { version: latest }));
      else if (lookup.latest || lookup.problem === "unpublished") lines.push(t("desktop.setup.checkedFwCurrent", { version: firmwareInstalled }));
    }
    setResult(lines);
  };
  return (
    <div className="dk-row-btns">
      <BusyButton className="dk-btn" onClick={check}>
        {t("desktop.setup.checkUpdates")}
      </BusyButton>
      {result.length > 0 && (
        <span className="dk-hint" role="status">
          {/* loop: HOT-PATH-OK — N ≤ 3 result lines, after a click */}
          {result.map((line) => (
            <span key={line} className="dk-check-line">
              {line}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// Colour-blind-safe palettes for the app's status colours and graphs.
function ColorVisionSetting() {
  const { t } = useTranslation();
  const cv = useColorVision();
  return (
    <Row label={t("desktop.colorVision.label")} sub={t("desktop.colorVision.sub")}>
      <select className="dk-select" aria-label={t("desktop.colorVision.label")} value={cv} onChange={(e) => setColorVision(e.target.value as ColorVision)}>
        {/* loop: HOT-PATH-OK — N ≈ 4 color vision options per render */}
        {COLOR_VISIONS.map((v) => (
          <option key={v} value={v}>
            {t(`desktop.colorVision.${v}`)}
          </option>
        ))}
      </select>
    </Row>
  );
}

// The narrator's voice (controller speaker only) and her captions.
function NarratorSettings() {
  const { t } = useTranslation();
  const voice = useNarrator();
  const captions = useCaptionsOn();
  return (
    <>
      <Toggle label={t("desktop.narrator.voice")} sub={t("desktop.narrator.voiceSub")} value={voice === "on"} onChange={(v) => setNarrator(v ? "on" : "off")} />
      <Toggle label={t("desktop.narrator.captions")} sub={t("desktop.narrator.captionsSub")} value={captions} onChange={setCaptions} />
      <div className="dk-row-btns">
        <BusyButton className="dk-btn" disabled={voice !== "on"} onClick={() => say("app_controller", { cut: true })}>
          {t("desktop.narrator.test", "Test the voice")}
        </BusyButton>
      </div>
    </>
  );
}

// Korobeiniki on the controller's speaker. The app-wide player
// (speakerPlayer.ts) owns the sound, so leaving the panel doesn't stop it;
// back here, the countdown and the line pick up where it is.
export function SpeakerTest() {
  const { t } = useTranslation();
  const { playing, startedAt, duration, noSpeaker } = useSpeakerPlayback();
  const [progress, setProgress] = useState(0); // 0..1 of the tune played
  const onScreen = useWindowShown();
  // The song-length line: one frame loop only while playing and on screen;
  // it catches up from the start time when the window comes back.
  // lifetime: OK — cleanup: cancels the frame loop; runs only while playing and shown
  useEffect(() => {
    if (!playing || !startedAt || !onScreen) return;
    const length = duration * 1000;
    // lifetime: OK — cancelled in the effect cleanup (stop, hidden, unmount)
    let frame = requestAnimationFrame(function tick() {
      setProgress(Math.min(1, Math.round(((Date.now() - startedAt) / length) * 1000) / 1000));
      // lifetime: OK — re-armed per frame; the effect cleanup cancels the latest
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, startedAt, duration, onScreen]);
  const played = playing && startedAt ? progress : 0;
  return (
    <section className="dk-card">
      <h2>{t("desktop.audioTest.speakerTitle")}</h2>
      <p className="dk-hint">{t("desktop.audioTest.speakerHint")}</p>
      <div className="dk-stack">
        <div className="dk-row-btns">
          <BusyButton className="dk-btn" onClick={startSpeakerTest} countdown={Math.ceil(duration)} onStop={stopSpeakerTest} since={playing ? startedAt || null : null}>
            {t("desktop.audioTest.speakerButton")}
          </BusyButton>
          {playing && (
            <button type="button" className="dk-btn" onClick={stopSpeakerTest}>
              {t("desktop.common.stop", "Stop")}
            </button>
          )}
        </div>
        <div className="live-level" role="progressbar" aria-label={t("desktop.audioTest.speakerTitle")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(played * 100)}>
          <Meter value={played} />
        </div>
      </div>
      {noSpeaker && <p className="dk-hint">{t("desktop.audioTest.noSpeaker")}</p>}
    </section>
  );
}

// The microphone test (micTest.ts): one button starts and stops it; while it
// runs a segmented meter shows the controller's mic live, and with a headset
// in the controller (the input report's headset jack bit, as on Live data's
// Connection card) the mic is heard live on it. Without a headset there's no
// live sound (it would feed back on the speaker), nor with Audio output set to
// Speaker: Listen back plays the last 3 seconds, after the mic is closed. A status line always says what is
// happening, so silence with text is a visible error, never silence alone.
// Closing the panel or hiding the window stops everything. `level` (the Mic
// level slider) sits right under the meter, so a change shows on it live.
const VU_SEGMENTS = 20;
type MicPhase = "idle" | "starting" | "testing" | "stopping" | "playing";
// error: SHOWN — desktop.audioTest.problem.failed (the status line says desktop.audioTest.problem.<problem>)
type MicNote = { kind: "stopped" | "done" | "quiet" } | { kind: "problem"; problem: MicProblem } | null;

export function MicTest({ headset, output, level }: { headset: boolean; output: SpeakerSelect; level?: ReactNode }) {
  const { t } = useTranslation();
  const onScreen = useWindowShown();
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [note, setNote] = useState<MicNote>(null);
  const [lit, setLit] = useState(0); // meter segments lit, 0..VU_SEGMENTS
  const [played, setPlayed] = useState(0); // 0..1 of the clip played
  const [playing, setPlaying] = useState<{ since: number; seconds: number } | null>(null);
  const [hasClip, setHasClip] = useState(false);
  const session = useRef<MicSession | null>(null);
  const clip = useRef<MicClip | null>(null);
  const playback = useRef<AbortController | null>(null);
  const run = useRef(0); // bumps on every start/stop, so a late answer is ignored

  // Closes the mic (keeping the last seconds for Listen back) and any playback.
  const stopAll = useCallback(async (): Promise<void> => {
    run.current++;
    playback.current?.abort();
    playback.current = null;
    const s = session.current;
    session.current = null;
    setLit(0);
    if (!s) return;
    const kept = await s.stop();
    if (kept) clip.current = kept;
    setHasClip(clip.current !== null);
  }, []);
  // lifetime: OK — cleanup: closes the mic session and any playback on unmount
  useEffect(() => () => void stopAll().catch(logged("closing the mic test on unmount")), [stopAll]);
  // lifetime: OK — acquires nothing (closes the mic test when the window hides)
  useEffect(() => {
    if (onScreen) return;
    stopAll()
      .then(() => setPhase("idle"))
      .catch(logged("closing the mic test when the window hides"));
  }, [onScreen, stopAll]);
  // An unexpected failure still ends on a status line, never silence alone.
  const failed = (cause: unknown) => {
    logged("the mic test")(cause);
    setNote({ kind: "problem", problem: "failed" });
    setPhase("idle");
  };

  const start = async () => {
    await stopAll();
    const id = ++run.current;
    setNote(null);
    setPhase("starting");
    const r = await startMicTest(() => {
      if (run.current !== id) return;
      stopAll()
        .then(() => {
          setNote({ kind: "problem", problem: "lost" });
          setPhase("idle");
        })
        // error: SHOWN — desktop.audioTest.problem.failed
        .catch(failed);
    });
    if ("problem" in r) {
      if (run.current === id) {
        setNote({ kind: "problem", problem: r.problem });
        setPhase("idle");
      }
      return;
    }
    if (run.current !== id) return void r.session.stop().catch(logged("closing a mic test that was replaced"));
    session.current = r.session;
    setPhase("testing");
  };
  const stopTest = async () => {
    setPhase("stopping");
    await stopAll();
    setNote({ kind: "stopped" });
    setPhase("idle");
  };
  const listen = async () => {
    setPhase("stopping");
    await stopAll(); // the mic is closed and the clip in hand before anything plays
    const kept = clip.current;
    if (!kept) {
      setNote({ kind: "problem", problem: "failed" });
      return setPhase("idle");
    }
    const id = run.current;
    const ctl = new AbortController();
    playback.current = ctl;
    setNote(null);
    setPlayed(0);
    setPhase("playing");
    const r = await listenBack(kept, ctl.signal, (seconds) => setPlaying({ since: Date.now(), seconds }));
    if (run.current !== id || ctl.signal.aborted) return;
    playback.current = null;
    setPlaying(null);
    setNote(r.problem ? { kind: "problem", problem: r.problem } : { kind: r.quiet ? "quiet" : "done" });
    setPhase("idle");
  };

  // The live loopback: on only with a headset that Audio output plays to,
  // and follows it being plugged in or out (or the setting changing).
  const loopback = headset && (output === 0 || output === 2);
  // lifetime: OK — acquires nothing (switches the live session's loopback)
  useEffect(() => {
    if (phase === "testing") session.current?.setLoopback(loopback);
  }, [phase, loopback]);
  // The meter: one frame loop only while testing and on screen; a new React
  // render only when the number of lit segments changes.
  // lifetime: OK — cleanup: cancels the meter's frame loop (testing and shown only)
  useEffect(() => {
    if (phase !== "testing" || !onScreen) return;
    // lifetime: OK — cancelled in the effect cleanup (stop, hidden, unmount)
    let frame = requestAnimationFrame(function tick() {
      const level = session.current?.level() ?? 0;
      setLit(Math.min(VU_SEGMENTS, Math.round(Math.sqrt(level) * VU_SEGMENTS)));
      // lifetime: OK — re-armed per frame; the effect cleanup cancels the latest
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, onScreen]);
  // The playback line, the same way.
  // lifetime: OK — cleanup: cancels the playback line's frame loop (playing and shown only)
  useEffect(() => {
    if (phase !== "playing" || !playing || !onScreen) return;
    // lifetime: OK — cancelled in the effect cleanup (stop, hidden, unmount)
    let frame = requestAnimationFrame(function tick() {
      setPlayed(Math.min(1, Math.round(((Date.now() - playing.since) / (playing.seconds * 1000)) * 100) / 100));
      // lifetime: OK — re-armed per frame; the effect cleanup cancels the latest
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, playing, onScreen]);

  const running = phase !== "idle";
  const status =
    phase === "starting"
      ? t("desktop.audioTest.micStarting")
      : phase === "testing"
        ? t(output === 3 ? "desktop.audioTest.micOutputOff" : loopback ? "desktop.audioTest.micLive" : headset ? "desktop.audioTest.micNoLiveSpeaker" : "desktop.audioTest.micNoLive")
        : phase === "stopping"
          ? t("desktop.audioTest.micStopping")
          : phase === "playing"
            ? t("desktop.audioTest.playingBack")
            : note?.kind === "problem"
              ? t(`desktop.audioTest.problem.${note.problem}`)
              : note?.kind === "stopped"
                ? t(hasClip ? "desktop.audioTest.micStopped" : "desktop.audioTest.micStoppedNoClip", { seconds: LISTEN_SECONDS })
                : note?.kind === "done"
                  ? `✓ ${t("desktop.audioTest.micDone")}`
                  : note?.kind === "quiet"
                    ? t("desktop.audioTest.micQuiet")
                    : "";
  return (
    <section className="dk-card">
      <h2>{t("desktop.audioTest.micTitle")}</h2>
      <p className="dk-hint">{t("desktop.audioTest.micHint", { seconds: LISTEN_SECONDS })}</p>
      <div className="mic-test-row">
        {/* error: SHOWN — desktop.audioTest.problem.failed (failed() ends on the status line) */}
        <button type="button" className="dk-btn" aria-pressed={running} onClick={() => void (running ? stopTest() : start()).catch(failed)}>
          {running ? t("desktop.audioTest.micStop") : t("desktop.audioTest.micButton")}
        </button>
        <div className="mic-vu" role="meter" aria-label={t("desktop.audioTest.micLevel")} aria-valuemin={0} aria-valuemax={VU_SEGMENTS} aria-valuenow={lit} data-on={phase === "testing" || undefined}>
          {Array.from({ length: VU_SEGMENTS }, (_, i) => (
            <i key={i} data-lit={i < lit || undefined} data-zone={i >= VU_SEGMENTS * 0.9 ? "bad" : i >= VU_SEGMENTS * 0.7 ? "warn" : undefined} />
          ))}
        </div>
      </div>
      {level}
      {(phase === "testing" || (phase === "idle" && hasClip)) && (
        <div className="dk-row-btns">
          {/* error: SHOWN — desktop.audioTest.problem.failed (failed() ends on the status line) */}
          <button type="button" className="dk-btn" onClick={() => void listen().catch(failed)}>
            {t("desktop.audioTest.listenBack", { seconds: LISTEN_SECONDS })}
          </button>
        </div>
      )}
      {phase === "playing" && (
        <div className="live-level" role="progressbar" aria-label={t("desktop.audioTest.playingBack")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(played * 100)}>
          <Meter value={played} />
        </div>
      )}
      <p
        className={note?.kind === "problem" && phase === "idle" ? "dk-bad mic-status" : note?.kind === "done" && phase === "idle" ? "dk-good mic-status" : "mic-status"}
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </section>
  );
}

function BackdropSetting() {
  const { t } = useTranslation();
  const [background, setBackground] = useBackground();
  return (
    <Row label={t("desktop.backdrop.label")} sub={t(`desktop.backdrop.sub.${background}`)}>
      <select className="dk-select" aria-label={t("desktop.backdrop.label")} value={background} onChange={(e) => setBackground(e.target.value as Background)}>
        {/* loop: HOT-PATH-OK — N = 3 backgrounds per render */}
        {BACKGROUNDS.map((b) => (
          <option key={b} value={b}>
            {t(`desktop.backdrop.${b}`)}
          </option>
        ))}
      </select>
    </Row>
  );
}

// The app's style: Standard (solid surfaces) or Glass (Liquid Glass on the
// rail, save bar and settings panel).
function GlassSetting() {
  const { t } = useTranslation();
  const [on, setOn] = useFlagPref(GLASS_KEY);
  return (
    <Row label={t("desktop.glass.label")} sub={t("desktop.glass.sub")}>
      <select className="dk-select" aria-label={t("desktop.glass.label")} value={on ? "glass" : "standard"} onChange={(e) => setOn(e.target.value === "glass")}>
        <option value="standard">{t("desktop.glass.standard")}</option>
        <option value="glass">{t("desktop.glass.glass")}</option>
      </select>
    </Row>
  );
}

// My controller's colors: the player's own colors for the drawing's part
// groups (custom and modded shells), on top of the detected colorway. Only the
// parts they change are replaced; outlines are kept readable (customColors.ts).
function CustomColorsSetting() {
  const { t } = useTranslation();
  const { on, setOn, colors, setColors } = useCustomColors();
  const detected = colorway(useControllerCode())?.colors ?? null;
  const base = detected ?? FALLBACK_BASE;
  const merged = mergeColors(base, colors) ?? base;
  // The outline the player sees isn't the one they picked (or the colorway's):
  // it was pushed lighter or darker to stay visible.
  const lineAdjusted = merged.line !== (colors.line ?? base.line);
  return (
    <>
      <h3 className="dk-subhead">{t("desktop.customColors.title")}</h3>
      <Toggle label={t("desktop.customColors.toggle")} sub={t("desktop.customColors.toggleSub")} value={on} onChange={setOn} />
      {on && (
        <>
          {/* loop: HOT-PATH-OK — N = 6 color parts per render */}
          {COLOR_PARTS.map((part) => (
            <Row key={part} label={t(`desktop.customColors.part.${part}`)} sub={part === "dark" || part === "cap" ? t(`desktop.customColors.partSub.${part}`) : undefined}>
              <ColorPicker label={t(`desktop.customColors.part.${part}`)} value={colors[part] ?? base[part]} onChange={(hex) => setColors({ ...colors, [part]: hex })} />
            </Row>
          ))}
          {lineAdjusted && <p className="dk-hint">{t("desktop.customColors.lineAdjusted")}</p>}
          <div className="dk-row-btns">
            <button type="button" className="dk-btn" disabled={!detected} onClick={() => detected && setColors({ ...detected })}>
              {t("desktop.customColors.fromColorway")}
            </button>
            <button type="button" className="dk-btn" disabled={!hasCustomColors(colors)} onClick={() => setColors({})}>
              {t("desktop.customColors.reset")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function AccentSetting() {
  const { t } = useTranslation();
  const [choice, setChoice] = usePref(ACCENT_KEY, "controller", ACCENTS);
  // Desktop, but no accent could be read: say so instead of a silent theme accent.
  const unreadable = useDesktopAccentUnreadable() && choice === "desktop";
  return (
    <Row label={t("desktop.accent.label")} sub={t(unreadable ? "desktop.accent.unreadable" : "desktop.accent.sub")} invalid={unreadable}>
      <select className="dk-select" aria-label={t("desktop.accent.label")} value={choice} onChange={(e) => setChoice(e.target.value as (typeof ACCENTS)[number])}>
        {/* loop: HOT-PATH-OK — N = 2 accents per render */}
        {ACCENTS.map((a) => (
          <option key={a} value={a}>
            {t(`desktop.accent.${a}`)}
          </option>
        ))}
      </select>
    </Row>
  );
}

// The app's own "reduce motion" (also on when the system asks): no moving
// background, pulsing, wobble or animated transitions.
function ReduceMotionSetting() {
  const { t } = useTranslation();
  const [on, setOn] = useFlagPref(REDUCE_MOTION_KEY);
  return <Toggle label={t("desktop.settings2.reduceMotion")} sub={t("desktop.settings2.reduceMotionSub")} value={on} onChange={setOn} />;
}

// Joining the Development channel: before any dev update is offered (app or
// dongle firmware), say what it means and what's in the newest dev build.
// With automatic checks off it goes online only when its check button is pressed.
export function DevChannelDialog({ automatic, onJoin, onCancel }: { automatic: boolean; onJoin: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<DevChannelPreview | null | "loading" | "ask">(automatic ? "loading" : "ask");
  const [asked, setAsked] = useState(false);
  const check = () => {
    setPreview("loading");
    setAsked(true);
  };
  // lifetime: OK — cleanup: drops a late preview (holds no resource)
  useEffect(() => {
    if (!automatic && !asked) return;
    let live = true;
    // error: SHOWN — desktop.channel.joinOffline
    window.desktop?.devChannelPreview(asked).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [automatic, asked]);
  // lifetime: OK — cleanup: removes the Escape listener (dialog closed / onCancel change)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dk-dialog-backdrop" onClick={onCancel}>
      <section className="dk-card dk-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-join-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dev-join-title">{t("desktop.channel.joinTitle")}</h2>
        <ul className="dk-review">
          <li>{t("desktop.channel.joinNewer")}</li>
          <li>{t("desktop.channel.joinBoth")}</li>
          <li>{t("desktop.channel.joinBugs")}</li>
          <li>{t("desktop.channel.joinBack")}</li>
        </ul>
        <h3>{t("desktop.channel.joinLatest")}</h3>
        {preview === "ask" ? (
          <div className="dk-row-btns">
            <span className="dk-hint">{t("desktop.channel.joinCheckOff")}</span>
            <button type="button" className="dk-btn" onClick={check}>
              {t("desktop.channel.joinCheck")}
            </button>
          </div>
        ) : preview === "loading" ? (
          <p className="dk-hint">{t("desktop.channel.joinLoading")}</p>
        ) : preview ? (
          <>
            <p>{t("desktop.channel.joinVersions", { app: preview.app, firmware: preview.firmware ?? "—" })}</p>
            <div className="dk-dialog-notes">{preview.notes ? <Markdown text={preview.notes} /> : <p className="dk-hint">{t("desktop.channel.joinNoNotes")}</p>}</div>
            {preview.notesUrl && (
              <p>
                <a href={preview.notesUrl} target="_blank" rel="noreferrer">
                  {t("desktop.channel.joinNotesLink")}
                </a>
              </p>
            )}
          </>
        ) : (
          <p className="dk-hint">{t("desktop.channel.joinOffline")}</p>
        )}
        <div className="dk-row-btns">
          <button type="button" className="dk-btn primary" onClick={onJoin}>
            {t("desktop.channel.joinButton")}
          </button>
          <button type="button" className="dk-btn" onClick={onCancel} autoFocus>
            {t("desktop.channel.stayButton")}
          </button>
        </div>
      </section>
    </div>
  );
}

// Developer (Ctrl+Shift+D): preview any controller model and colorway. Only
// on the Development channel (and only in builds that include it), right
// under the channel switch, so switching shows it appear.
function DeveloperSettings({ devChannel }: { devChannel: boolean }) {
  const { t } = useTranslation();
  const [onScreen] = useDevToolsShown();
  const dev = useDevPreview();
  const [updatePreview, setUpdatePreview] = useUpdatePreview();
  const fakeSlots = useFakeSlots();
  const [simulated] = useFlagPref(SIMULATED_KEY);
  const [simCore1] = usePref<(typeof SIM_CORE1_STAGES)[number]>(SIM_CORE1_KEY, "", SIM_CORE1_STAGES);
  if (!onScreen || !devChannel) return null;
  const model = dev.model || "dualsense";
  const codes = MODEL_COLORWAYS[model];
  return (
    <section className="dk-card">
      <h2>{t("desktop.dev.title")}</h2>
      <p className="dk-hint">{t("desktop.dev.hint")}</p>
      <Row label={t("desktop.dev.model")}>
        <select
          className="dk-select"
          aria-label={t("desktop.dev.model")}
          value={dev.model}
          onChange={(e) => {
            const next = e.target.value as DevModel;
            dev.setModel(next);
            if (next && dev.colorway && !MODEL_COLORWAYS[next].includes(dev.colorway)) dev.setColorway("");
          }}
        >
          <option value="">{t("desktop.dev.real")}</option>
          <option value="dualsense">DualSense</option>
          <option value="edge">DualSense Edge</option>
        </select>
      </Row>
      <Row label={t("desktop.dev.colorway")}>
        <select className="dk-select" aria-label={t("desktop.dev.colorway")} value={dev.colorway} onChange={(e) => dev.setColorway(e.target.value)}>
          <option value="">{t("desktop.dev.real")}</option>
          {/* loop: HOT-PATH-OK — N ≈ 40 colorway codes, Developer card only (dev builds) */}
          {codes.map((code) => (
            <option key={code} value={code}>
              {COLORWAYS[code].name}
              {COLORWAYS[code].colors ? "" : ` (${t("desktop.dev.noArt")})`}
            </option>
          ))}
        </select>
      </Row>
      <Toggle
        label={t("desktop.dev.simulated")}
        sub={t("desktop.dev.simulatedHint")}
        value={simulated}
        onChange={(on) => {
          writePref(SIMULATED_KEY, on ? "1" : "0");
          location.reload(); // reconnect to the simulation or the real dongle
        }}
      />
      {simulated && (
        <Row label={t("desktop.dev.simCore1")} sub={t("desktop.dev.simCore1Hint")}>
          <select
            className="dk-select"
            aria-label={t("desktop.dev.simCore1")}
            value={simCore1}
            onChange={(e) => {
              writePref(SIM_CORE1_KEY, e.target.value);
              location.reload(); // the simulated dongle takes it when it connects
            }}
          >
            {/* loop: HOT-PATH-OK — N = 10 stages, Developer card only */}
            {SIM_CORE1_STAGES.map((v) => (
              <option key={v} value={v}>
                {v === "" ? t("desktop.dev.simCore1Runs") : t("desktop.dev.simCore1Stage", { stage: v, step: t(`desktop.diag.core1Step.${v}`) })}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Toggle label={t("desktop.dev.fakeSlots")} sub={t("desktop.dev.fakeSlotsHint")} value={fakeSlots.on} onChange={fakeSlots.setOn} />
      <Row label={t("desktop.dev.updates")} sub={t("desktop.dev.updatesHint")}>
        <select className="dk-select" aria-label={t("desktop.dev.updates")} value={updatePreview} onChange={(e) => setUpdatePreview(e.target.value as UpdatePreview)}>
          {/* loop: HOT-PATH-OK — N = 4 previews, Developer card only */}
          {UPDATE_PREVIEWS.map((p) => (
            <option key={p} value={p}>
              {t(`desktop.dev.updatesState.${p || "off"}`)}
            </option>
          ))}
        </select>
      </Row>
      <div className="dk-row-btns">
        <button
          type="button"
          className="dk-btn"
          disabled={!dev.active}
          onClick={() => {
            dev.setModel("");
            dev.setColorway("");
          }}
        >
          {t("desktop.dev.reset")}
        </button>
      </div>
      <h3 className="dk-subhead">{t("desktop.dev.hdrTitle")}</h3>
      <HdrTest />
    </section>
  );
}

function KnobSlider({ k }: { k: Knob }) {
  const { t } = useTranslation();
  const [value, setValue] = useKnob(k);
  return <Slider label={t(`desktop.knobs.${k.key}`)} sub={t(`desktop.knobs.${k.key}Sub`)} value={value} min={k.min} max={k.max} step={k.step} unit={k.unit} onChange={setValue} />;
}
