// One game's page in the Games library, laid out like Steam's: the artwork
// (hero + logo), one bar with Play, the quick links and the play stats, then
// frames in two columns. What needs the player comes first (Setup, when
// something is waiting), then the game's controller profile; a healthy Setup
// is one "All set" line. Each fact has one place: the tier in DualSense
// support, the Proton in Compatibility, store and launcher in Details.
import { useEffect, useRef, useState } from "react";
import { useLibrary } from "./libraryContext";
import { layoutSummary } from "../live/layoutSummary";
import { FEATURES2, supportsFeature2 } from "../../protocol/bridgeClient";
import { LauncherIcon } from "./LauncherIcon";
import { protonApplies } from "../games/platform";
import { knownHdr } from "../games/knownGames";
import { HdrChecklist, HdrManual } from "./HdrChecklist";
import { hdrGameReqs, type HdrReq } from "../games/hdrSetup";
import { canMarkNotDetected, setupStatus } from "./setupStatus";
import { thenRescan } from "../games/scanOrder";
import { useDebouncedSave } from "./useDebouncedSave";
import { setBackdropGame } from "../live/ArtBackdrop";
import { onThemeChange, scopedAccent } from "../live/controllerAccent";
import { errorText } from "../../errorText";
import { captureProfile, clearGroup, gameGroups, pruneProfile, settingsFrom, shownValues, upgradeProfile, type ProfileGroup } from "./profileValues";
import { X } from "lucide-react";
import { CURVE_PRESETS, DEFAULT_CUSTOM_POINTS } from "../../protocol/stickCurve";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { BusyButton, Row } from "../controls";
import LightbarPage, { LIGHTBAR_MODES } from "../pages/LightbarPage";
import { AutoHapticsSection, HapticsSection, MicSection, SpeakerSection, TriggerIntensitySection } from "../pages/SettingsPage";
import { profileFields } from "./profileFields";
import { OverwrittenNotice, RestartNotice, useMsg, useRestartText } from "../pages/GamesPage";
import { overwrittenBy, rememberApplied, restartFor, startedSinceCheck, useFreshRunning } from "../games/launcherCheck";
import type { GameEntry, GameInfo, GamesReport, ModeInfo } from "../games/types";
import { API_NAME } from "../games/gameArgs";
import { artUrl } from "../games/types";
import { FEEDBACK_TAGS, type GameRecord, type LibraryFile, type Mine, type ProfileSettings } from "../games/library";
import { fixesFor, staleness, supportOf, type FeatureState } from "./support";
import { PlayButton, PlayStats, useGameAction } from "./playBar";

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
  const scroller = useRef<HTMLDivElement>(null);
  const mineState = useMine(game, info, record, onLibrary, onRescan);
  const has = (k: string) => info?.art.includes(k as never) ?? false;
  // The page takes the game's artwork color as its accent (the rest of the
  // app keeps the controller's); same legibility rules, scoped to the page.
  // Recomputed when the theme, the controller tint or the look changes (the
  // page's cards are mixed from the panel color those set).
  const [artColor, setArtColor] = useState<string | null>(null);
  const [accent, setAccent] = useState<Record<string, string> | null>(null);
  // lifetime: OK — acquires nothing; the cleanup drops a late art color (game change, unmount)
  useEffect(() => {
    let live = true;
    void window
      .desktop!.gameArtColor(game.key)
      .then((c) => live && setArtColor(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [game.key]);
  // lifetime: OK — cleanup unsubscribes the theme listener and cancels the frame
  useEffect(() => {
    if (!artColor) return;
    const el = scroller.current;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // lifetime: OK — one-shot, cancelled by the next update() and the effect cleanup
      frame = requestAnimationFrame(() => setAccent(scopedAccent(artColor, el)));
    };
    update();
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
  // Scroll back to the top when another game is opened.
  // lifetime: OK — acquires nothing (scrolls to the top)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [game.key]);

  // HDR games on Linux: the checklist decides whether Setup needs the player.
  const isHdr = isProtonGame(game) && game.hdr !== undefined;
  // loop: HOT-PATH-OK — N = 3 launchers
  const flatpak = !!report.launchers.find((l) => l.id === game.launcher)?.flatpak;
  const hdrReqs = isHdr ? hdrGameReqs(report.system.hdr, game, { ourProton: report.ourProton.name, flatpak }) : [];
  const status = setupStatus(game, hdrReqs);
  // Setup comes first while it needs the player. Keyed, so moving it keeps
  // its state (Apply's result note) and the profile's pending edits.
  const setup = <SetupFrame key="setup" game={game} report={report} mineState={mineState} onRescan={onRescan} hdrReqs={hdrReqs} isHdr={isHdr} attention={status.attention} />;
  const profile = <ProfileFrame key="profile" game={game} record={record} running={running} bridge={bridge} onLibrary={onLibrary} />;

  return (
    <div className="gp" ref={scroller} style={accent ?? undefined}>
      <header className={`gp-hero${has("hero") ? "" : " plain"}`} style={has("hero") ? { backgroundImage: `url("${artUrl(game.key, "hero")}")` } : undefined}>
        {has("logo") ? <img className="gp-logo" src={artUrl(game.key, "logo")} alt={game.title} /> : <h1 className="gp-title">{game.title}</h1>}
      </header>

      <div className="gp-bar">
        <GameActions game={game} info={info} running={running} />
        <PlayStats info={info} running={running} />
      </div>

      <div className="gp-cols">
        <div className="gp-col">
          {status.attention ? [setup, profile] : [profile, setup]}
          <RatingFrame game={game} info={info} mineState={mineState} />
          <NotesFrame mineState={mineState} />
        </div>
        <div className="gp-col">
          <SupportFrame game={game} />
          {protonApplies() && <CompatFrame game={game} report={report} onRescan={onRescan} />}
          <DetailsFrame game={game} info={info} />
        </div>
      </div>
    </div>
  );
}

// A game Proton runs (Linux, a launcher with per-game Proton settings).
const isProtonGame = (game: GameEntry) => protonApplies() && (game.launcher === "steam" || game.launcher === "heroic" || game.launcher === "lutris");

const TIER_ICON: Record<string, string> = { verified: "✓✓", works: "✓", "needs-setup": "⚙", partial: "◐", broken: "✗", unknown: "?" };
const FEATURE_ICON: Record<FeatureState, string> = { yes: "✓", no: "✗", unknown: "?" };

// ---- Controller profile ----

function ProfileFrame({ game, record, running, bridge, onLibrary }: { game: GameEntry; record?: GameRecord; running: boolean; bridge: UseDs5BridgeResult; onLibrary: (f: LibraryFile) => void }) {
  const { t } = useTranslation();
  const { editProfile, library } = useLibrary();
  const desktop = window.desktop!;
  const config = bridge.config;
  // The normal settings: under a profile that's on now its restore point,
  // else what the dongle has.
  const normal = library.restore?.settings ?? (config ? settingsFrom(config) : null);
  const [allOpen, setAllOpen] = useState(false);

  // Every edit is stored (debounced), keeping only what differs from the
  // normal settings; applying it to the dongle while the game runs (or is
  // edited) is the profile hook's job.
  const {
    value: draft,
    set,
    cancel,
  } = useDebouncedSave<ProfileSettings | null>(
    record?.profile?.settings ?? null,
    (next) => (next ? desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: pruneProfile(next, normal) }).then(onLibrary) : Promise.resolve()),
    400,
  );
  const create = (from: ProfileSettings) => {
    cancel();
    void desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: from }).then(onLibrary);
  };
  const remove = () => {
    cancel();
    void desktop.libraryDeleteProfile(game.key).then(onLibrary);
  };

  return (
    <section className="dk-card" id="gp-profile">
      <h2>
        {t("desktop.library.section.profile")} {draft && running && <span className="dk-chip ok">{t("desktop.library.activeNow")}</span>}
      </h2>
      {!draft ? (
        <>
          <p className="dk-hint">{t("desktop.library.profileNone")}</p>
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" disabled={!config} onClick={() => config && create(captureProfile(config, normal, undefined))}>
              {t("desktop.library.profileFromCurrent")}
            </button>
          </div>
          {!config && <p className="dk-hint">{t("desktop.library.profileNeedsDongle")}</p>}
        </>
      ) : (
        <>
          <ProfileSummary draft={draft} normal={normal} split={!!bridge.client?.splitHaptics} onChange={set} />
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
          <details className="gp-legend" onToggle={(e) => setAllOpen(e.currentTarget.open)}>
            <summary>{t("desktop.profile.allSettings")}</summary>
            {/* Built only while open: closed, the controls would still be in the page (unnamed, unseen). */}
            {allOpen && (normal ? <AllProfileSettings draft={draft} normal={normal} bridge={bridge} onChange={set} /> : <p className="dk-hint">{t("desktop.library.profileNeedsDongle")}</p>)}
          </details>
        </>
      )}
    </section>
  );
}

