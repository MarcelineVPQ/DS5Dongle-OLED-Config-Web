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
import { MODEL_COLORWAYS, SIMULATED_KEY, useDevPreview, useDevToolsShown, useFakeSlots, type DevModel } from "../devPreview";
import { UPDATE_PREVIEWS, useUpdatePreview, type UpdatePreview } from "../updatePreview";
import { REDUCE_MOTION_KEY } from "../motion";
import { ACCENT_KEY, ACCENTS, useControllerCode } from "./controllerAccent";
import { GLASS_KEY } from "../glass/glassPref";
import { BACKGROUNDS, useBackground, type Background } from "./ArtBackdrop";
import { writePref, useFlagPref, usePref } from "../storage";
import { controllerSpeaker } from "../narrator";
import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../../components/LanguageToggle";
import ThemeToggle from "../../components/ThemeToggle";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED, tablesEqual } from "../../protocol/remap";
import { useLibrary } from "../library/libraryContext";
import { buttonLabel, layoutSummary } from "./layoutSummary";
import type { DesktopSettings } from "../api";
import { BusyButton, Row, Segmented, Toggle, Slider } from "../controls";
import { COLOR_VISIONS, type ColorVision, setColorVision, useColorVision } from "../colorVision";
import { say, setCaptions, setNarrator, useCaptionsOn, useNarrator } from "../narrator";
import { TOUR_ENABLED, startTour } from "../tour/Tour";
import FirmwarePage from "../pages/FirmwarePage";
import LightbarPage from "../pages/LightbarPage";
import { AutoHapticsSection, DisplaySection, HapticsSection, MicSection, PowerSection, SpeakerSection, UsbSection } from "../pages/SettingsPage";
import SlotsPage from "../pages/SlotsPage";
import TriggersPage from "../pages/TriggersPage";
import { usePoll } from "../usePoll";
import type { FirmwareUpdate } from "../useUpdates";
import { REMAP_INDEX, type PartId } from "./parts";
import type { Remap } from "./useRemap";

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
  onHide: () => void;
}

export default function PartPanel({ view, bridge, fw, input, remap, onClose, onOpen, onCalibrate, onButtons, buttonFocus, onButtonFocus, onButtonHover, onHide }: Props) {
  const { t } = useTranslation();
  const title =
    view === "overview"
      ? t("desktop.live.overview", "Your controller")
      : view === "dongle"
        ? hardwareName(bridge.identity, t)
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
        <h2>{title}</h2>
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
      {view === "buttons" && <AllButtonsSection remap={remap} focus={buttonFocus} onFocus={onButtonFocus} onHover={onButtonHover} />}
      {view === "buttons" && remap.supported && <ButtonLayoutsSection remap={remap} />}
      {view === "calibration" && <Calibration bridge={bridge} input={input} />}
      {view === "dongle" && <DongleSections bridge={bridge} fw={fw} />}
      {view === "app" && <AppSettings />}
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
      {part === "mute" && <MicTest />}
      {part === "ps" && <SlotsPage bridge={bridge} />}
      {index !== undefined && <RemapSection index={index} remap={remap} onButtons={onButtons} />}
    </>
  );
}

