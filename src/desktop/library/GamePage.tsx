// One game's page in the Games library, like every page: the main view is the
// artwork (hero + logo), one bar with Play, the quick links and the play
// stats, the game "at a glance" (tiles named and ordered as the panel's
// sections, each opening its section, never saying what the section's status
// says) and two readouts as main-view blocks: DualSense support (the tier,
// the feature checklist, what the tiers mean) and Details. The accordion at
// the right holds what you set or do: Controller profile, Setup,
// Compatibility (Proton games on Linux), HDR (Proton games), Your report
// (your rating and the test sheet: Pass / Fail / Not tested per feature) and Notes. Each fact has one place: the
// tier in DualSense support, the Proton in Compatibility, store and launcher
// in Details. The page keeps the game's own accent (scopedAccent), panel
// included; the pins are shared by every game's page.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BadgeCheck, Info, Layers, MessageSquareText, NotebookPen, SlidersHorizontal, Sun, Wrench } from "lucide-react";
import { useLibrary } from "./libraryContext";
import { layoutSummary } from "../live/layoutSummary";
import { FEATURES2, supportsFeature2 } from "../../protocol/bridgeClient";
import { LauncherIcon } from "./LauncherIcon";
import { protonApplies } from "../games/platform";
import { knownHdr } from "../games/knownGames";
import { HdrChecklist, HdrManual } from "./HdrChecklist";
import { hdrGameReqs, type HdrReq } from "../games/hdrSetup";
import { canMarkNotDetected, setupStatus, type SetupStatus } from "./setupStatus";
import { thenRescan } from "../games/scanOrder";
import { useDebouncedSave } from "./useDebouncedSave";
import { setBackdropGame } from "../live/ArtBackdrop";
import { onThemeChange, scopedAccent } from "../live/controllerAccent";
import { causeText, shown, shownText } from "../shownError";
import { captureProfile, clearGroup, gameGroups, pruneProfile, settingsFrom, shownValues, upgradeProfile, type ProfileGroup } from "./profileValues";
import { X } from "lucide-react";
import { CURVE_PRESETS, DEFAULT_CUSTOM_POINTS } from "../../protocol/stickCurve";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { BusyButton, Row } from "../controls";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";
import { OverwrittenNotice, RestartNotice, useMsg, useRestartText } from "../pages/GamesPage";
import { forgetApplied, overwrittenBy, rememberApplied, restartFor, startedSinceCheck, useFreshRunning } from "../games/launcherCheck";
import type { Fix, GameEntry, GameInfo, GamesReport, ModeInfo } from "../games/types";
import { API_NAME } from "../games/gameArgs";
import { ART_SHOWN, artUrl } from "../games/types";
import { headerArt, useArtColor } from "./gameArt";
import type { GameRecord, LibraryFile, Mine, ProfileSettings } from "../games/library";
import { countResults, isNotDetected, legacyTags, setResult, sheetOf, suggestedRating, testedOn, type TestedOn } from "../games/report";
import { ReportSheet } from "./ReportSheet";
import { fixesFor, staleness, supportOf, type FeatureState } from "./support";
import { GameActions, PlayStats } from "./playBar";
import Notice from "../Notice";
import { Section, SectionGroup, SplitView } from "../accordion/Section";
import { pinScope, revealSection, useAccordion } from "../accordion/useAccordion";
import { MainBlock, useMainBlock } from "../accordion/MainBlock";
import type { SectionId } from "../accordion/sections";

interface Props {
  game: GameEntry;
  info: GameInfo | undefined;
  record: GameRecord | undefined;
  running: boolean;
  report: GamesReport;
  bridge: UseDs5BridgeResult;
  onLibrary: (file: LibraryFile) => void;
  onRescan: () => void;
}