// What this game's profile changes, as small "name: value" chips (only what
// differs from the normal settings); each one's button goes back to the
// normal setting. Everything not listed uses the normal settings.
function ProfileSummary({ draft, normal, split, onChange }: { draft: ProfileSettings; normal: ProfileSettings | null; split: boolean; onChange: (s: ProfileSettings) => void }) {
  const { t } = useTranslation();
  const { library } = useLibrary();
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
  const chips: Array<{ key: string; text: string; clear: () => ProfileSettings }> = gameGroups(draft, normal).map((g) => ({
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

// Every setting a profile can hold, for quick edits on the game page (the
// controller view edits them all, live): the controller view's own sections,
// with this game's profile draft. A setting shows the game's value or, marked,
// the normal one; changing it makes it this game's.
function AllProfileSettings({ draft, normal, bridge, onChange }: { draft: ProfileSettings; normal: ProfileSettings; bridge: UseDs5BridgeResult; onChange: (s: ProfileSettings) => void }) {
  const { t } = useTranslation();
  const fields = profileFields(bridge.config ?? bridge.draft, normal, draft, onChange);
  const edit = (patch: Partial<ProfileSettings>) => onChange({ ...upgradeProfile(draft), ...patch });
  return (
    <div className="gp-sections">
      <p className="dk-hint">{t("desktop.library.profileHint")}</p>
      <HapticsSection bridge={bridge} fields={fields} />
      <AutoHapticsSection bridge={bridge} fields={fields} />
      <TriggerIntensitySection bridge={bridge} fields={fields} />
      <SpeakerSection bridge={bridge} fields={fields} />
      <LightbarPage bridge={bridge} fields={fields} />
      <MicSection bridge={bridge} fields={fields} />
      <LayoutPicker value={draft.buttonLayout} bridge={bridge} onChange={(id) => edit({ buttonLayout: id })} />
      <CurvePicker value={draft.stickCurves} bridge={bridge} onChange={(stickCurves) => edit({ stickCurves })} />
    </div>
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
// What needs the player is shown open: the fixes with Review / Apply, a
// standard gamepad that can't be set, the player's own graphics mode, an HDR
// checklist with a ✗. Everything that passed folds into one line ("All set",
// or "N checks passed" under the open part), and the player's marks for games
// we don't know fold under "Not working as expected? (n marked)".
function SetupFrame({
  game,
  report,
  mineState,
  onRescan,
  hdrReqs,
  isHdr,
  attention,
}: {
  game: GameEntry;
  report: GamesReport;
  mineState: MineState;
  onRescan: () => void;
  hdrReqs: HdrReq[];
  isHdr: boolean;
  attention: boolean;
}) {
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
      setNote(errorText(cause));
      setConfirm(false);
    }
  };
  // XInput-only games on our list get the standard-gamepad fix by themselves;
  // for any other Proton game the player can say the controller isn't detected.
  const canMark = canMarkNotDetected(game);
  const marked = !!mine.tags?.includes("not-detected");
  const toggleMark = () => update({ tags: marked ? (mine.tags ?? []).filter((x) => x !== "not-detected") : [...(mine.tags ?? []), "not-detected"] });
  // HDR games on our list get "Turn on HDR" by themselves; the player can mark others.
  const canMarkHdr = isProtonGame(game) && !knownHdr(game.title);
  const marks = (canMark && marked ? 1 : 0) + (canMarkHdr && mine.hdr ? 1 : 0);
  const hdrSys = report.system.hdr;
  const { hdrOk, passed } = setupStatus(game, hdrReqs);
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
  const hdr = isHdr && (
    <div className="hdr-game">
      <h3>{t("desktop.library.hdrTitle")}</h3>
      <HdrChecklist reqs={hdrReqs} />
      <HdrManual game={game} sys={hdrSys} ourProton={report.ourProton.name} />
    </div>
  );
  return (
    <section className="dk-card" id="gp-setup">
      <h2>
        {t("desktop.library.section.setup")}{" "}
        {attention && (
          <span className="dk-chip warn">
            <span className="dot" aria-hidden="true" />
            {t("desktop.library.needsAttention")}
          </span>
        )}
      </h2>
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
      {note && <p className="dk-hint">{note}</p>}
      {game.gamepad === "no-build" && <p className="dk-hint">{t("desktop.library.gamepadNoBuild", { runner: game.runner ?? "" })}</p>}
      {game.mode?.state === "own" && <ModeNote game={game} mode={game.mode} />}
      {!hdrOk && hdr}
      {passed > 0 ? (
        <details className="gp-legend gp-checks">
          <summary>{attention ? t("desktop.library.setupPassed", { count: passed }) : <span className="dk-good">✓ {t("desktop.library.setupAllSet", { count: passed })}</span>}</summary>
          {game.gamepad === "set" && <p className="dk-good">✓ {t("desktop.library.gamepadSet")}</p>}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
          {game.mode?.state === "set" && <ModeNote game={game} mode={game.mode} />}
          {hdrOk && hdr}
        </details>
      ) : (
        <>
          {!attention && <p className="dk-good">✓ {t("desktop.library.setupNone")}</p>}
          {game.gamepad === "steam-input" && <p className="dk-hint">{t("desktop.library.gamepadSteamInput")}</p>}
        </>
      )}
      {(canMark || canMarkHdr) && (
        <details className="gp-legend">
          <summary>
            {t("desktop.library.marksTitle")}
            {marks > 0 && ` (${marks})`}
          </summary>
          {canMark && (
            <label className="dk-fix">
              <input type="checkbox" checked={marked} onChange={toggleMark} />
              <span>
                <span className="dk-fix-label">{t("desktop.library.tag.not-detected")}</span>
                <span className="dk-fix-why">{t("desktop.library.notDetectedHint")}</span>
              </span>
            </label>
          )}
          {canMarkHdr && (
            <label className="dk-fix">
              <input type="checkbox" checked={!!mine.hdr} onChange={() => update({ hdr: mine.hdr ? undefined : true })} />
              <span>
                <span className="dk-fix-label">{t("desktop.library.supportsHdr")}</span>
                <span className="dk-fix-why">{t("desktop.library.supportsHdrHint")}</span>
              </span>
            </label>
          )}
        </details>
      )}
    </section>
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
function CompatFrame({ game, report, onRescan }: { game: GameEntry; report: GamesReport; onRescan: () => void }) {
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
      setNote(errorText(cause));
    }
    setConfirm(again);
  };
  const native = game.support === "triggers" || game.support === "haptics";
  return (
    <section className="dk-card" id="gp-compat">
      <h2>{t("desktop.library.section.compat")}</h2>
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
    </section>
  );
}

// ---- DualSense support ----
function SupportFrame({ game }: { game: GameEntry }) {
  const { t } = useTranslation();
  const s = supportOf(game);
  return (
    <section className="dk-card" id="gp-support">
      <h2>{t("desktop.library.section.support")}</h2>
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
    </section>
  );
}

// ---- The player's own rating and notes (local; sharing comes later) ----
// One copy per page, shared by the Rating and Notes frames: the library
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

function RatingFrame({ game, info, mineState }: { game: GameEntry; info?: GameInfo; mineState: MineState }) {
  const { t } = useTranslation();
  const [mine, update] = mineState;
  const stale = staleness(mine.ratedOn, info ?? {}, fixesFor(game.title));
  // "Controller not detected" lives in Setup where it's a mark that acts.
  // loop: HOT-PATH-OK — N = feedback tags (under 10)
  const tags = FEEDBACK_TAGS.filter((tag) => tag !== "not-detected" || !canMarkNotDetected(game));
  // loop: HOT-PATH-OK — N = feedback tags (under 10)
  const picked = tags.filter((tag) => mine.tags?.includes(tag)).length;
  return (
    <section className="dk-card" id="gp-rating">
      <h2>{t("desktop.library.section.rating")}</h2>
      <div className="gp-stars" role="radiogroup" aria-label={t("desktop.library.section.rating")}>
        {/* loop: HOT-PATH-OK — N = 5 stars */}
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine.rating === n}
            aria-label={t("desktop.library.stars", { count: n })}
            className={(mine.rating ?? 0) >= n ? "on" : ""}
            onClick={() => update({ rating: mine.rating === n ? undefined : n })}
          >
            {(mine.rating ?? 0) >= n ? "★" : "☆"}
          </button>
        ))}
      </div>
      {stale && (
        <p className="dk-notice">
          {stale.kind === "our-fix"
            ? t("desktop.library.staleFix", { version: stale.app })
            : stale.at
              ? t("desktop.library.staleUpdateOn", { date: new Date(stale.at * 1000).toLocaleDateString() })
              : t("desktop.library.staleUpdate")}{" "}
          <button type="button" className="dk-btn dk-inline-btn" onClick={() => update({ tags: mine.tags ?? [] })}>
            {t("desktop.library.stillAccurate")}
          </button>
        </p>
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
    </section>
  );
}

function NotesFrame({ mineState }: { mineState: MineState }) {
  const { t } = useTranslation();
  const [mine, update] = mineState;
  return (
    <section className="dk-card" id="gp-notes">
      <h2>{t("desktop.library.section.notes")}</h2>
      <textarea className="dk-textarea" rows={4} maxLength={5000} placeholder={t("desktop.library.notesPlaceholder")} value={mine.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
    </section>
  );
}

function DetailsFrame({ game, info }: { game: GameEntry; info?: GameInfo }) {
  const { t } = useTranslation();
  return (
    <section className="dk-card" id="gp-details">
      <h2>{t("desktop.library.section.details")}</h2>
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
    </section>
  );
}

// Launch and open: the launcher's own links and the game's folders (built in
// the main process from the scan; only the actions this game has).
function GameActions({ game, info, running }: { game: GameEntry; info?: GameInfo; running: boolean }) {
  const { t } = useTranslation();
  const { run, failed } = useGameAction(game);
  const actions = info?.actions ?? [];
  if (actions.length === 0) return null;
  const launcher = t(`desktop.library.launcherName.${game.launcher}`);
  return (
    <div className="gp-actions">
      {actions.includes("play") && <PlayButton game={game} running={running} run={run} />}
      {/* loop: HOT-PATH-OK — N = 5 game actions */}
      {(["properties", "steamInput", "libraryPage", "installFolder", "prefixFolder"] as const)
        .filter((a) => actions.includes(a))
        .map((a) => (
          <BusyButton key={a} className="dk-btn" title={t(`desktop.library.action.${a}Hint`, { launcher })} onClick={() => run(a)}>
            {t(`desktop.library.action.${a}`)}
          </BusyButton>
        ))}
      {failed && <span className="dk-hint gp-action-failed">{t("desktop.library.action.failed")}</span>}
    </div>
  );
}
