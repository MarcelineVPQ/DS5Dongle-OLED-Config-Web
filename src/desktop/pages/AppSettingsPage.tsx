// App settings: the app's own settings (stored by the main process, or this
// PC's preferences), in the accordion at the right like every page. The main
// view is the live controller drawing (ControllerView hands it in as `main`),
// so a theme, accent, glass or color vision change shows on it right away.
// Nothing in the sections talks to the board: each section's status comes
// from state the app already holds.
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Accessibility, AppWindow, BellOff, Code, Globe, Palette, RefreshCw, Shield, Zap } from "lucide-react";
import Markdown from "../Markdown";
import type { DesktopSettings, DevChannelAnswer, FirmwareLookup } from "../api";
import { hardwareName } from "../hardwareName";
import HdrTest from "../dev/HdrTest";
import FakeGames from "../dev/FakeGames";
import { KNOBS, knob, useKnob, type Knob } from "../lookKnobs";
import { COLORWAYS, colorway } from "../live/colorways";
import { COLOR_PARTS, FALLBACK_BASE, hasCustomColors, mergeColors, useCustomColors } from "../live/customColors";
import { MODEL_COLORWAYS, SIM_CORE1_KEY, SIM_CORE1_STAGES, SIMULATED_KEY, useDevPreview, useDevToolsShown, useFakeSlots, type DevModel } from "../devPreview";
import { UPDATE_PREVIEWS, useUpdatePreview, type UpdatePreview } from "../updatePreview";
import { REDUCE_MOTION_KEY } from "../motion";
import { ACCENT_KEY, ACCENTS, useControllerCode, useDesktopAccentUnreadable } from "../live/controllerAccent";
import { GLASS_KEY } from "../glass/glassPref";
import { BACKGROUNDS, useBackground, type Background } from "../live/ArtBackdrop";
import { writePref, useFlagPref, usePref } from "../storage";
import LanguageToggle, { currentLanguage } from "../../components/LanguageToggle";
import ThemeToggle, { useTheme } from "../../components/ThemeToggle";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import ColorPicker from "../colorPicker/ColorPicker";
import { feedProblemKey, firmwareOffer, type FirmwareUpdate } from "../useUpdates";
import { BusyButton, Row, Segmented, Toggle, Slider } from "../controls";
import { COLOR_VISIONS, type ColorVision, setColorVision, useColorVision } from "../colorVision";
import { say, setCaptions, setNarrator, useCaptionsOn, useNarrator } from "../narrator";
import { gamesSupported, protonApplies } from "../games/platform";
import { onGamesAllowed, setGamesAllowed } from "../games/consent";
import { logged } from "../../errorText";
import { shown } from "../shownError";
import Notice from "../Notice";
import DismissedNotices, { useDismissedTasks } from "../DismissedNotices";
import { useNoticeTasks } from "../notices";
import { named, onOff } from "../accordion/status";
import { Section, SectionSub, SplitView } from "../accordion/Section";
import { pinScope, useAccordion } from "../accordion/useAccordion";