export default function GamePage({ game, info, record, running, report, bridge, onLibrary, onRescan }: Props) {
  const { t } = useTranslation();
  const page = useRef<HTMLDivElement>(null);
  // What a report is tested on (the board, the controller, this OS, the game's Proton), read when it changes.
  const tested = (): TestedOn =>
    testedOn({
      platform: window.desktop?.platform,
      arch: window.desktop?.arch,
      firmware: bridge.firmwareVersion,
      model: bridge.identity?.model,
      colorway: bridge.identity?.colorwayCode,
      // loop: NOT-WORTH — N = one launcher's builds (≤ ~20), once per report change
      runner: protonApplies() ? (game.protons?.find((c) => c.current)?.name ?? game.runner) : null,
    });
  const mineState = useMine(game, info, record, onLibrary, onRescan, tested);
  const [mine] = mineState;
  const { library } = useLibrary();
  const has = (k: string) => info?.art.includes(k as never) ?? false;
  const header = headerArt(game.key, info);
  // The page takes the game's artwork color as its accent (the rest of the
  // app keeps the controller's); same legibility rules, scoped to the page.
  // Recomputed when the theme, the controller tint or the look changes (the
  // page's cards are mixed from the panel color those set).
  const artColor = useArtColor(game.key);
  const [accent, setAccent] = useState<Record<string, string> | null>(null);
  // lifetime: OK — cleanup unsubscribes the theme listener and cancels the frame
  useEffect(() => {
    if (!artColor) return;
    const el = page.current;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // lifetime: OK — one-shot, cancelled by the next update() and the effect cleanup
      frame = requestAnimationFrame(() => setAccent(scopedAccent(artColor, el)));
    };
    update();
    // lifetime: OK — off() in the effect cleanup
    const off = onThemeChange(update);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [artColor]);
  // The window's background shows this game's art while its page is open.
  // lifetime: OK — acquires nothing; the cleanup clears the backdrop game (page closes)
  useEffect(() => {
    setBackdropGame(info?.art.includes("hero") ? game.key : null);
    return () => setBackdropGame(null);
  }, [game.key, info]);

  // HDR games on Linux: the checklist decides whether HDR needs the player.
  const proton = isProtonGame(game);
  const isHdr = proton && game.hdr !== undefined;
  // loop: HOT-PATH-OK — N = 3 launchers
  const flatpak = !!report.launchers.find((l) => l.id === game.launcher)?.flatpak;
  const hdrReqs = isHdr ? hdrGameReqs(report.system.hdr, game, { ourProton: report.ourProton.name, flatpak }) : [];
  const status = setupStatus(game, hdrReqs);
  // An HDR game's page checks again when it opens (the main process answers
  // from a few seconds' cache): HDR turned on in the desktop's settings, or
  // gamescope just installed, shows without a manual rescan.
  const rescanned = useRef<string | null>(null);
  // lifetime: OK — acquires nothing (asks for one rescan per HDR game opened)
  useEffect(() => {
    if (!isHdr || rescanned.current === game.key) return;
    rescanned.current = game.key;
    onRescan();
  }, [isHdr, game.key, onRescan]);

  // The first visit opens what needs the player; the pins are every game page's.
  const hdrTask = isHdr && !status.hdrOk;
  const acc = useAccordion("game", pinScope("game"), status.attention ? "setup" : hdrTask ? "hdr" : null);
  const supportBlock = useMainBlock("game", "support");
  const details = useMainBlock("game", "details");

  // Each section's status line, and the glance tiles that open them. A tile
  // and its section never say the same words (page rule 2, IA audit Q7): the
  // tile is the short value (how many changes, what runs it, the stars), the
  // section's status the detail (which changes, the recommendation, your words).
  const normal = library.restore?.settings ?? (bridge.config ? settingsFrom(bridge.config) : null);
  const profile = record?.profile?.settings ?? null;
  const chips = useProfileChips(profile, normal, !!bridge.client?.splitHaptics);
  const profileTile = profile ? t("desktop.library.profileChanges", { count: chips.length }) : t("desktop.library.profileNoneShort");
  const profileStatus = profile
    ? // loop: NOT-WORTH — N ≤ 15 chips; one status line
      [...new Set(chips.map((c) => c.label))].join(", ") || t("desktop.library.profileStatus.normal")
    : t("desktop.library.profileStatus.none");
  const setupLine = status.passed > 0 ? `✓ ${t("desktop.library.setupAllSet", { count: status.passed })}` : `✓ ${t("desktop.library.setupNone")}`;
  const setupTask = status.attention && t("desktop.library.needsAttention");
  const setupTile = status.attention
    ? game.fixes.length
      ? t("desktop.library.glance.fixes", { count: game.fixes.length })
      : t("desktop.library.needsAttention")
    : `✓ ${t("desktop.library.glance.ready")}`;
  const counts = countResults(sheetOf(mine));
  // loop: NOT-WORTH — N = 2 parts of one status line
  const reportStatus = [mine.rating && t(`desktop.library.rateLabel.${mine.rating}`), counts.pass + counts.fail ? t("desktop.library.resultCounts", counts) : t("desktop.library.notTestedYet")]
    .filter(Boolean)
    .join(" · ");
  const reportTile = mine.rating ? `${"★".repeat(mine.rating)}${"☆".repeat(5 - mine.rating)}` : t("desktop.library.notRated");
  // loop: HOT-PATH-OK — N = screens, 1-3; game page render
  const hdrScreens = report.system.hdr.screens.filter((x) => x.hdr).map((x) => x.name);
  const hdrLine = isHdr
    ? `${t("desktop.library.supportsHdr")} · ${hdrScreens.length ? t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") }) : t(`desktop.games.hdrOff.${report.system.hdr.check}`)}`
    : t("desktop.library.hdrUnknown");
  const support = supportOf(game);
  const tier = `${TIER_ICON[support.tier]} ${t(`desktop.library.tier.${support.tier}`)}`;
  // As the launcher shows it (Steam's own Protons have an internal name, e.g. proton_9 = "Proton 9.0").
  // loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20)
  const runner = `${game.runnerMissing ? "⚠ " : ""}${game.protons?.find((c) => c.current)?.name ?? game.runner ?? t("desktop.library.launcherDefault")}`;
  const compatStatus = compatLine(t, game, report.ourProton.name);
  // Sections with nothing to do now show their status only, no body (page rule 6, IA audit Q9).
  const setupIdle = !status.attention && game.fixes.length === 0 && !canMarkNotDetected(game);
  const hdrIdle = knownHdr(game.title) && (!isHdr || status.hdrOk);
  const compatIdle = !compatHasAction(game, report.ourProton.name);

  // The game at a glance: a tile per section, in the panel's order and with
  // its name, each opening it (flashed; the drawer when narrow).
  const tile = (id: SectionId<"game">, label: string, value: string, hint?: string | false) => (
    <button key={id} type="button" className="gp-tile" data-tile={id} title={t("desktop.library.glanceOpen", { section: label })} onClick={() => acc.reveal(id)}>
      <span className="gp-tile-label">{label}</span>
      <span className="gp-tile-value">{value}</span>
      {hint && <span className="gp-tile-hint">{hint}</span>}
    </button>
  );
  const main = (
    <>
      <header className={`gp-hero ${header.shape}`} style={header.style}>
        {has("logo") ? <img className="gp-logo" src={artUrl(game.key, "logo", ART_SHOWN.logo())} alt={game.title} /> : <h1 className="gp-title">{game.title}</h1>}
      </header>
      <div className="gp-bar">
        <GameActions game={game} info={info} running={running} />
        <PlayStats info={info} running={running} />
      </div>
      <div className="gp-glance">
        {tile("profile", t("desktop.library.section.profile"), profileTile, !!profile && running && t("desktop.library.activeNow"))}
        {tile("setup", t("desktop.library.section.setup"), setupTile)}
        {protonApplies() && tile("compatibility", t("desktop.library.section.compat"), runner)}
        {tile("report", t("desktop.library.section.report"), reportTile)}
      </div>
      <div className="gp-blocks">
        {/* DualSense support: a readout (the tier, the feature checklist, the legend), so a main-view block (IA audit R3). */}
        <MainBlock state={supportBlock} icon={BadgeCheck} title={t("desktop.library.section.support")} status={tier}>
          <SupportBody game={game} />
        </MainBlock>
        {/* No status: its rows say the store and the size (IA audit R6). */}
        <MainBlock state={details} icon={Info} title={t("desktop.library.section.details")}>
          <DetailsBody game={game} info={info} />
        </MainBlock>
      </div>
    </>
  );

  return (
    <div className="gp" ref={page} style={accent ?? undefined}>
      <SplitView page="game" main={main} title={game.title} sub={t("desktop.panelSub.game")} state={acc}>
        <Section id="profile" icon={SlidersHorizontal} title={t("desktop.library.section.profile")} status={profileStatus}>
          {() => <ProfileBody game={game} record={record} bridge={bridge} normal={normal} onLibrary={onLibrary} />}
        </Section>
        <Section id="setup" icon={Wrench} title={t("desktop.library.section.setup")} status={setupLine} task={setupTask} idle={setupIdle}>
          {() => <SetupBody game={game} report={report} mineState={mineState} onRescan={onRescan} status={status} />}
        </Section>
        {protonApplies() && (
          <Section id="compatibility" icon={Layers} title={t("desktop.library.section.compat")} status={compatStatus} idle={compatIdle}>
            {() => <CompatBody key={game.key} game={game} report={report} onRescan={onRescan} />}
          </Section>
        )}
        {proton && (
          <Section id="hdr" icon={Sun} title={t("desktop.library.hdrTitle")} status={hdrLine} task={hdrTask && t("desktop.library.needsAttention")} idle={hdrIdle}>
            {() => <HdrBody game={game} report={report} mineState={mineState} hdrReqs={hdrReqs} isHdr={isHdr} />}
          </Section>
        )}
        <Section id="report" icon={MessageSquareText} title={t("desktop.library.section.report")} status={reportStatus}>
          {() => (
            <>
              <RatingPart game={game} info={info} mineState={mineState} />
              <ReportSheet sheet={sheetOf(mine)} onChange={(report) => mineState[1]({ report })} />
            </>
          )}
        </Section>
        <Section id="notes" icon={NotebookPen} title={t("desktop.library.section.notes")} status={mine.notes?.trim().split("\n")[0] || t("desktop.library.notesEmpty")}>
          {() => (
            <textarea
              className="dk-textarea gp-notes"
              rows={5}
              maxLength={5000}
              aria-label={t("desktop.library.section.notes")}
              placeholder={t("desktop.library.notesPlaceholder")}
              value={mine.notes ?? ""}
              onChange={(e) => mineState[1]({ notes: e.target.value })}
            />
          )}
        </Section>
      </SplitView>
    </div>
  );
}

