// The Controller page's accordion (its panel at the right of the drawing):
// one Section per thing to set up, each with a live status in its header.
// Clicking a part of the drawing opens its section (ControllerView); the
// section bodies are functions, so a folded section renders nothing and its
// polls (the level meters, the slot list) and tests stop.
import { HeadsetStereo } from "./HeadsetStereo";
import { Bluetooth, Gamepad2, Lightbulb, Mic, MoveDown, Volume2, AudioWaveform, Joystick } from "lucide-react";
import Calibration from "./Calibration";
import { startSpeakerTest, stopSpeakerTest, useSpeakerPlayback } from "./speakerPlayer";
import { LISTEN_SECONDS, listenBack, startMicTest, type MicClip, type MicProblem, type MicSession } from "./micTest";
import { useWindowShown } from "../useWindowShown";
import { memo, useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED, REMAP_EXTRA_OFF, REMAP_EXTRA_SELF, tablesEqual } from "../../protocol/remap";
import { useLibrary, useProfileTarget } from "../library/libraryContext";
import { buttonLabel, layoutSummary } from "./layoutSummary";
import type { SpeakerSelect } from "../../protocol/config";
import { BusyButton, Row } from "../controls";
import LightbarPage, { LIGHTBAR_MODES } from "../pages/LightbarPage";
import { AutoHapticsSection, EchoCancelToggle, HapticsSection, MicLevelSlider, MicSection, SpeakerSection, TriggerIntensitySection } from "../pages/SettingsPage";
import SlotsPage from "../pages/SlotsPage";
import TriggersPage from "../pages/TriggersPage";
import { usePoll } from "../usePoll";
import { EDGE_REMAP_ROWS } from "./parts";
import type { Remap } from "./useRemap";
import { named, onOff } from "../accordion/status";
import { Section, SectionGroup } from "../accordion/Section";
import { logged } from "../../errorText";
import { shown } from "../shownError";
import Notice from "../Notice";

interface Props {
  bridge: UseDs5BridgeResult;
  input: InputReport | null;
  remap: Remap;
  // The Buttons list: the focused row (also lit on the drawing) and hovers.
  buttonFocus: number | null;
  onButtonFocus: (index: number | null) => void;
  onButtonHover: (index: number | null) => void;
  edge: boolean; // a DualSense Edge (or its preview): the Buttons list adds its Fn buttons and paddles
  trigger: "l2" | "r2"; // the trigger picked last on the drawing: its pull shows first
}

const CHOICES = ["auto", "speaker", "headset", "off"] as const;
const MICS = ["auto", "builtIn", "headset"] as const;
const AH_MODES = ["off", "fallback", "mix", "replace"] as const;