export default function AppSettingsPage({ bridge, fw, main, panelRef }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate; main?: ReactNode; panelRef?: (el: HTMLElement | null) => void }) {
  const { t, i18n } = useTranslation();
  // Joining the Development channel asks first (what it means, what's in it).
  const [joiningDev, setJoiningDev] = useState(false);
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
  // What the statuses say (all state the app already has).
  const [theme] = useTheme();
  const [glass] = useFlagPref(GLASS_KEY);
  const [background] = useBackground();
  const cv = useColorVision();
  const narrator = useNarrator();
  const captions = useCaptionsOn();
  const launchers = useGamesAllowed();
  const dismissed = useDismissedTasks().length;
  const [devTools] = useDevToolsShown();
  // loop: NOT-WORTH — N ≤ ~6 open tasks; App settings' render
  const updateTask = useNoticeTasks().tasks.find((task) => task.place === "app" && task.section === "updates")?.text ?? null;
  const acc = useAccordion("app", pinScope("app"), updateTask ? "updates" : null);

  const startup = settings
    ? // loop: NOT-WORTH — N = 3 switches; App settings' render
      [settings.closeToTray && t("desktop.live.closeToTray"), settings.launchAtLogin && t("desktop.live.launchAtLogin"), settings.startMinimized && t("desktop.live.startMinimized")]
        .filter(Boolean)
        .join(" · ") || t("desktop.accordion.allOff")
    : null;
  const updates = settings
    ? `${t(settings.updateChannel === "dev" ? "desktop.channel.dev" : "desktop.channel.stable")} · ${t(!settings.checkForUpdates ? "desktop.accordion.updatesOff" : settings.autoInstallUpdates ? "desktop.accordion.updatesAuto" : "desktop.accordion.updatesAsk")}`
    : null;

  return (
    <SplitView page="app" main={main} title={t("desktop.live.app")} sub={t("desktop.settings2.sub")} state={acc} panelRef={panelRef}>
      <Section id="language" icon={Globe} title={t("desktop.settings2.language")} status={currentLanguage(i18n.language).label}>
        {() => (
          <Row label={t("desktop.settings2.language")} wide>
            <LanguageToggle />
          </Row>
        )}
      </Section>
      <Section
        id="appearance"
        icon={Palette}
        title={t("desktop.settings2.appearance")}
        status={[t(`themeToggle.${theme}`), t(glass ? "desktop.glass.glass" : "desktop.glass.standard"), t(`desktop.backdrop.${background}`)].join(" · ")}
      >
        {() => (
          <>
            <div className="dk-sec-cols">
              <Row label={t("desktop.settings2.theme")}>
                <ThemeToggle />
              </Row>
              <GlassSetting />
              <AccentSetting />
              <BackdropSetting />
              {/* loop: HOT-PATH-OK — N ≈ 10 look knobs; only while Appearance is open */}
              {KNOBS.filter((k) => !k.hidden).map((k) => (
                <KnobSlider key={k.key} k={k} />
              ))}
            </div>
            <CustomColorsSetting />
          </>
        )}
      </Section>
      <Section
        id="accessibility"
        icon={Accessibility}
        title={t("desktop.settings2.accessibility")}
        status={[
          named(t, t("desktop.colorVision.label"), t(`desktop.colorVision.${cv}`)),
          onOff(t, t("desktop.narrator.voice"), narrator === "on"),
          onOff(t, t("desktop.narrator.captions"), captions),
        ].join(" · ")}
      >
        {() => (
          <>
            <ColorVisionSetting />
            <ReduceMotionSetting />
            <NarratorSettings />
          </>
        )}
      </Section>
      {settings && (
        <>
          <Section id="startup" icon={AppWindow} title={t("desktop.settings2.startup")} status={startup}>
            {() => (
              <>
                <Toggle label={t("desktop.live.closeToTray")} value={settings.closeToTray} onChange={(v) => set("closeToTray", v)} />
                <Toggle label={t("desktop.live.launchAtLogin")} value={settings.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} />
                <Toggle label={t("desktop.live.startMinimized")} value={settings.startMinimized} onChange={(v) => set("startMinimized", v)} />
              </>
            )}
          </Section>
          <Section
            id="graphics"
            icon={Zap}
            title={t("desktop.settings2.graphics")}
            status={[onOff(t, t("desktop.live.hardwareAcceleration"), settings.hardwareAcceleration), onOff(t, t("desktop.hdr.short"), settings.hdrLighting)].join(" · ")}
          >
            {() => (
              <>
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
              </>
            )}
          </Section>
          <Section id="updates" icon={RefreshCw} title={t("desktop.settings2.updates")} status={updates} task={updateTask}>
            {() => (
              <>
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
                  sub={settings.updateChannel === "dev" ? t("desktop.channel.devHint") : t("desktop.channel.stableHint")}
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
              </>
            )}
          </Section>
        </>
      )}
      {gamesSupported() && launchers !== null && (
        <Section id="privacy" icon={Shield} title={t("desktop.settings2.privacy")} status={t(launchers ? "desktop.accordion.launchersRead" : "desktop.accordion.launchersNotRead")}>
          {() => <GameLaunchersSetting allowed={launchers} />}
        </Section>
      )}
      <Section id="dismissed" icon={BellOff} title={t("desktop.notices.dismissedTitle")} status={dismissed ? t("desktop.accordion.hidden", { count: dismissed }) : t("desktop.notices.none")}>
        {() => <DismissedNotices device={hardwareName(bridge.identity)} />}
      </Section>
      {devTools && (
        <Section id="developer" icon={Code} title={t("desktop.dev.title")} status={t("desktop.accordion.devOnly")}>
          {() => <DeveloperSettings />}
        </Section>
      )}
    </SplitView>
  );
}

// Whether Games may read the game launchers (null until known). App settings
// → Privacy's status and switch.
export function useGamesAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // lifetime: OK — cleanup: drops a late read, unsubscribes the games-allowed event
  useEffect(() => {
    let live = true;
    window.desktop
      ?.getSettings()
      .then((s) => live && setAllowed(s.gamesScanAllowed))
      .catch(logged("reading the Games consent for App settings (the section stays hidden)"));
    // lifetime: OK — off() in the effect cleanup
    const off = onGamesAllowed(setAllowed);
    return () => {
      live = false;
      off();
    };
  }, []);
  return allowed;
}