// Compatibility's status: what the recommendation says about the build it
// runs with (the tile shows the build's name; IA audit Q7).
function compatLine(t: TFunction, game: GameEntry, ours: string | null): string {
  if (game.runnerMissing) return t("desktop.library.compatStatus.missing");
  if (game.usesOurProton) return t("desktop.library.compatStatus.ours");
  if (game.support !== "triggers" && game.support !== "haptics") return t("desktop.library.compatStatus.any");
  return ours ? t("desktop.library.compatStatus.recommended", { name: ours }) : t("desktop.library.compatStatus.notInstalled");
}

// Whether Compatibility has something to do: another build to pick, a
// switch it recommends, or our build missing for a game that needs it (its
// Install link, IA audit R5).
function compatHasAction(game: GameEntry, ours: string | null): boolean {
  // loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20) and one game's fixes (≤ ~5)
  return (game.protons ?? []).some((c) => !c.current) || game.fixes.some((f) => f.kind === "set-runner") || needsOurProton(game, ours);
}
const needsOurProton = (game: GameEntry, ours: string | null) => !ours && !game.usesOurProton && (game.support === "triggers" || game.support === "haptics");

// A game Proton runs (Linux, a launcher with per-game Proton settings).
const isProtonGame = (game: GameEntry) => protonApplies() && (game.launcher === "steam" || game.launcher === "heroic" || game.launcher === "lutris");

const TIER_ICON: Record<string, string> = { verified: "✓✓", works: "✓", "needs-setup": "⚙", partial: "◐", broken: "✗", unknown: "?" };
const FEATURE_ICON: Record<FeatureState, string> = { yes: "✓", no: "✗", unknown: "?" };

// ---- Controller profile ----
// What it changes (chips), Edit in controller view (where every setting is
// edited live), Copy current settings, Delete, and the two things only a game
// has: its button layout and stick curves.
function ProfileBody({
  game,
  record,
  bridge,
  normal,
  onLibrary,
}: {
  game: GameEntry;
  record?: GameRecord;
  bridge: UseDs5BridgeResult;
  normal: ProfileSettings | null;
  onLibrary: (f: LibraryFile) => void;
}) {
  const { t } = useTranslation();
  const { editProfile } = useLibrary();
  const desktop = window.desktop!;
  const config = bridge.config;

  // Every edit is stored (debounced), keeping only what differs from the
  // normal settings; applying it to the board while the game runs (or is
  // edited) is the profile hook's job. A save still waiting when the section
  // folds is sent (useDebouncedSave).
  const {
    value: draft,
    set,
    cancel,
  } = useDebouncedSave<ProfileSettings | null>(
    record?.profile?.settings ?? null,
    // error: PASSES-ON — useDebouncedSave shows a failed save (desktop.errors.librarySave)
    (next) => (next ? desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: pruneProfile(next, normal) }).then(onLibrary) : Promise.resolve()),
    400,
  );
  const create = (from: ProfileSettings) => {
    cancel();
    desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: from }).then(onLibrary).catch(shown("desktop.errors.profileCreate"));
  };
  const remove = () => {
    cancel();
    desktop.libraryDeleteProfile(game.key).then(onLibrary).catch(shown("desktop.errors.profileDelete"));
  };

  if (!draft)
    return (
      <>
        {/* hint: MUST-SHOW — the empty state: what a profile is, next to the button that makes one */}
        <p className="dk-hint">{t("desktop.library.profileNone")}</p>
        {/* Only with a board to read the settings from; without one, the hint says so (no greyed-out button). */}
        {config ? (
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" onClick={() => create(captureProfile(config, normal, undefined))}>
              {t("desktop.library.profileFromCurrent")}
            </button>
          </div>
        ) : (
          <p className="dk-hint">{t("desktop.library.profileNeedsDongle")}</p>
        )}
      </>
    );
  const edit = (patch: Partial<ProfileSettings>) => set({ ...upgradeProfile(draft), ...patch });
  return (
    <>
      <ProfileSummary draft={draft} normal={normal} split={!!bridge.client?.splitHaptics} onChange={set} />
      <LayoutPicker value={draft.buttonLayout} bridge={bridge} onChange={(id) => edit({ buttonLayout: id })} />
      <CurvePicker value={draft.stickCurves} bridge={bridge} onChange={(stickCurves) => edit({ stickCurves })} />
      <div className="dk-row-btns">
        {/* These need the board: shown only while it's connected. */}
        {bridge.isConnected && (
          <button type="button" className="dk-btn primary" title={t("desktop.editing.openHint")} onClick={() => editProfile(game.key, game.title)}>
            {t("desktop.editing.open")}
          </button>
        )}
        {config && (
          <button type="button" className="dk-btn" title={t("desktop.profile.copyHint")} onClick={() => create(captureProfile(config, normal, draft))}>
            {t("desktop.library.profileCopyCurrent")}
          </button>
        )}
        <button type="button" className="dk-btn danger" onClick={remove}>
          {t("desktop.library.profileDelete")}
        </button>
      </div>
    </>
  );
}

