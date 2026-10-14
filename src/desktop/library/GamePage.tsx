// One game's page in the Games library, like every page: the main view is the
// artwork (hero + logo), one bar with Play, the quick links and the play
// stats, and the game "at a glance" (tiles that each open their section);
// the accordion at the right holds the rest: Controller profile, Setup, HDR,
// Compatibility (Proton games on Linux), DualSense support (with the
// player's rating), Notes and Details. Each fact has one place: the tier in
// DualSense support, the Proton in Compatibility, store and launcher in
// Details. The page keeps the game's own accent (scopedAccent), panel
// included; the pins are shared by every game's page.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BadgeCheck, Info, Layers, NotebookPen, SlidersHorizontal, Sun, Wrench } from "lucide-react";
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
import { causeText, shown } from "../shownError";
import { captureProfile, clearGroup, gameGroups, pruneProfile, settingsFrom, shownValues, upgradeProfile, type ProfileGroup } from "./profileValues";
import { X } from "lucide-react";
import { CURVE_PRESETS, DEFAULT_CUSTOM_POINTS } from "../../protocol/stickCurve";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { BusyButton, Row } from "../controls";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";
import { OverwrittenNotice, RestartNotice, useMsg, useRestartText } from "../pages/GamesPage";
import { overwrittenBy, rememberApplied, restartFor, startedSinceCheck, useFreshRunning } from "../games/launcherCheck";
import type { GameEntry, GameInfo, GamesReport, ModeInfo } from "../games/types";
import { API_NAME } from "../games/gameArgs";
import { ART_SHOWN, artUrl } from "../games/types";
import { headerArt, useArtColor } from "./gameArt";
import { FEEDBACK_TAGS, type GameRecord, type LibraryFile, type Mine, type ProfileSettings } from "../games/library";
import { fixesFor, staleness, supportOf, type FeatureState } from "./support";
import { GameActions, PlayStats } from "./playBar";
import Notice from "../Notice";
import { Section, SplitView } from "../accordion/Section";
import { pinScope, useAccordion } from "../accordion/useAccordion";
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
  const mineState = useMine(game, info, record, onLibrary, onRescan);
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

  // Each section's status line (and the tiles that open them).
  const normal = library.restore?.settings ?? (bridge.config ? settingsFrom(bridge.config) : null);
  const profile = record?.profile?.settings ?? null;
  const changes = useProfileChips(profile, normal, !!bridge.client?.splitHaptics).length;
  const profileStatus = profile
    ? // loop: NOT-WORTH — N = 2 parts of one status line
      [running && t("desktop.library.activeNow"), t("desktop.library.profileChanges", { count: changes })].filter(Boolean).join(" · ")
    : t("desktop.library.profileNoneShort");
  const setupLine = status.passed > 0 ? `✓ ${t("desktop.library.setupAllSet", { count: status.passed })}` : `✓ ${t("desktop.library.setupNone")}`;
  const setupTask = status.attention && t("desktop.library.needsAttention");
  // loop: HOT-PATH-OK — N = screens, 1-3; game page render
  const hdrScreens = report.system.hdr.screens.filter((x) => x.hdr).map((x) => x.name);
  const hdrLine = isHdr
    ? `${t("desktop.library.supportsHdr")} · ${hdrScreens.length ? t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") }) : t(`desktop.games.hdrOff.${report.system.hdr.check}`)}`
    : t("desktop.library.hdrUnknown");
  const support = supportOf(game);
  const tier = `${TIER_ICON[support.tier]} ${t(`desktop.library.tier.${support.tier}`)}`;
  const runner = `${game.runnerMissing ? "⚠ " : ""}${game.runner ?? t("desktop.library.launcherDefault")}`;
  const store = t(`desktop.library.storeName.${game.store}`);

  // The game at a glance: a tile per section that says the most, each opening it (flashed; the drawer when narrow).
  const tile = (id: SectionId<"game">, label: string, value: string, hint?: string | false) => (
    <button key={id} type="button" className="gp-tile" title={t("desktop.library.glanceOpen", { section: label })} onClick={() => acc.reveal(id)}>
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
        {tile("support", t("desktop.library.section.support"), tier, t(`desktop.library.tierHint.${support.tier}`))}
        {protonApplies() && tile("compatibility", t("desktop.library.runsWith"), runner, game.usesOurProton && t("desktop.library.usesOurs"))}
        {tile("profile", t("desktop.library.section.profile"), profileStatus)}
        {tile("setup", t("desktop.library.section.setup"), setupTask || setupLine)}
      </div>
    </>
  );

  return (
    <div className="gp" ref={page} style={accent ?? undefined}>
      <SplitView page="game" main={main} title={game.title} sub={t(`desktop.library.launcherName.${game.launcher}`)} state={acc}>
        <Section id="profile" icon={SlidersHorizontal} title={t("desktop.library.section.profile")} status={profileStatus}>
          {() => <ProfileBody game={game} record={record} bridge={bridge} normal={normal} onLibrary={onLibrary} />}
        </Section>
        <Section id="setup" icon={Wrench} title={t("desktop.library.section.setup")} status={setupLine} task={setupTask}>
          {() => <SetupBody game={game} report={report} mineState={mineState} onRescan={onRescan} status={status} />}
        </Section>
        {proton && (
          <Section id="hdr" icon={Sun} title={t("desktop.library.hdrTitle")} status={hdrLine} task={hdrTask && t("desktop.library.needsAttention")}>
            {() => <HdrBody game={game} report={report} mineState={mineState} hdrReqs={hdrReqs} isHdr={isHdr} />}
          </Section>
        )}
        {protonApplies() && (
          <Section id="compatibility" icon={Layers} title={t("desktop.library.section.compat")} status={runner}>
            {() => <CompatBody game={game} report={report} onRescan={onRescan} />}
          </Section>
        )}
        <Section id="support" icon={BadgeCheck} title={t("desktop.library.section.support")} status={mine.rating ? `${tier} · ${"★".repeat(mine.rating)}${"☆".repeat(5 - mine.rating)}` : tier}>
          {() => <SupportBody game={game} info={info} mineState={mineState} />}
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
        {/* loop: NOT-WORTH — N = 2 parts of one status line */}
        <Section id="details" icon={Info} title={t("desktop.library.section.details")} status={[store, info?.sizeBytes && `${(info.sizeBytes / 1e9).toFixed(1)} GB`].filter(Boolean).join(" · ")}>
          {() => <DetailsBody game={game} info={info} />}
        </Section>
      </SplitView>
    </div>
  );
}

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
        <p className="dk-hint">{t("desktop.library.profileNone")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn primary" disabled={!config} onClick={() => config && create(captureProfile(config, normal, undefined))}>
            {t("desktop.library.profileFromCurrent")}
          </button>
        </div>
        {!config && <p className="dk-hint">{t("desktop.library.profileNeedsDongle")}</p>}
      </>
    );
  const edit = (patch: Partial<ProfileSettings>) => set({ ...upgradeProfile(draft), ...patch });
  return (
    <>
      <ProfileSummary draft={draft} normal={normal} split={!!bridge.client?.splitHaptics} onChange={set} />
      <LayoutPicker value={draft.buttonLayout} bridge={bridge} onChange={(id) => edit({ buttonLayout: id })} />
      <CurvePicker value={draft.stickCurves} bridge={bridge} onChange={(stickCurves) => edit({ stickCurves })} />
      <div className="dk-row-btns">
        <button type="button" className="dk-btn primary" disabled={!bridge.isConnected} title={t("desktop.editing.openHint")} onClick={() => editProfile(game.key, game.title)}>
          {t("desktop.editing.open")}
        </button>
        <button type="button" className="dk-btn" disabled={!config} title={t("desktop.profile.copyHint")} onClick={() => config && create(captureProfile(config, normal, draft))}>
          {t("desktop.library.profileCopyCurrent")}
        </button>
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
type Chip = { key: string; text: string; clear: () => ProfileSettings };
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
    text: `${label[g]}: ${value[g]()}`,
    clear: () => clearGroup(draft, g),
  }));
  const layout = draft.buttonLayout ? library.layouts?.[draft.buttonLayout] : undefined;
  if (draft.buttonLayout)
    chips.push({ key: "layout", text: `${t("desktop.layouts.profileLabel")}: ${layout?.name ?? t("desktop.layouts.normal")}`, clear: () => ({ ...draft, buttonLayout: undefined }) });
  // loop: HOT-PATH-OK — N = 2 sticks
  for (const side of ["left", "right"] as const) {
    const curve = draft.stickCurves?.[side];
    if (!curve) continue;
    chips.push({
      key: `curve-${side}`,
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
  const chips = useProfileChips(draft, normal, split);
  return (
    <>
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
      <Row label={t("desktop.layouts.profileLabel")}>
        <select className="dk-select" value={value ?? ""} disabled={oldFirmware || (layouts.length === 0 && !value)} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{t("desktop.layouts.normal")}</option>
          {/* loop: HOT-PATH-OK — N = saved button layouts (a few) */}
          {layouts.map(([id, l]) => (
            <option key={id} value={id}>
              {l.name}
            </option>
          ))}
        </select>
      </Row>
      {oldFirmware ? (
        <p className="dk-hint">{t("desktop.layouts.needsFirmware")}</p>
      ) : layouts.length === 0 ? (
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
      {/* loop: HOT-PATH-OK — N = 2 sticks */}
      {(["left", "right"] as const).map((side) => (
        <Row key={side} label={t(side === "left" ? "desktop.curves.profileLeft" : "desktop.curves.profileRight")}>
          <select className="dk-select" value={value?.[side]?.type ?? ""} disabled={oldFirmware} onChange={(e) => pick(side, e.target.value)}>
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
      <p className="dk-hint">{oldFirmware ? t("desktop.curves.needsFirmware") : t("desktop.curves.profileHint")}</p>
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
      // error: SHOWN — english: the note under Set up (main-process text, or desktop.errors.badRequest)
      setNote(causeText(cause));
      setConfirm(false);
    }
  };
  // XInput-only games on our list get the standard-gamepad fix by themselves;
  // for any other Proton game the player can say the controller isn't detected.
  const canMark = canMarkNotDetected(game);
  const marked = !!mine.tags?.includes("not-detected");
  const toggleMark = () => update({ tags: marked ? (mine.tags ?? []).filter((x) => x !== "not-detected") : [...(mine.tags ?? []), "not-detected"] });
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
      {game.gamepad === "no-build" && <p className="dk-hint">{t("desktop.library.gamepadNoBuild", { runner: game.runner ?? "" })}</p>}
      {game.mode?.state === "own" && <ModeNote game={game} mode={game.mode} />}
      {status.passed > 0 ? (
        <details className="gp-legend gp-checks">
          <summary>
            {status.attention ? t("desktop.library.setupPassed", { count: status.passed }) : <span className="dk-good">✓ {t("desktop.library.setupAllSet", { count: status.passed })}</span>}
          </summary>
          {game.gamepad === "set" && <p className="dk-good">✓ {t("desktop.library.gamepadSet")}</p>}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
          {game.mode?.state === "set" && <ModeNote game={game} mode={game.mode} />}
        </details>
      ) : (
        <>
          {!status.attention && <p className="dk-good">✓ {t("desktop.library.setupNone")}</p>}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
        </>
      )}
      {canMark && (
        <details className="gp-legend gp-marks">
          <summary>
            {t("desktop.library.marksTitle")}
            {marked && " (1)"}
          </summary>
          <label className="dk-fix">
            <input type="checkbox" checked={marked} onChange={toggleMark} />
            <span>
              <span className="dk-fix-label">{t("desktop.library.tag.not-detected")}</span>
              <span className="dk-fix-why">{t("desktop.library.notDetectedHint")}</span>
            </span>
          </label>
        </details>
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
  return mode.state === "set" ? <p className="dk-good">✓ {t("desktop.library.modeSet", params)}</p> : <p className="dk-hint">{t("desktop.library.modeOwn", params)}</p>;
}

// ---- Compatibility (Proton) ----
// Which Proton runs the game; the recommended one and why only while it's
// another (the store is in Details).
function CompatBody({ game, report, onRescan }: { game: GameEntry; report: GamesReport; onRescan: () => void }) {
  const { t } = useTranslation();
  const restartText = useRestartText();
  const ours = report.ourProton.name;
  // loop: HOT-PATH-OK — N = one game's fixes (≤ ~5)
  const runnerFix = game.fixes.find((f) => f.kind === "set-runner");
  // A running launcher is closed and reopened for the switch: said first, then
  // confirmed. Which ones run is checked when the page opens and after each scan.
  const fresh = useFreshRunning(runnerFix ? report.scannedAt : null);
  const restart = runnerFix ? restartFor(report, [runnerFix], fresh) : [];
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const switchRunner = async () => {
    let again = false;
    try {
      const r = await thenRescan(() => window.desktop!.gamesApply({ fixIds: [runnerFix!.id], restart }), onRescan);
      rememberApplied(r.applied.filter((a) => a.ok).map((a) => a.id));
      setNote(restartText(r));
      again = startedSinceCheck(r); // nothing written: the notice names it, the button asks again
    } catch (cause) {
      // error: SHOWN — english: the note under the runner switch (main-process text, or desktop.errors.badRequest)
      setNote(causeText(cause));
    }
    setConfirm(again);
  };
  const native = game.support === "triggers" || game.support === "haptics";
  return (
    <>
      <Row label={t("desktop.library.runsWith")} invalid={game.runnerMissing} stack>
        <span className="dk-mono" title={game.runner ?? undefined}>
          {game.runnerMissing ? "⚠ " : ""}
          {game.runner ?? t("desktop.library.launcherDefault")}
        </span>
      </Row>
      {!game.usesOurProton && (
        <>
          <Row label={t("desktop.library.recommended")} stack>
            <span className="dk-mono">{native ? (ours ?? t("desktop.library.protonNotInstalled")) : t("desktop.library.anyProton")}</span>
          </Row>
          {native && <p className="dk-hint">{t("desktop.library.compatHint")}</p>}
        </>
      )}
      {game.usesOurProton ? (
        <p className="dk-good">✓ {t("desktop.library.usesOurs")}</p>
      ) : runnerFix ? (
        <>
          {confirm && <RestartNotice launchers={restart} />}
          <div className="dk-row-btns">
            {confirm && (
              <button type="button" className="dk-btn" onClick={() => setConfirm(false)}>
                {t("desktop.library.cancel")}
              </button>
            )}
            <BusyButton className="dk-btn primary" onClick={() => (restart.length && !confirm ? Promise.resolve(setConfirm(true)) : switchRunner())}>
              {t("desktop.library.switchTo", { name: ours })}
            </BusyButton>
          </div>
        </>
      ) : null}
      {note && <p className="dk-hint">{note}</p>}
    </>
  );
}

// ---- DualSense support ----
function SupportBody({ game, info, mineState }: { game: GameEntry; info?: GameInfo; mineState: MineState }) {
  const { t } = useTranslation();
  const s = supportOf(game);
  return (
    <>
      <p className={`gp-tier ${s.tier}`}>
        <b>
          {TIER_ICON[s.tier]} {t(`desktop.library.tier.${s.tier}`)}
        </b>
        <br />
        <span className="dk-hint">{t(`desktop.library.tierHint.${s.tier}`)}</span>
      </p>
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
      <details className="gp-legend">
        <summary>{t("desktop.library.tierLegend")}</summary>
        <ul className="dk-review">
          {/* loop: HOT-PATH-OK — N = 6 support tiers */}
          {(["verified", "works", "needs-setup", "partial", "broken", "unknown"] as const).map((tier) => (
            <li key={tier}>
              <b>
                {TIER_ICON[tier]} {t(`desktop.library.tier.${tier}`)}
              </b>{" "}
              <span className="dk-hint">{t(`desktop.library.tierHint.${tier}`)}</span>
            </li>
          ))}
        </ul>
      </details>
      <ul className="gp-features">
        {/* loop: HOT-PATH-OK — N = 5 features */}
        {(["triggers", "haptics", "speaker", "mic", "lightbar"] as const).map((f) => (
          <li key={f} title={t(`desktop.library.feature.${s.features[f]}`)}>
            <span aria-hidden="true">{FEATURE_ICON[s.features[f]]}</span> {t(`desktop.library.featureName.${f}`)}
          </li>
        ))}
      </ul>
      <RatingPart game={game} info={info} mineState={mineState} />
    </>
  );
}

// ---- The player's own rating and notes (local; sharing comes later) ----
// One copy per page, shared by the rating (in DualSense support) and Notes: the library
// stores the whole record, so two copies would overwrite each other's fields.
type MineState = readonly [Mine, (patch: Partial<Mine>) => void];
function useMine(game: GameEntry, info: GameInfo | undefined, record: GameRecord | undefined, onLibrary: (f: LibraryFile) => void, onRescan: () => void): MineState {
  const app = window.desktop!.appVersion;
  const notDetected = (m?: Mine) => !!m?.tags?.includes("not-detected");
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
    // A rating or feedback change re-stamps what it was given on.
    const stamp = ("rating" in patch || "tags" in patch) && app ? { ratedOn: { app, build: info?.buildId, gameUpdated: info?.lastUpdated, at: Math.floor(Date.now() / 1000) } } : {};
    set({ ...mine, ...patch, ...stamp });
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
  // "Controller not detected" lives in Setup where it's a mark that acts.
  // loop: HOT-PATH-OK — N = feedback tags (under 10)
  const tags = FEEDBACK_TAGS.filter((tag) => tag !== "not-detected" || !canMarkNotDetected(game));
  // loop: HOT-PATH-OK — N = feedback tags (under 10)
  const picked = tags.filter((tag) => mine.tags?.includes(tag)).length;
  const rating = mine.rating;
  const lit = preview ?? rating;
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
            <button type="button" className="dk-btn dk-inline-btn" onClick={() => update({ tags: mine.tags ?? [] })}>
              {t("desktop.library.stillAccurate")}
            </button>
          </span>
        </Notice>
      )}
      <details className="gp-legend">
        <summary>
          {t("desktop.library.feedbackHint")}
          {picked > 0 && ` (${picked})`}
        </summary>
        <ul className="gp-tags">
          {/* loop: HOT-PATH-OK — N = feedback tags (under 10) */}
          {tags.map((tag) => {
            const on = mine.tags?.includes(tag) ?? false;
            return (
              <li key={tag}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => update({ tags: on ? (mine.tags ?? []).filter((x) => x !== tag) : [...(mine.tags ?? []), tag] })} />{" "}
                  {t(`desktop.library.tag.${tag}`)}
                </label>
              </li>
            );
          })}
        </ul>
      </details>
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