function RemapSection({ index, remap, onButtons }: { index: number; remap: Remap; onButtons: (index?: number) => void }) {
  const { t } = useTranslation();
  const target = remap.draft[index];
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
              {REMAP_BUTTON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === index ? `${o.label} (${t("desktop.live.remapDefault", "default")})` : o.label}
                </option>
              ))}
              <option value={REMAP_DISABLED}>{t("remap.disabled")}</option>
            </select>
          </div>
          <p className="dk-hint">{t("desktop.live.remapHint", "Remaps are written to the dongle when you press Apply and work in every game, with no software on the PC.")}</p>
          <button type="button" className="dk-btn dk-btn-wrap" onClick={() => onButtons(index)}>
            {t("desktop.layouts.seeAll")}
          </button>
          {remap.error && <div className="dk-notice error">{remap.error}</div>}
          <div className="dk-row-btns">
            <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={remap.apply}>
              {t("desktop.live.remapApply", "Apply remap")}
            </BusyButton>
            <button type="button" className="dk-btn" disabled={!remap.dirty || remap.busy} onClick={remap.revert}>
              {t("desktop.bar.revert", "Revert")}
            </button>
            <button type="button" className="dk-btn" disabled={remap.busy} onClick={remap.resetAll} title={t("desktop.live.remapResetHint", "Every button back to itself")}>
              {t("desktop.live.remapReset", "Reset all")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Every button in one list (the same draft as clicking them on the drawing),
// with what's changed from the controller's own buttons marked.
function AllButtonsSection({ remap, focus, onFocus, onHover }: { remap: Remap; focus: number | null; onFocus: (i: number | null) => void; onHover: (i: number | null) => void }) {
  const { t } = useTranslation();
  const table = useRef<HTMLDivElement>(null);
  // A button picked on the drawing: its row scrolls into view and its picker
  // gets the focus, ready to change.
  useEffect(() => {
    if (focus === null) return;
    const sel = table.current?.querySelector<HTMLSelectElement>(`#all-remap-${focus}`);
    sel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    sel?.focus({ preventScroll: true });
  }, [focus]);
  useEffect(() => () => onHover(null), [onHover]);
  const changed = remap.draft.filter((v, i) => v !== i).length;
  // Editing a game's profile: the buttons go into that game's layout (switched
  // in while it plays), never into the normal buttons on the dongle.
  const { editing, library, setLibrary } = useLibrary();
  const profile = editing ? library.games[editing.gameKey]?.profile : undefined;
  const layoutId = profile?.settings.buttonLayout;
  const gameLayout = layoutId ? library.layouts?.[layoutId] : undefined;
  const saveToGameLayout = async () => {
    const desktop = window.desktop;
    if (!desktop || !editing || !profile) return;
    if (layoutId && gameLayout) {
      setLibrary(await desktop.librarySetLayout({ id: layoutId, name: gameLayout.name, table: remap.draft }));
      return;
    }
    const id = `l-${Date.now().toString(36)}`;
    await desktop.librarySetLayout({ id, name: editing.title.slice(0, 40), table: remap.draft });
    setLibrary(await desktop.librarySetProfile({ gameKey: editing.gameKey, title: editing.title, settings: { ...profile.settings, buttonLayout: id } }));
  };
  if (remap.supported === false)
    return (
      <section className="dk-card">
        <p className="dk-hint">{t("remap.unsupported")}</p>
      </section>
    );
  return (
    <section className="dk-card">
      <h2>{t("desktop.layouts.allHeading")}</h2>
      {editing && <div className="dk-notice">{t("desktop.editing.buttonsNote", { title: editing.title })}</div>}
      <LoadedLayout remap={remap} />
      <p className="dk-hint">{t("desktop.layouts.allHint", { count: changed })}</p>
      {remap.temporary && <div className="dk-notice">{t("desktop.layouts.activeNoticeShort")}</div>}
      <div className="dk-buttons-table" role="table" ref={table} onMouseLeave={() => onHover(null)}>
        {remap.draft.map((target, i) => {
          const isChanged = target !== i;
          const pending = target !== remap.device[i];
          return (
            <div key={i} role="row" className={`dk-buttons-row${isChanged ? " changed" : ""}${focus === i ? " focused" : ""}`} onMouseEnter={() => onHover(i)} onFocus={() => onFocus(i)}>
              <label role="rowheader" htmlFor={`all-remap-${i}`}>
                {isChanged && <span aria-hidden="true">● </span>}
                {buttonLabel(i)}
                {(pending || isChanged) && <small>{pending ? t("desktop.layouts.notApplied") : t("desktop.layouts.changed")}</small>}
              </label>
              <select
                id={`all-remap-${i}`}
                role="cell"
                className="dk-select"
                value={target}
                disabled={remap.busy || remap.supported !== true}
                onChange={(e) => remap.setTarget(i, Number(e.target.value))}
              >
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
      </div>
      {remap.error && <div className="dk-notice error">{remap.error}</div>}
      <div className="dk-row-btns">
        {editing ? (
          <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={saveToGameLayout}>
            {gameLayout ? t("desktop.editing.saveLayout", { name: gameLayout.name }) : t("desktop.editing.saveNewLayout")}
          </BusyButton>
        ) : (
          <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={remap.apply}>
            {t("desktop.live.remapApply", "Apply remap")}
          </BusyButton>
        )}
        <button type="button" className="dk-btn" disabled={!remap.dirty || remap.busy} onClick={remap.revert}>
          {t("desktop.bar.revert", "Revert")}
        </button>
        <button type="button" className="dk-btn" disabled={remap.busy} onClick={remap.resetAll} title={t("desktop.live.remapResetHint", "Every button back to itself")}>
          {t("desktop.live.remapReset", "Reset all")}
        </button>
      </div>
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
function ButtonLayoutsSection({ remap }: { remap: Remap }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const { library, setLibrary, active } = useLibrary();
  const [name, setName] = useState("");
  const layouts = Object.entries(library.layouts ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const usedBy = (id: string) => Object.values(library.games).filter((g) => g.profile?.settings.buttonLayout === id).length;
  if (!desktop) return null;
  const save = (id: string, layoutName: string) => void desktop.librarySetLayout({ id, name: layoutName, table: remap.draft }).then(setLibrary);
  return (
    <section className="dk-card">
      <h2>{t("desktop.layouts.title")}</h2>
      <p className="dk-hint">{t("desktop.layouts.hint")}</p>
      {remap.temporary && <div className="dk-notice">{t("desktop.layouts.activeNotice", { game: active?.title ?? t("desktop.layouts.aGame") })}</div>}
      {layouts.length === 0 ? (
        <p className="dk-hint">{t("desktop.layouts.none")}</p>
      ) : (
        <ul className="dk-layouts">
          {layouts.map(([id, l]) => (
            <li key={id} className={remap.loaded?.id === id ? "loaded" : undefined}>
              <div className="dk-layout-info">
                <span className="dk-layout-name" title={l.name}>
                  {l.name}
                </span>
                {remap.loaded?.id === id && <span className="dk-chip ok">{t("desktop.layouts.loadedChip")}</span>}
                {usedBy(id) > 0 && <span className="dk-hint"> · {t("desktop.layouts.usedBy", { count: usedBy(id) })}</span>}
                <span className="dk-layout-changes">{layoutSummary(l.table, t("desktop.layouts.off"), t("desktop.layouts.noChanges"))}</span>
              </div>
              <div className="dk-layout-btns">
                <button type="button" className="dk-btn" title={t("desktop.layouts.loadHint")} onClick={() => remap.load(l.table, { id, name: l.name })}>
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
                <button type="button" className="dk-btn danger" title={t("desktop.layouts.deleteHint")} onClick={() => void desktop.libraryDeleteLayout(id).then(setLibrary)}>
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
      <span style={{ width: pct(value) }} />
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

function TouchLive({ input }: { input: InputReport | null }) {
  const { t } = useTranslation();
  const touching = input?.fingers.filter((f) => f.touching) ?? [];
  return (
    <section className="dk-card">
      <p className="dk-hint">{t("desktop.live.touchHint", "Touch the touchpad to see your fingers here. There's nothing to set up for it.")}</p>
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
      <h2>{which === "speaker" ? t("desktop.live.speakerLevel", "Speaker level now") : t("desktop.live.hapticLevel", "Haptics level now")}</h2>
      <div className="live-level">
        <Meter value={level} hold={held} />
        <span className="live-level-pct">{Math.round(level * 100)}%</span>
      </div>
      <p className="dk-hint">{silent ? t(which === "speaker" ? "desktop.live.speakerSilent" : "desktop.live.hapticSilent") : t("desktop.live.levelLive")}</p>
    </section>
  );
}

function DongleSections({ bridge, fw }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate }) {
  return (
    <>
      <FirmwarePage bridge={bridge} fw={fw} />
      <PowerSection bridge={bridge} />
      <DisplaySection bridge={bridge} />
      <UsbSection bridge={bridge} />
    </>
  );
}

// The app's own settings (stored by the main process), plus theme and language.
function AppSettings() {
  // Joining the Development channel asks first (what it means, what's in it).
  const [joiningDev, setJoiningDev] = useState(false);
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [gpuChanged, setGpuChanged] = useState(false);
  const [hdrChanged, setHdrChanged] = useState(false);
  useEffect(() => {
    void window.desktop?.getSettings().then(setSettings);
  }, []);
  const set = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => void window.desktop?.setSetting(key, value).then(setSettings);
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
          <section className="dk-card">
            <h2>{t("desktop.settings2.advanced")}</h2>
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
            <Toggle
              label={t("desktop.live.hardwareAcceleration")}
              sub={gpuChanged ? t("desktop.live.restartToApply") : t("desktop.live.hardwareAccelerationSub")}
              value={settings.hardwareAcceleration}
              onChange={(v) => {
                setGpuChanged(true);
                set("hardwareAcceleration", v);
              }}
            />
          </section>
          <section className="dk-card">
            <h2>{t("desktop.settings2.updates")}</h2>
            <Toggle label={t("desktop.live.checkForUpdates")} value={settings.checkForUpdates} onChange={(v) => set("checkForUpdates", v)} />
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
                onJoin={() => {
                  setJoiningDev(false);
                  set("updateChannel", "dev");
                }}
                onCancel={() => setJoiningDev(false)}
              />
            )}
            <p className="dk-hint">{settings.updateChannel === "dev" ? t("desktop.channel.devHint") : t("desktop.channel.stableHint")}</p>
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

// Colour-blind-safe palettes for the app's status colours and graphs.
function ColorVisionSetting() {
  const { t } = useTranslation();
  const cv = useColorVision();
  return (
    <Row label={t("desktop.colorVision.label")} sub={t("desktop.colorVision.sub")}>
      <select className="dk-select" aria-label={t("desktop.colorVision.label")} value={cv} onChange={(e) => setColorVision(e.target.value as ColorVision)}>
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
        <button type="button" className="dk-btn" disabled={voice !== "on"} onClick={() => void say("app_controller", { cut: true })}>
          {t("desktop.narrator.test", "Test the voice")}
        </button>
      </div>
    </>
  );
}

// A short two-note chime on the controller's speaker (never the PC's): made
// on the spot with Web Audio and routed to the DualSense output.
function SpeakerTest() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "playing" | "none">("idle");
  const play = async () => {
    const sink = await controllerSpeaker();
    if (!sink) return setState("none");
    setState("playing");
    const ctx = new AudioContext();
    try {
      await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(sink);
      const now = ctx.currentTime;
      for (const [i, freq] of [660, 880, 1320].entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        const at = now + i * 0.22;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.35, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      }
      await new Promise((r) => setTimeout(r, 1200));
      setState("idle");
    } catch {
      setState("none"); // couldn't route to the controller: stay silent
    } finally {
      void ctx.close();
    }
  };
  return (
    <section className="dk-card">
      <h2>{t("desktop.audioTest.speakerTitle")}</h2>
      <p className="dk-hint">{t("desktop.audioTest.speakerHint")}</p>
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" disabled={state === "playing"} onClick={() => void play()}>
          {state === "playing" ? t("desktop.audioTest.playing") : t("desktop.audioTest.speakerButton")}
        </button>
      </div>
      {state === "none" && <p className="dk-hint">{t("desktop.audioTest.noSpeaker")}</p>}
    </section>
  );
}

// Records 3 s from the controller's mic and plays it back on its speaker
// (main process, Linux), with the level while recording.
function MicTest() {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [phase, setPhase] = useState<"idle" | "recording" | "playing" | "done" | "quiet" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  useEffect(() => desktop.onMicLevel(setLevel), [desktop]);
  const run = async () => {
    setProblem(null);
    setPhase("recording");
    // The main process reports levels while recording, then plays it back.
    const playingSoon = setTimeout(() => setPhase((p) => (p === "recording" ? "playing" : p)), 3100);
    try {
      const r = await desktop.micTest();
      clearTimeout(playingSoon);
      if (!r.ok) {
        setProblem(r.problem ?? "failed");
        setPhase("error");
      } else setPhase(r.peak < 0.02 ? "quiet" : "done");
    } catch {
      clearTimeout(playingSoon);
      setProblem("failed");
      setPhase("error");
    }
  };
  const busy = phase === "recording" || phase === "playing";
  return (
    <section className="dk-card">
      <h2>{t("desktop.audioTest.micTitle")}</h2>
      <p className="dk-hint">{t("desktop.audioTest.micHint")}</p>
      {phase === "recording" && (
        <div className="live-level">
          <Meter value={level} />
          <span className="live-level-pct">{Math.round(level * 100)}%</span>
        </div>
      )}
      <div className="dk-row-btns">
        <button type="button" className="dk-btn" disabled={busy} onClick={() => void run()}>
          {phase === "recording" ? t("desktop.audioTest.recording") : phase === "playing" ? t("desktop.audioTest.playingBack") : t("desktop.audioTest.micButton")}
        </button>
      </div>
      {phase === "done" && <p className="dk-good">✓ {t("desktop.audioTest.micDone")}</p>}
      {phase === "quiet" && <p className="dk-hint">{t("desktop.audioTest.micQuiet")}</p>}
      {phase === "error" && <p className="dk-hint">{t(`desktop.audioTest.problem.${problem ?? "failed"}`)}</p>}
    </section>
  );
}

function BackdropSetting() {
  const { t } = useTranslation();
  const [background, setBackground] = useBackground();
  return (
    <Row label={t("desktop.backdrop.label")} sub={t(`desktop.backdrop.sub.${background}`)}>
      <select className="dk-select" aria-label={t("desktop.backdrop.label")} value={background} onChange={(e) => setBackground(e.target.value as Background)}>
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
          {COLOR_PARTS.map((part) => (
            <Row key={part} label={t(`desktop.customColors.part.${part}`)} sub={part === "dark" || part === "cap" ? t(`desktop.customColors.partSub.${part}`) : undefined}>
              <input type="color" aria-label={t(`desktop.customColors.part.${part}`)} value={colors[part] ?? base[part]} onChange={(e) => setColors({ ...colors, [part]: e.currentTarget.value })} />
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

function AccentSetting() {
  const { t } = useTranslation();
  const [choice, setChoice] = usePref(ACCENT_KEY, "controller", ACCENTS);
  return (
    <Row label={t("desktop.accent.label")} sub={t("desktop.accent.sub")}>
      <select className="dk-select" aria-label={t("desktop.accent.label")} value={choice} onChange={(e) => setChoice(e.target.value as (typeof ACCENTS)[number])}>
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
function DevChannelDialog({ onJoin, onCancel }: { onJoin: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<DevChannelPreview | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    void window.desktop?.devChannelPreview().then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
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
        {preview === "loading" ? (
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
  const [shown] = useDevToolsShown();
  const dev = useDevPreview();
  const [updatePreview, setUpdatePreview] = useUpdatePreview();
  const fakeSlots = useFakeSlots();
  const [simulated] = useFlagPref(SIMULATED_KEY);
  if (!shown || !devChannel) return null;
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
      <Toggle label={t("desktop.dev.fakeSlots")} sub={t("desktop.dev.fakeSlotsHint")} value={fakeSlots.on} onChange={fakeSlots.setOn} />
      <Row label={t("desktop.dev.updates")} sub={t("desktop.dev.updatesHint")}>
        <select className="dk-select" aria-label={t("desktop.dev.updates")} value={updatePreview} onChange={(e) => setUpdatePreview(e.target.value as UpdatePreview)}>
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