// What this game's profile changes, as small "name: value" chips (only what
// differs from the normal settings); each one's button goes back to the
// normal setting. Everything not listed uses the normal settings. The
// section's status counts them.
type Chip = { key: string; label: string; text: string; clear: () => ProfileSettings };
function useProfileChips(draft: ProfileSettings | null, normal: ProfileSettings | null, split: boolean): Chip[] {
  const { t } = useTranslation();
  const { library } = useLibrary();
  if (!draft) return [];
  const v = normal ? shownValues(draft, normal) : upgradeProfile(draft);
  const onOff = (b: boolean | undefined) => t(b ? "desktop.profile.on" : "desktop.profile.off");
  const value: Record<ProfileGroup, () => string> = {
    grips: () => (split ? `${v.hapticsGain?.toFixed(1)}× / ${v.hapticsGainRight?.toFixed(1)}×` : `${v.hapticsGain?.toFixed(1)}×`),
    autoHaptics: () => `${t(`desktop.library.autoMode.${(["off", "fallback", "mix", "replace"] as const)[v.autoHapticsEnable ?? 0]}`)}${v.autoHapticsEnable ? ` · ${v.autoHapticsGain}%` : ""}`,
    audioBuffer: () => `${v.audioBufferLength}`,
    speaker: () => `${(v.speakerVolume ?? 0) > 0 ? "+" : ""}${v.speakerVolume} dB`,
    lightbar: () => {
      const m = LIGHTBAR_MODES.find((x) => x.value === v.lightbarMode);
      return m ? t(`desktop.lightbar.modes.${m.key}`, m.label) : "";
    },
    favorites: () =>
      [0, 1, 2, 3]
        // loop: NOT-WORTH — N = 4 slots x 3 channels; per profile summary
        .filter((i) => !normal || (["lbFavR", "lbFavG", "lbFavB"] as const).some((k) => v[k]?.[i] !== normal[k]?.[i]))
        .map((i) => `FAV${i}`)
        .join(", "),
    mic: () => onOff(v.btMicEnable),
    triggers: () => (v.triggerReduce ? `−${v.triggerReduce}` : t("desktop.settings.asGame")),
    speakerBoost: () => (v.speakerGain ? `${v.speakerGain}` : t("desktop.settings.asGame")),
    volumeLock: () => onOff(v.lockVolume),
    micLevel: () => (v.micLevel ? `${v.micLevel}` : t("desktop.settings.asPc")),
    echoCancel: () => onOff(v.micEchoCancel),
  };
  const label: Record<ProfileGroup, string> = {
    grips: t("desktop.library.haptics"),
    autoHaptics: t("desktop.library.autoHaptics"),
    audioBuffer: t("haptics.audioBufferLabel"),
    speaker: t("desktop.library.speaker"),
    lightbar: t("desktop.library.lightbar"),
    favorites: t("desktop.library.favorites"),
    mic: t("desktop.library.mic"),
    triggers: t("desktop.library.triggerReduce"),
    speakerBoost: t("desktop.library.speakerBoost"),
    volumeLock: t("desktop.library.lockVolume"),
    micLevel: t("desktop.library.micLevel"),
    echoCancel: t("desktop.library.echoCancel"),
  };
  // loop: HOT-PATH-OK — N ≤ 12 profile groups
  const chips: Chip[] = gameGroups(draft, normal).map((g) => ({
    key: g,
    label: label[g],
    text: `${label[g]}: ${value[g]()}`,
    clear: () => clearGroup(draft, g),
  }));
  const layout = draft.buttonLayout ? library.layouts?.[draft.buttonLayout] : undefined;
  if (draft.buttonLayout)
    chips.push({
      key: "layout",
      label: t("desktop.layouts.profileLabel"),
      text: `${t("desktop.layouts.profileLabel")}: ${layout?.name ?? t("desktop.layouts.normal")}`,
      clear: () => ({ ...draft, buttonLayout: undefined }),
    });
  // loop: HOT-PATH-OK — N = 2 sticks
  for (const side of ["left", "right"] as const) {
    const curve = draft.stickCurves?.[side];
    if (!curve) continue;
    chips.push({
      key: `curve-${side}`,
      label: t(side === "left" ? "desktop.curves.profileLeft" : "desktop.curves.profileRight"),
      text: `${t(side === "left" ? "desktop.curves.profileLeft" : "desktop.curves.profileRight")}: ${t(`desktop.curves.type.${curve.type}`)}`,
      clear: () => {
        const rest = { ...draft.stickCurves };
        delete rest[side];
        return { ...draft, stickCurves: rest.left || rest.right ? rest : undefined };
      },
    });
  }
  return chips;
}