export default function ControllerSections({ bridge, input, remap, buttonFocus, onButtonFocus, onButtonHover, edge, trigger }: Props) {
  const { t } = useTranslation();
  const d = bridge.draft;
  // loop: HOT-PATH-OK — N = 9 light bar modes; per render of the panel
  const mode = LIGHTBAR_MODES.find((m) => m.value === d.lightbarMode);
  // loop: HOT-PATH-OK — N = 16 + 4 remap slots; per render of the panel
  const changed = remap.draft.filter((v, i) => v !== i).length + (edge && remap.extraDevice ? remap.extraDraft.filter((v) => v !== REMAP_EXTRA_SELF).length : 0);
  const { library } = useLibrary();
  const loaded = remap.loaded ? (library.layouts?.[remap.loaded.id]?.name ?? remap.loaded.name) : null;
  const slot = bridge.identity?.currentSlot;
  const gains = bridge.client?.splitHaptics ? `L ${d.hapticsGain.toFixed(1)}× · R ${d.hapticsGainRight.toFixed(1)}×` : `${d.hapticsGain.toFixed(1)}×`;
  return (
    <>
      <Section id="lightbar" icon={Lightbulb} title={t("desktop.sections.lightbar")} status={mode ? t(`desktop.lightbar.modes.${mode.key}`) : null}>
        {() => <LightbarPage bridge={bridge} />}
      </Section>
      <Section id="triggers" icon={MoveDown} title={t("desktop.sections.triggers")} status={named(t, t("desktop.settings.triggerReduce"), d.triggerReduce)}>
        {() => (
          <>
            <TriggerLive input={input} side={trigger} />
            <TriggerIntensitySection bridge={bridge} />
            <TriggersPage bridge={bridge} />
          </>
        )}
      </Section>
      <Section
        id="haptics"
        icon={AudioWaveform}
        title={t("desktop.sections.haptics")}
        status={[gains, named(t, t("autoHaptics.sectionTitle"), t(`autoHaptics.modes.${AH_MODES[d.autoHapticsEnable & 3]}.label`))].join(" · ")}
      >
        {() => (
          <>
            <HapticsSection bridge={bridge} />
            <LevelMeter bridge={bridge} which="haptic" />
            <SectionGroup title={t("autoHaptics.sectionTitle")}>
              <AutoHapticsSection bridge={bridge} />
            </SectionGroup>
          </>
        )}
      </Section>
      <Section
        id="speaker"
        icon={Volume2}
        title={t("desktop.sections.speaker")}
        status={[`${d.speakerVolume > 0 ? "+" : ""}${d.speakerVolume} dB`, named(t, t("desktop.settings.audioOutput"), t(`desktop.settings.choice.${CHOICES[d.speakerSelect & 3]}`))].join(" · ")}
      >
        {() => (
          <>
            <SpeakerSection bridge={bridge} />
            <HeadsetStereo />
            <LevelMeter bridge={bridge} which="speaker" />
            <SpeakerTest />
          </>
        )}
      </Section>
      <Section
        id="mic"
        icon={Mic}
        title={t("desktop.sections.mic")}
        status={
          d.btMicEnable
            ? [t(`desktop.settings.choice.${MICS[Math.min(2, d.micSelect)]}`), named(t, t("desktop.settings.micLevel"), d.micLevel), onOff(t, t("desktop.settings.echoCancel"), d.micEchoCancel)].join(
                " · ",
              )
            : onOff(t, t("haptics.btMicLabel"), false)
        }
      >
        {() => (
          <>
            <MicSection bridge={bridge} />
            <MicTest
              headset={input?.headphones ?? false}
              output={d.speakerSelect}
              level={
                <>
                  <MicLevelSlider bridge={bridge} />
                  <EchoCancelToggle bridge={bridge} />
                </>
              }
            />
          </>
        )}
      </Section>
      <Section
        id="buttons"
        icon={Gamepad2}
        title={t("desktop.sections.buttons")}
        status={loaded ?? (changed ? t("desktop.accordion.buttonsChanged", { count: changed }) : t("desktop.layouts.normal"))}
      >
        {() => (
          <>
            <AllButtonsList remap={remap} focus={buttonFocus} onFocus={onButtonFocus} onHover={onButtonHover} edge={edge} />
            {edge && !remap.extraDevice && <EdgePartInfo />}
            <TouchLive input={input} />
            {remap.supported && <SavedLayouts remap={remap} />}
          </>
        )}
      </Section>
      <Section id="sticks" icon={Joystick} title={t("desktop.sections.sticks")} status={slot !== undefined ? named(t, t("desktop.overview.slot"), slot) : null}>
        {() => <Calibration bridge={bridge} input={input} />}
      </Section>
      <Section id="slots" icon={Bluetooth} title={t("desktop.sections.slots")} status={slot !== undefined ? t("desktop.accordion.slotActive", { slot }) : null}>
        {() => <SlotsPage bridge={bridge} />}
      </Section>
    </>
  );
}