// Privacy: whether Games may read the game launchers (its first-visit consent).
// Turning it off asks first (a notice in the section), since the library and
// per-game controller profiles hide until it's back on; turning it on is the
// same as "Check my launchers".
export function GameLaunchersSetting({ allowed }: { allowed: boolean }) {
  const { t } = useTranslation();
  const [confirmOff, setConfirmOff] = useState(false);
  const reads = t("desktop.games.readLaunchersSub", { what: t(protonApplies() ? "desktop.games.consentLaunchers" : "desktop.games.consentLaunchersWindows") });
  const offText = t("desktop.games.readLaunchersOff");
  return (
    <>
      {confirmOff && (
        <Notice
          role="alert"
          action={
            <>
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
            </>
          }
        >
          <span>{offText}</span>
        </Notice>
      )}
      <Toggle
        label={t("desktop.games.readLaunchers")}
        sub={`${reads} ${offText}`}
        value={allowed}
        disabled={confirmOff}
        onChange={(v) => (v ? setGamesAllowed(true).catch(shown("desktop.errors.settingNotSaved")) : setConfirmOff(true))}
      />
    </>
  );
}

// Checks the chosen channel now, the app and the dongle's firmware, instead
// of waiting for the next automatic check (every 6 hours). Anything new shows
// up in the banners at the top; this says what was found for both.
export function CheckNow({ firmwareInstalled, refreshFirmware }: { firmwareInstalled: string | null | undefined; refreshFirmware: () => Promise<FirmwareLookup> }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<string[]>([]);
  const desktop = window.desktop;
  if (!desktop) return null;
  const check = async () => {
    setResult([]);
    // error: SHOWN — desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (null: the line below says the check failed)
    const app = await desktop.checkForUpdates().catch(() => null);
    const lines: string[] = [];
    if (!app || app.phase === "failed") lines.push(t(feedProblemKey(app?.problem, "desktop.setup.checkFailed")));
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
      <SectionSub>{t("desktop.customColors.title")}</SectionSub>
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
  const [preview, setPreview] = useState<DevChannelAnswer | "loading" | "ask">(automatic ? "loading" : "ask");
  const [asked, setAsked] = useState(false);
  const check = () => {
    setPreview("loading");
    setAsked(true);
  };
  // lifetime: OK — cleanup: drops a late preview (holds no resource)
  useEffect(() => {
    if (!automatic && !asked) return;
    let live = true;
    // error: SHOWN — desktop.channel.joinOffline (or the answer's problem: joinUnpublished, desktop.updateFeed.unsigned / .malformed)
    window.desktop?.devChannelPreview(asked).then(
      (p) => live && setPreview(p),
      () => live && setPreview({ problem: "offline" }),
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
        ) : preview && "problem" in preview ? (
          <p className="dk-hint">{t(preview.problem === "unpublished" ? "desktop.channel.joinUnpublished" : feedProblemKey(preview.problem, "desktop.channel.joinOffline"))}</p>
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
// in builds that include it (DS5_DEV_TOOLS=1 or X.Y.Z-dev.N), on any update
// channel. A release never shows it (nor its section).
export function DeveloperSettings() {
  const { t } = useTranslation();
  const [onScreen] = useDevToolsShown();
  const dev = useDevPreview();
  const [updatePreview, setUpdatePreview] = useUpdatePreview();
  const fakeSlots = useFakeSlots();
  const [simulated] = useFlagPref(SIMULATED_KEY);
  const [simCore1] = usePref<(typeof SIM_CORE1_STAGES)[number]>(SIM_CORE1_KEY, "", SIM_CORE1_STAGES);
  if (!onScreen) return null;
  const model = dev.model || "dualsense";
  const codes = MODEL_COLORWAYS[model];
  return (
    <>
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
      <FakeGames />
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
      <SectionSub>{t("desktop.dev.hdrTitle")}</SectionSub>
      <HdrTest />
    </>
  );
}

function KnobSlider({ k }: { k: Knob }) {
  const { t } = useTranslation();
  const [value, setValue] = useKnob(k);
  return <Slider label={t(`desktop.knobs.${k.key}`)} sub={t(`desktop.knobs.${k.key}Sub`)} value={value} min={k.min} max={k.max} step={k.step} unit={k.unit} onChange={setValue} />;
}