function ProfileSummary({ draft, normal, split, onChange }: { draft: ProfileSettings; normal: ProfileSettings | null; split: boolean; onChange: (s: ProfileSettings) => void }) {
  const { t } = useTranslation();
  // The button layout and the curves are edited right below (their own rows): not repeated as chips (IA audit R7).
  // loop: HOT-PATH-OK — N ≤ 15 chips
  const chips = useProfileChips(draft, normal, split).filter((c) => c.key !== "layout" && !c.key.startsWith("curve-"));
  return (
    <>
      {/* hint: MUST-SHOW — a status: nothing changed for this game yet */}
      <p className="dk-hint">{chips.length ? t("desktop.profile.changes") : t("desktop.profile.allNormal")}</p>
      {chips.length > 0 && (
        <div className="lib-filters" role="group" aria-label={t("desktop.library.section.profile")}>
          {/* loop: HOT-PATH-OK — N ≤ 15 chips */}
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="dk-chip ok"
              title={t("desktop.profile.useNormal", { name: c.text })}
              aria-label={t("desktop.profile.useNormal", { name: c.text })}
              onClick={() => onChange(c.clear())}
            >
              {c.text} <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// A saved button layout for this game (switched in while it runs; never
// written to the dongle's flash, so it needs protocol 1.8).
function LayoutPicker({ value, bridge, onChange }: { value: string | undefined; bridge: UseDs5BridgeResult; onChange: (id: string | undefined) => void }) {
  const { t } = useTranslation();
  const { library } = useLibrary();
  // loop: HOT-PATH-OK — N = saved button layouts (a few)
  const layouts = Object.entries(library.layouts ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const oldFirmware = !!bridge.identity && !supportsFeature2(bridge.identity, 8, FEATURES2.temporaryRemap);
  return (
    <>
      {/* A picker only when there's something to pick: old firmware or no layouts yet, the hint below says why. */}
      {!oldFirmware && (layouts.length > 0 || value) && (
        <Row label={t("desktop.layouts.profileLabel")}>
          <select className="dk-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">{t("desktop.layouts.normal")}</option>
            {/* loop: HOT-PATH-OK — N = saved button layouts (a few) */}
            {layouts.map(([id, l]) => (
              <option key={id} value={id}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
      )}
      {oldFirmware ? (
        // hint: MUST-SHOW — why the layouts are off: what to update
        <p className="dk-hint">{t("desktop.layouts.needsFirmware")}</p>
      ) : layouts.length === 0 ? (
        // hint: MUST-SHOW — the empty state: where layouts are made
        <p className="dk-hint">{t("desktop.layouts.noneForGame")}</p>
      ) : (
        value &&
        library.layouts?.[value] && (
          <p className="dk-layout-changes">
            {layoutSummary(
              library.layouts[value].table,
              t("desktop.layouts.off"),
              t("desktop.layouts.noChanges"),
              // loop: HOT-PATH-OK — N = 4 extra buttons
              library.layouts[value].extra ? { values: library.layouts[value].extra!, names: ["fn-l", "fn-r", "paddle-l", "paddle-r"].map((p) => t(`desktop.live.part.${p}`)) } : undefined,
            )}
          </p>
        )
      )}
    </>
  );
}

// Stick response curves for this game (protocol 1.10; switched in while it
// runs, never written to the dongle's flash): a preset per stick, or the
// player's saved curve. Custom points for a game aren't edited here yet.
type StickCurvesSetting = NonNullable<ProfileSettings["stickCurves"]>;
function CurvePicker({ value, bridge, onChange }: { value: StickCurvesSetting | undefined; bridge: UseDs5BridgeResult; onChange: (v: StickCurvesSetting | undefined) => void }) {
  const { t } = useTranslation();
  const oldFirmware = !!bridge.identity && !supportsFeature2(bridge.identity, 10, FEATURES2.stickCurves);
  const pick = (side: "left" | "right", type: string) => {
    const next: StickCurvesSetting = { ...value };
    const kept = value?.[side];
    if (type) next[side] = { type: type as (typeof CURVE_PRESETS)[number], points: kept?.points ?? DEFAULT_CUSTOM_POINTS.map((p) => [...p] as [number, number]) };
    else delete next[side];
    onChange(next.left || next.right ? next : undefined);
  };
  return (
    <>
      {!oldFirmware &&
        // loop: HOT-PATH-OK — N = 2 sticks
        (["left", "right"] as const).map((side) => (
          <Row key={side} label={t(side === "left" ? "desktop.curves.profileLeft" : "desktop.curves.profileRight")} info={t("desktop.curves.profileHint")}>
            <select className="dk-select" value={value?.[side]?.type ?? ""} onChange={(e) => pick(side, e.target.value)}>
              <option value="">{t("desktop.curves.profileSaved")}</option>
              {/* loop: HOT-PATH-OK — N = 2 sticks x ≤ 5 curve presets */}
              {CURVE_PRESETS.map((type) => (
                <option key={type} value={type}>
                  {t(`desktop.curves.type.${type}`)}
                </option>
              ))}
              {value?.[side]?.type === "custom" && <option value="custom">{t("desktop.curves.type.custom")}</option>}
            </select>
          </Row>
        ))}
      {oldFirmware && <p className="dk-hint">{t("desktop.curves.needsFirmware")}</p>}
    </>
  );
}

// ---- Setup (this game's recommended fixes) ----
// The fixes with Review / Apply, a standard gamepad that can't be set, the
// player's own graphics mode; what passed folds into one line ("All set"),
// and the player's mark for games we don't know folds under "Not working as
// expected?". HDR has its own section.
function SetupBody({ game, report, mineState, onRescan, status }: { game: GameEntry; report: GamesReport; mineState: MineState; onRescan: () => void; status: SetupStatus }) {
  const { t } = useTranslation();
  const m = useMsg();
  const restartText = useRestartText();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mine, update] = mineState;
  // The review checks the running launchers again when it opens (and after each scan).
  const [reviews, setReviews] = useState(0);
  const fresh = useFreshRunning(confirm ? `${reviews}|${report.scannedAt}` : null);
  const restart = restartFor(report, game.fixes, fresh);
  const tookBack = overwrittenBy(game.fixes);
  // Whatever happens, the page rescans afterwards (a launcher started since
  // the check is then named above Apply; a change is shown as the files say).
  const apply = async () => {
    try {
      const r = await thenRescan(() => window.desktop!.gamesApply({ fixIds: game.fixes.map((f) => f.id), restart }), onRescan);
      rememberApplied(r.applied.filter((a) => a.ok).map((a) => a.id));
      if (startedSinceCheck(r)) return setNote(restartText(r)); // nothing written: the review names it, Apply asks again
      setNote(restartText(r) ?? (r.applied.length > 0 && r.applied.every((a) => a.ok) ? t("desktop.library.setupDone") : t("desktop.library.setupFailed")));
      setConfirm(false);
    } catch (cause) {
      // error: SHOWN — desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under Set up
      setNote(causeText(cause));
      setConfirm(false);
    }
  };
  // XInput-only games on our list get the standard-gamepad fix by themselves;
  // for any other Proton game the player can say the controller isn't detected.
  const canMark = canMarkNotDetected(game);
  // The same fact as Your report's "Controller detected: Fail" (one field, report.ts).
  const marked = isNotDetected(mine);
  const toggleMark = () => update({ report: setResult(sheetOf(mine), "controller-detected", marked ? "not-tested" : "fail") });
  return (
    <>
      {note && <Notice onDismiss={() => setNote(null)}>{note}</Notice>}
      {game.fixes.length > 0 && (
        <>
          <ul className="dk-review">
            {/* loop: HOT-PATH-OK — N = one game's fixes (≤ ~5) */}
            {game.fixes.map((f) => (
              <li key={f.id}>
                <b>{m(f.label)}</b>
                <br />
                <span className="dk-hint">{m(f.why)}</span>
                {confirm && <span className="dk-hint dk-mono"> · {f.files.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <OverwrittenNotice launchers={tookBack} />
          {confirm && <RestartNotice launchers={restart} />}
          <div className="dk-row-btns">
            {!confirm ? (
              <button type="button" className="dk-btn primary" onClick={() => (setReviews((n) => n + 1), setConfirm(true))}>
                {t("desktop.library.setupReview")}
              </button>
            ) : (
              <>
                <button type="button" className="dk-btn" onClick={() => setConfirm(false)}>
                  {t("desktop.library.cancel")}
                </button>
                <BusyButton className="dk-btn primary" disabled={fresh === undefined} onClick={apply}>
                  {t("desktop.library.setupApply")}
                </BusyButton>
              </>
            )}
          </div>
        </>
      )}
      {/* hint: MUST-SHOW — a warning: this game's setup can't work yet, and what to install */}
      {game.gamepad === "no-build" && <p className="dk-hint">{t("desktop.library.gamepadNoBuild", { runner: game.runner ?? "" })}</p>}
      {game.mode?.state === "own" && <ModeNote game={game} mode={game.mode} />}
      {status.passed > 0 ? (
        // The passed checks: always shown, compact (no fold).
        <div className="gp-checks">
          <p className="gp-checks-head">
            {status.attention ? t("desktop.library.setupPassed", { count: status.passed }) : <span className="dk-good">✓ {t("desktop.library.setupAllSet", { count: status.passed })}</span>}
          </p>
          {game.gamepad === "set" && <p className="dk-good">✓ {t("desktop.library.gamepadSet")}</p>}
          {/* hint: MUST-SHOW — a status: why the standard gamepad option isn't needed */}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
          {game.mode?.state === "set" && <ModeNote game={game} mode={game.mode} />}
        </div>
      ) : (
        <>
          {!status.attention && <p className="dk-good">✓ {t("desktop.library.setupNone")}</p>}
          {/* hint: MUST-SHOW — a status: why the standard gamepad option isn't needed */}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
        </>
      )}
      {canMark && (
        <SectionGroup title={t("desktop.library.marksTitle")}>
          <label className="dk-fix gp-marks">
            <input type="checkbox" checked={marked} onChange={toggleMark} />
            <span>
              <span className="dk-fix-label">{t("desktop.library.tag.not-detected")}</span>
              <span className="dk-fix-why">{t("desktop.library.notDetectedHint")}</span>
            </span>
          </label>
        </SectionGroup>
      )}
    </>
  );
}

// ---- HDR (Proton games on Linux) ----
// An HDR game: the checklist (✗ items say what to install or turn on) and
// "Set it up yourself". A game we don't know: the player can mark it
// "Supports HDR" (then "Turn on HDR" is offered in Setup).
function HdrBody({ game, report, mineState, hdrReqs, isHdr }: { game: GameEntry; report: GamesReport; mineState: MineState; hdrReqs: HdrReq[]; isHdr: boolean }) {
  const { t } = useTranslation();
  const [mine, update] = mineState;
  return (
    <>
      {isHdr && (
        <>
          <HdrChecklist reqs={hdrReqs} />
          <HdrManual game={game} sys={report.system.hdr} ourProton={report.ourProton.name} />
        </>
      )}
      {!knownHdr(game.title) && (
        <label className="dk-fix">
          <input type="checkbox" checked={!!mine.hdr} onChange={() => update({ hdr: mine.hdr ? undefined : true })} />
          <span>
            <span className="dk-fix-label">{t("desktop.library.supportsHdr")}</span>
            <span className="dk-fix-why">{t("desktop.library.supportsHdrHint")}</span>
          </span>
        </label>
      )}
    </>
  );
}

// The game's graphics mode, when it's set or the player's own arguments pick another
// (when it's needed, the fix above says it).
function ModeNote({ game, mode }: { game: GameEntry; mode: ModeInfo }) {
  const { t } = useTranslation();
  const params = { game: game.title, api: API_NAME[mode.api], flag: mode.flag, own: mode.own ?? "", feature: t(`desktop.games.msg.unlock.${mode.unlocks}`) };
  // hint: MUST-SHOW — a status: the player's own launch arguments were left as they are, and what to change
  return mode.state === "set" ? <p className="dk-good">✓ {t("desktop.library.modeSet", params)}</p> : <p className="dk-hint">{t("desktop.library.modeOwn", params)}</p>;
}

// ---- Compatibility (Proton) ----
// Which Proton runs the game; the recommended one and why only while it's
// another (the store is in Details). The Proton version picker lists every
// build the game's launcher can run it with, ours marked recommended (it
// starts on ours while a fix recommends it). A switch is a fix like any
// other: backed up, a running launcher's close and reopen said first, and
// Undo right here.
function CompatBody({ game, report, onRescan }: { game: GameEntry; report: GamesReport; onRescan: () => void }) {
  const { t } = useTranslation();
  const m = useMsg();
  const restartText = useRestartText();
  const ours = report.ourProton.name;
  // loop: HOT-PATH-OK — N = one game's fixes (≤ ~5)
  const runnerFix = game.fixes.find((f) => f.kind === "set-runner");
  const choices = game.protons ?? [];
  // loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20); three finds per render
  const [recommended, current] = [choices.find((c) => c.recommended), choices.find((c) => c.current)];
  const [picked, setPicked] = useState(() => (runnerFix && recommended ? recommended.name : (current?.name ?? "")));
  // loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20)
  const choice = choices.find((c) => c.name === picked);
  // What a switch applies: for our build the set-runner fix when there is one (the change Setup lists), else the picked build's own.
  const target: { fix: Fix; name: string } | null = choice?.fix
    ? { fix: choice.recommended && runnerFix ? runnerFix : choice.fix, name: choice.name }
    : !choices.length && runnerFix
      ? { fix: runnerFix, name: ours ?? "" }
      : null;
  const [done, setDone] = useState<{ backupId: string; fix: Fix; back: string } | null>(null);
  // A running launcher is closed and reopened for the switch (and its Undo):
  // said first, then confirmed. Which ones run is checked when there's
  // something to apply and after each scan.
  const fresh = useFreshRunning(target || done ? `${report.scannedAt}|${target?.fix.id ?? ""}` : null);
  const restart = target ? restartFor(report, [target.fix], fresh) : [];
  const undoRestart = done ? restartFor(report, [done.fix], fresh) : [];
  const [confirm, setConfirm] = useState<"switch" | "undo" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const switchRunner = async () => {
    const to = target!;
    let again = false;
    try {
      const r = await thenRescan(() => window.desktop!.gamesApply({ fixIds: [to.fix.id], restart }), onRescan);
      rememberApplied(r.applied.filter((a) => a.ok).map((a) => a.id));
      again = startedSinceCheck(r); // nothing written: the notice names it, the button asks again
      // loop: HOT-PATH-OK — N = 1 applied change
      const failed = r.applied.find((a) => !a.ok);
      const ok = r.applied.length > 0 && !failed;
      setNote(restartText(r) ?? (failed ? (failed.message ? m(failed.message) : t("desktop.library.setupFailed")) : ok ? t("desktop.library.protonSwitched", { name: to.name }) : null));
      if (ok && r.backupId) setDone({ backupId: r.backupId, fix: to.fix, back: current?.name ?? "" });
    } catch (cause) {
      // error: SHOWN — desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under the Proton version picker
      setNote(causeText(cause));
    }
    setConfirm(again ? "switch" : null);
  };
  const undo = async () => {
    const was = done!;
    let again = false;
    try {
      const r = await thenRescan(() => window.desktop!.gamesUndo({ backupId: was.backupId, restart: undoRestart }), onRescan);
      if (r.ok) {
        forgetApplied();
        setDone(null);
        setPicked(was.back);
        setNote(restartText(r) ?? t("desktop.library.protonUndone"));
      } else if ("blockedBy" in r) {
        setNote(restartText(r));
        again = !r.problem; // a launcher started since: named, then asked again
      } else if ("conflict" in r) setNote(t("desktop.games.undoConflict", { files: r.conflict.join(", ") }));
      else if ("noController" in r) setNote(t("desktop.games.undoNoController"));
      else setNote(shownText(r.error));
    } catch (cause) {
      // error: SHOWN — desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under the Proton version picker
      setNote(causeText(cause));
    }
    setConfirm(again ? "undo" : null);
  };
  const pick = (name: string) => {
    setPicked(name);
    setConfirm(null);
    setNote(null);
  };
  const native = game.support === "triggers" || game.support === "haptics";
  const option = (name: string, rec: boolean, cur: boolean) =>
    rec && cur ? t("desktop.library.protonBoth", { name }) : rec ? t("desktop.library.protonRecommended", { name }) : cur ? t("desktop.library.protonCurrent", { name }) : name;
  // loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20)
  const canPick = choices.some((c) => !c.current);
  return (
    <>
      <Row label={t("desktop.library.runsWith")} invalid={game.runnerMissing} stack>
        <span className="dk-mono" title={game.runner ?? undefined}>
          {game.runnerMissing ? "⚠ " : ""}
          {current?.name ?? game.runner ?? t("desktop.library.launcherDefault")}
        </span>
      </Row>
      {!game.usesOurProton && (
        <Row label={t("desktop.library.recommended")} info={native ? t("desktop.library.compatHint") : undefined} stack>
          <span className="dk-mono">{native ? (ours ?? t("desktop.library.protonNotInstalled")) : t("desktop.library.anyProton")}</span>
        </Row>
      )}
      {game.usesOurProton && <p className="dk-good">✓ {t("desktop.library.usesOurs")}</p>}
      {/* The fix where the problem shows (page rule 7): our build is installed from Games → DualSense Proton build. */}
      {needsOurProton(game, ours) && (
        <div className="dk-row-btns">
          <button type="button" className="dk-btn primary" onClick={() => revealSection("games", "proton")}>
            {t("desktop.library.installOurs")}
          </button>
        </div>
      )}
      {canPick && (
        <Row label={t("desktop.library.protonPick")} info={t("desktop.library.protonPickInfo")} stack>
          <select className="dk-select" aria-label={t("desktop.library.protonPick")} value={picked} onChange={(e) => pick(e.target.value)}>
            {!current && (
              <option value="">{game.runnerMissing ? t("desktop.library.protonGone", { name: game.runner ?? "" }) : option(game.runner ?? t("desktop.library.launcherDefault"), false, true)}</option>
            )}
            {/* loop: HOT-PATH-OK — N = one launcher's builds (≤ ~20) */}
            {choices.map((c) => (
              <option key={c.name} value={c.name}>
                {option(c.name, c.recommended, c.current)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {target && (
        <>
          {target.fix.kind === "set-proton" && (
            <ul className="dk-review">
              <li>
                <span className="dk-hint">{m(target.fix.why)}</span>
                <span className="dk-hint dk-mono"> · {target.fix.files.join(", ")}</span>
              </li>
            </ul>
          )}
          {confirm === "switch" && <RestartNotice launchers={restart} />}
          <div className="dk-row-btns">
            {(confirm === "switch" || target.fix.kind === "set-proton") && (
              <button type="button" className="dk-btn" onClick={() => (confirm === "switch" ? setConfirm(null) : pick(current?.name ?? ""))}>
                {t("desktop.library.cancel")}
              </button>
            )}
            <BusyButton className="dk-btn primary" onClick={() => (restart.length && confirm !== "switch" ? Promise.resolve(setConfirm("switch")) : switchRunner())}>
              {t("desktop.library.switchTo", { name: target.name })}
            </BusyButton>
          </div>
        </>
      )}
      {note && <p className="dk-hint">{note}</p>}
      {done && (
        <>
          {confirm === "undo" && <RestartNotice launchers={undoRestart} undo />}
          <div className="dk-row-btns">
            <BusyButton className="dk-btn" onClick={() => (undoRestart.length && confirm !== "undo" ? Promise.resolve(setConfirm("undo")) : undo())}>
              {t("desktop.games.undoShort")}
            </BusyButton>
          </div>
        </>
      )}
    </>
  );
}

// ---- DualSense support (a main-view block: a readout) ----
// The tier's meaning (the tier itself is the block's status), the fixes in
// this app for the game, the per-feature checklist and what the tiers mean.
function SupportBody({ game }: { game: GameEntry }) {
  const { t } = useTranslation();
  const s = supportOf(game);
  return (
    <>
      {/* hint: MUST-SHOW — what this game's tier means, under the tier */}
      <p className={`gp-tier ${s.tier} dk-hint`}>{t(`desktop.library.tierHint.${s.tier}`)}</p>
      {fixesFor(game.title).length > 0 && (
        <ul className="dk-review">
          {/* loop: HOT-PATH-OK — N = known game fixes (GAME_FIXES, empty now) */}
          {fixesFor(game.title).map((f) => (
            <li key={f.app + f.note}>
              <b>{t("desktop.library.fixedIn", { version: f.app })}</b> {t(`desktop.library.fix.${f.note}`)}
            </li>
          ))}
        </ul>
      )}
      <ul className="gp-features">
        {/* loop: HOT-PATH-OK — N = 5 features */}
        {(["triggers", "haptics", "speaker", "mic", "lightbar"] as const).map((f) => (
          <li key={f} title={t(`desktop.library.feature.${s.features[f]}`)}>
            <span aria-hidden="true">{FEATURE_ICON[s.features[f]]}</span> {t(`desktop.library.featureName.${f}`)}
          </li>
        ))}
      </ul>
      <h4 className="dk-subhead">{t("desktop.library.tierLegend")}</h4>
      <ul className="gp-legend-list">
        {/* loop: HOT-PATH-OK — N = 6 support tiers */}
        {(["verified", "works", "needs-setup", "partial", "broken", "unknown"] as const).map((tier) => (
          <li key={tier}>
            <b>
              {TIER_ICON[tier]} {t(`desktop.library.tier.${tier}`)}
            </b>{" "}
            {/* hint: MUST-SHOW — the legend: what each rating means */}
            <span className="dk-hint">{t(`desktop.library.tierHint.${tier}`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---- The player's own rating and notes (local; sharing comes later) ----
// One copy per page, shared by the rating (in DualSense support) and Notes: the library
// stores the whole record, so two copies would overwrite each other's fields.
type MineState = readonly [Mine, (patch: Partial<Mine>) => void];
function useMine(game: GameEntry, info: GameInfo | undefined, record: GameRecord | undefined, onLibrary: (f: LibraryFile) => void, onRescan: () => void, tested: () => TestedOn): MineState {
  const app = window.desktop!.appVersion;
  const notDetected = (m?: Mine) => isNotDetected(m);
  const { value: mine, set } = useDebouncedSave<Mine>(
    record?.mine ?? {},
    (next) =>
      window.desktop!.librarySetMine({ gameKey: game.key, title: game.title, mine: next }).then((file) => {
        onLibrary(file);
        // "Controller not detected" and "Supports HDR" decide whether the
        // standard-gamepad and HDR fixes are offered.
        if (notDetected(next) !== notDetected(record?.mine) || !!next.hdr !== !!record?.mine?.hdr) onRescan();
      }),
    500,
  );
  const update = (patch: Partial<Mine>) => {
    // A rating or test sheet change re-stamps what it was given on.
    const stamp = ("rating" in patch || "report" in patch) && app ? { ratedOn: { app, build: info?.buildId, gameUpdated: info?.lastUpdated, at: Math.floor(Date.now() / 1000), ...tested() } } : {};
    // A sheet written also rewrites the older checklist from it, so an older app
    // (0.9.5-dev.17, which drops the sheet) still has the ticks (report.ts legacyTags).
    const tags = patch.report ? legacyTags(patch.report) : [];
    const legacy = "report" in patch ? { tags: tags.length ? tags : undefined } : {};
    set({ ...mine, ...patch, ...legacy, ...stamp });
  };
  return [mine, update] as const;
}

// The player's rating of how the controller works in this game (not of the
// game), under the per-feature list it sums up. Each star names what it means.
const STARS = [1, 2, 3, 4, 5] as const;
function RatingPart({ game, info, mineState }: { game: GameEntry; info?: GameInfo; mineState: MineState }) {
  const { t } = useTranslation();
  const [mine, update] = mineState;
  // The star under the pointer or keyboard focus; its words show until it leaves.
  const [preview, setPreview] = useState<number | null>(null);
  // cache: NOT-WORTH — key=star 1-5; invalidated=React's ref callbacks on mount/unmount; bound=5 elements
  const stars = useRef<(HTMLButtonElement | null)[]>([]);
  const stale = staleness(mine.ratedOn, info ?? {}, fixesFor(game.title));
  const rating = mine.rating;
  const lit = preview ?? rating;
  // What the sheet's results suggest; shown, never written into the stars.
  const suggested = suggestedRating(sheetOf(mine));
  // One tab stop for the group (the chosen star, else the first); arrows pick.
  const tabStop = rating ?? 1;
  const pick = (n: number) => {
    update({ rating: n });
    stars.current[n - 1]?.focus();
  };
  const onKey = (e: KeyboardEvent, n: number) => {
    const next = { ArrowRight: n + 1, ArrowUp: n + 1, ArrowLeft: n - 1, ArrowDown: n - 1, Home: 1, End: 5 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(Math.min(5, Math.max(1, next)));
  };
  return (
    <div className="gp-rating" id="gp-rating">
      <h3 id="gp-rating-title">{t("desktop.library.rateTitle")}</h3>
      <div className="gp-rate-row">
        <div className="gp-stars" role="radiogroup" aria-labelledby="gp-rating-title" onMouseLeave={() => setPreview(null)}>
          {/* loop: HOT-PATH-OK — N = 5 stars */}
          {STARS.map((n) => {
            const label = t(`desktop.library.rateLabel.${n}`);
            return (
              <button
                key={n}
                ref={(el) => {
                  stars.current[n - 1] = el;
                }}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t("desktop.library.stars", { count: n, label })}
                title={label}
                tabIndex={n === tabStop ? 0 : -1}
                className={(lit ?? 0) >= n ? "on" : ""}
                onClick={() => update({ rating: rating === n ? undefined : n })}
                onKeyDown={(e) => onKey(e, n)}
                onMouseEnter={() => setPreview(n)}
                onFocus={() => setPreview(n)}
                onBlur={() => setPreview(null)}
              >
                {(lit ?? 0) >= n ? "★" : "☆"}
              </button>
            );
          })}
        </div>
        {lit !== undefined && (
          <span className={`gp-rate-label${preview !== null && preview !== rating ? " preview" : ""}`} aria-hidden="true">
            {t(`desktop.library.rateLabel.${lit}`)}
          </span>
        )}
      </div>
      {stale && (
        <Notice closable>
          <span>
            {stale.kind === "our-fix"
              ? t("desktop.library.staleFix", { version: stale.app })
              : stale.at
                ? t("desktop.library.staleUpdateOn", { date: new Date(stale.at * 1000).toLocaleDateString() })
                : t("desktop.library.staleUpdate")}{" "}
            <button type="button" className="dk-btn dk-inline-btn" onClick={() => update({ report: sheetOf(mine) })}>
              {t("desktop.library.stillAccurate")}
            </button>
          </span>
        </Notice>
      )}
      {suggested !== null && (
        <p className="dk-hint gp-suggested">
          {t("desktop.library.suggested", { label: t(`desktop.library.rateLabel.${suggested}`) })}{" "}
          <span aria-hidden="true">
            {"★".repeat(suggested)}
            {"☆".repeat(5 - suggested)}
          </span>
        </p>
      )}
      <p className="dk-hint">{t("desktop.library.shareSoon")}</p>
    </div>
  );
}

function DetailsBody({ game, info }: { game: GameEntry; info?: GameInfo }) {
  const { t } = useTranslation();
  return (
    <>
      <dl className="live-data-rows">
        {/* The store only when it isn't the launcher's own (GOG through Heroic). */}
        {game.store !== game.launcher && (
          <div>
            <dt>{t("desktop.library.store")}</dt>
            <dd className="launcher-name">
              <LauncherIcon id={game.store} />
              {t(`desktop.library.storeName.${game.store}`)}
            </dd>
          </div>
        )}
        <div>
          <dt>{t("desktop.library.launcher")}</dt>
          <dd className="launcher-name">
            <LauncherIcon id={game.launcher} />
            {t(`desktop.library.launcherName.${game.launcher}`)}
          </dd>
        </div>
        <div>
          <dt>{t("desktop.library.id")}</dt>
          <dd className="dk-mono">{game.id}</dd>
        </div>
        {info?.sizeBytes && (
          <div>
            <dt>{t("desktop.library.size")}</dt>
            <dd>{(info.sizeBytes / 1e9).toFixed(1)} GB</dd>
          </div>
        )}
        {info?.lastUpdated && (
          <div>
            <dt>{t("desktop.library.updated")}</dt>
            <dd>{new Date(info.lastUpdated * 1000).toLocaleDateString()}</dd>
          </div>
        )}
      </dl>
      {info?.installDir && (
        <p className="dk-hint dk-mono gp-path" title={info.installDir}>
          {info.installDir}
        </p>
      )}
    </>
  );
}