// The remap actions under the button pickers: Save to profile while a
// game's profile is on (the buttons go into its layout), else Apply remap;
// a failed apply's error above them.
function RemapActions({ remap, onSave }: { remap: Remap; onSave: (() => Promise<unknown>) | null }) {
  const { t } = useTranslation();
  return (
    <>
      {remap.error && (
        <Notice error onDismiss={remap.clearError}>
          {remap.error}
        </Notice>
      )}
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
    </>
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
  // hint: MUST-SHOW — why there's nothing to assign: what to update
  if (remap.supported === false) return <p className="dk-hint">{t("remap.unsupported")}</p>;
  return (
    <>
      {target && <Notice closable>{t("desktop.editing.buttonsNote", { title: target.title })}</Notice>}
      <LoadedLayout remap={remap} />
      <p className="dk-hint">{t("desktop.layouts.allHint", { count: changed })}</p>
      {remap.temporary && !target && <Notice closable>{t("desktop.layouts.activeNotice", { game: active?.title ?? t("desktop.layouts.aGame") })}</Notice>}
      <div className="dk-buttons-table" ref={table} onMouseLeave={() => onHover(null)}>
        {/* loop: HOT-PATH-OK — N = 16 rows; memo()ed, re-renders on a remap or focus change, not per live frame */}
        {remap.draft.map((target, i) => {
          const isChanged = target !== i;
          const pending = target !== remap.device[i];
          const name = buttonLabel(i);
          return (
            <div key={i} className={`dk-buttons-row${isChanged ? " changed" : ""}${focus === i ? " focused" : ""}`} onMouseEnter={() => onHover(i)} onFocus={() => onFocus(i)}>
              <Row id={`btn-${i}`} label={`${isChanged ? "● " : ""}${name}`} sub={pending || isChanged ? (pending ? pendingLabel : t("desktop.layouts.changed")) : undefined}>
                <select
                  id={`all-remap-${i}`}
                  aria-label={name}
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
              </Row>
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
              <div key={part} className={`dk-buttons-row${isChanged ? " changed" : ""}${focus === i ? " focused" : ""}`} onMouseEnter={() => onHover(i)} onFocus={() => onFocus(i)}>
                <Row
                  id={`btn-${i}`}
                  label={`${isChanged ? "● " : ""}${t(`desktop.live.part.${part}`)}`}
                  sub={pending || isChanged ? (pending ? pendingLabel : t("desktop.layouts.changed")) : undefined}
                >
                  <select
                    id={`all-remap-${i}`}
                    aria-label={t(`desktop.live.part.${part}`)}
                    className="dk-select"
                    value={value}
                    disabled={remap.busy}
                    onChange={(e) => remap.setExtra(n, Number(e.target.value))}
                  >
                    <option value={REMAP_EXTRA_SELF}>{t("desktop.layouts.extraSelf")}</option>
                    {/* loop: HOT-PATH-OK — 4 x ~17 options; memo()ed, only on a remap or focus change */}
                    {REMAP_BUTTON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value={REMAP_EXTRA_OFF}>{t("remap.disabled")}</option>
                  </select>
                </Row>
              </div>
            );
          })}
      </div>
      <RemapActions remap={remap} onSave={target ? saveToProfile : null} />
    </>
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
    <SectionGroup title={t("desktop.layouts.title")} info={t("desktop.layouts.hint")}>
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
    </SectionGroup>
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
    <SectionGroup title={t("desktop.live.pull", "Pull")}>
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
    </SectionGroup>
  );
}

// The DualSense Edge's Fn buttons and back paddles without firmware that
// remaps them (protocol 1.9): what they are; they light up on the drawing when pressed.
function EdgePartInfo() {
  const { t } = useTranslation();
  // loop: NOT-WORTH — N = 4 part names; only while Button assignments is open
  const title = EDGE_REMAP_ROWS.map((p) => t(`desktop.live.part.${p}`)).join(" · ");
  return (
    <SectionGroup title={title}>
      {/* hint: MUST-SHOW — the part's own panel: what this button is (there's nothing else in it) */}
      <p className="dk-hint">{t("desktop.live.edgePart.fn")}</p>
      {/* hint: MUST-SHOW — the part's own panel: what this button is (there's nothing else in it) */}
      <p className="dk-hint">{t("desktop.live.edgePart.paddle")}</p>
      {/* hint: MUST-SHOW — the part's own panel: what this button is (there's nothing else in it) */}
      <p className="dk-hint">{t("desktop.live.edgePart.soon")}</p>
    </SectionGroup>
  );
}

function TouchLive({ input }: { input: InputReport | null }) {
  const { t } = useTranslation();
  // loop: HOT-PATH-OK — N ≤ 2 fingers per live frame
  const touching = input?.fingers.filter((f) => f.touching) ?? [];
  return (
    <SectionGroup title={t("desktop.live.part.touchpad")}>
      {/* hint: MUST-SHOW — the part's own panel: what this button is (there's nothing else in it) */}
      <p className="dk-hint">{t("desktop.live.touchHint", "Touch the touch pad to see your fingers here. There's nothing to set up for it.")}</p>
      {/* loop: HOT-PATH-OK — N ≤ 2 fingers per live frame */}
      {touching.map((f, i) => (
        <p key={i} className="dk-mono">
          {t("desktop.live.finger", { n: i + 1, defaultValue: "Finger {{n}}" })}: {f.x}, {f.y}
        </p>
      ))}
    </SectionGroup>
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
  // lifetime: OK — usePoll stops on unmount (section folded) and while hidden
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
    <SectionGroup title={which === "speaker" ? t("desktop.live.speakerLevel", "Speaker level now") : t("desktop.live.hapticLevel", "Haptic feedback now")}>
      <div className="live-level">
        <Meter value={level} hold={held} />
        <span className="live-level-pct">{Math.round(level * 100)}%</span>
      </div>
      <p className="dk-hint">{silent ? t(which === "speaker" ? "desktop.live.speakerSilent" : "desktop.live.hapticSilent") : t("desktop.live.levelLive")}</p>
    </SectionGroup>
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
    <SectionGroup title={t("desktop.audioTest.speakerTitle")} info={t("desktop.audioTest.speakerHint")}>
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
      {/* hint: MUST-SHOW — a status: why the test can't play here */}
      {noSpeaker && <p className="dk-hint">{t("desktop.audioTest.noSpeaker")}</p>}
    </SectionGroup>
  );
}

// The microphone test (micTest.ts): one button starts and stops it; while it
// runs a segmented meter shows the controller's mic live, and with a headset
// in the controller (the input report's headset jack bit, as on Live data's
// Connection card) the mic is heard live on it. Without a headset there's no
// live sound (it would feed back on the speaker), nor with Audio output set to
// Speaker: Listen back plays the last 3 seconds, after the mic is closed. A status line always says what is
// happening, so silence with text is a visible error, never silence alone.
// Folding the section or hiding the window stops everything. `level` (the Mic
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
    <SectionGroup title={t("desktop.audioTest.micTitle")} info={t("desktop.audioTest.micHint", { seconds: LISTEN_SECONDS })}>
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
    </SectionGroup>
  );
}
