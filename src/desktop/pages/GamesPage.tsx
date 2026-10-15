// Games → Home: checks Steam, Heroic and Lutris (Linux; Steam, GOG Galaxy
// and Epic on Windows) for settings that stop the DualSense's native features
// (adaptive triggers, haptics) from reaching games, and fixes them with the
// user's consent. Like every page: the library (Continue playing, the grid)
// is the main view, with This computer (Linux: controller audio and access,
// the environment, the HDR checklist; a readout, so a main-view MainBlock at
// its top, always shown), and game setup is the accordion at the
// right: Launchers, DualSense Proton (Linux), Recommended changes (the rail's
// count: its task dot) and Change history. Each section and block says its
// state in its header; what needs the player carries the yellow dot.
//
// Consent flow (load-bearing, see src/desktop/games/types.ts):
//   allow (first visit: what will be read, nothing until the user agrees)
//   -> scan (reads only) -> pick changes (each says what, why and which files)
//   -> review (every file listed; a running launcher that owns a change is
//      named there: it will be closed for the change, then reopened)
//   -> apply (backed up first) -> Undo (the same close-and-reopen, said first).
// Downloading Proton is its own confirmation with size and destination.
//
// The scan and the steps live here (useGamesSetup), not in the sections: a
// folded section renders nothing, and opening it again finds the review or
// an install where it was.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cpu, History, Layers, ListChecks, Rocket } from "lucide-react";
import { LauncherIcon } from "../library/LauncherIcon";
import { protonApplies } from "../games/platform";
import { latestOnly } from "../games/scanOrder";
import { HdrChecklist } from "../library/HdrChecklist";
import { homeStatus, systemHdrReqs } from "../library/setupStatus";
import { causeText, shownText } from "../shownError";
import { writePref } from "../storage";
import { readPrefJson } from "../persistedPref";
import { salvageStrings } from "../../persisted";
import GameLibrary from "../library/GameLibrary";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { GameProfileState } from "../library/useGameProfile";
import { useTranslation } from "react-i18next";
import { BusyButton } from "../controls";
import { sayInPassing } from "../narrator";
import type { GameBackup, ProtonProgress } from "../api";
import type { ApplyResult, CloseProblem, Fix, GamesReport, LauncherId, Msg, RestartList } from "../games/types";
import { allFixes } from "../games/types";
import { forgetApplied, overwrittenBy, rememberApplied, restartFor, startedSinceCheck, useFreshRunning } from "../games/launcherCheck";
import { logged } from "../../errorText";
import { feedProblemKey } from "../useUpdates";
import Notice from "../Notice";
import { Section } from "../accordion/Section";
import { pinScope, useAccordion } from "../accordion/useAccordion";
import { MainBlock, useMainBlock, type MainBlockState } from "../accordion/MainBlock";
import type { SectionId } from "../accordion/sections";

// Product names stay untranslated; "sideload" is translated where it's shown.
const LAUNCHER_NAME: Record<LauncherId, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris", gog: "GOG Galaxy", epic: "Epic Games" };
type Step = "pick" | "review" | "done";

// Changes the user unticked stay unticked across rescans and visits until
// they tick them again (a recommendation is a suggestion, not a default).
export const DECLINED_KEY = "ds5-games-declined";

// A damaged list keeps the changes that still read, and the notice says so
// (readPrefJson, batch E1).
export function loadDeclined(): Set<string> {
  return new Set(readPrefJson(DECLINED_KEY, { kind: "declinedFixes", salvage: (data) => salvageStrings(data), fallback: () => [] }));
}

const saveDeclined = (ids: Set<string>) => writePref(DECLINED_KEY, JSON.stringify([...ids]));

// Translate a main-process message (see Msg in games/types.ts); params may be messages too.
export function useMsg(): (m: Msg) => string {
  const { t } = useTranslation();
  return useCallback(
    function render(m: Msg): string {
      const params = Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, typeof v === "string" ? shownText(v) : render(v)]));
      return t(`desktop.games.msg.${m.key}`, { ...params, interpolation: { escapeValue: false } });
    },
    [t],
  );
}

// Said before applying (or undoing): which launchers will be closed and reopened.
export function RestartNotice({ launchers, undo }: { launchers: LauncherId[]; undo?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {/* loop: HOT-PATH-OK — N ≤ 3 launchers; shown only after applying fixes */}
      {launchers.map((l) => (
        <Notice key={l} closable>
          {t(undo ? "desktop.games.willRestartUndo" : "desktop.games.willRestart", { launcher: LAUNCHER_NAME[l] })}
        </Notice>
      ))}
    </>
  );
}

// A change applied this session that a launcher wrote back (launcherCheck.ts).
export function OverwrittenNotice({ launchers }: { launchers: LauncherId[] }) {
  const { t } = useTranslation();
  return (
    <>
      {/* loop: HOT-PATH-OK — N ≤ 3 launchers; shown only after a launcher overwrote a fix */}
      {launchers.map((l) => (
        <Notice key={l} closable>
          {t("desktop.games.launcherOverwrote", { launcher: LAUNCHER_NAME[l] })}
        </Notice>
      ))}
    </>
  );
}

// Why a launcher wasn't closed (nothing was written), or that one wasn't started again.
// error: SHOWN — desktop.games.restartGameRunning (inputs here; this is where blockedBy / problem become text)
export function useRestartText(): (r: { blockedBy?: LauncherId[]; problem?: CloseProblem; reopenFailed?: LauncherId[] }) => string | null {
  const { t } = useTranslation();
  return useCallback(
    (r) => {
      const name = (list?: LauncherId[]) => (list ?? []).map((l) => LAUNCHER_NAME[l]).join(", ");
      if (r.problem === "game-running") return t("desktop.games.restartGameRunning", { launcher: name(r.blockedBy) });
      if (r.problem === "timeout") return t("desktop.games.restartTimeout", { launcher: name(r.blockedBy) });
      if (r.problem) return t("desktop.games.restartFailed", { launcher: name(r.blockedBy) });
      if (startedSinceCheck(r)) return t("desktop.games.launcherStarted", { launcher: name(r.blockedBy) });
      if (r.reopenFailed?.length) return t("desktop.games.reopenFailed", { launcher: name(r.reopenFailed) });
      return null;
    },
    [t],
  );
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

interface GamesPageProps {
  bridge: UseDs5BridgeResult;
  profiles: GameProfileState;
  allowed: boolean;
  onAllowedChange: (allowed: boolean) => void;
  onScanned?: (report: GamesReport) => void;
  onDeclinedChange?: () => void;
  openGame?: { key: string } | null; // a game page to open (back from editing its profile)
}

export default function GamesPage({ allowed, onAllowedChange, ...rest }: GamesPageProps) {
  if (!allowed) return <GamesConsent onAllow={() => onAllowedChange(true)} />;
  return <GamesHome {...rest} />;
}

// First visit: say exactly what checking reads, and read nothing until the user agrees.
function GamesConsent({ onAllow }: { onAllow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="dk-stack">
      {/* settings-gate: not-settings — a gate screen: the first-visit consent (nothing is read before it), one card without a panel (decided 2026-10-15) */}
      <section className="dk-card">
        <h2>{t("desktop.games.title", "Game setup")}</h2>
        <p>{t(protonApplies() ? "desktop.games.consentIntro" : "desktop.games.consentIntroWindows")}</p>
        <ul className="dk-review">
          <li>{t(protonApplies() ? "desktop.games.consentLaunchers" : "desktop.games.consentLaunchersWindows")}</li>
          <li>{t(protonApplies() ? "desktop.games.consentAudio" : "desktop.games.consentRunningWindows")}</li>
          {protonApplies() && <li>{t("desktop.games.consentProton")}</li>}
        </ul>
        {/* hint: MUST-SHOW — what you agree to, before you allow it */}
        <p className="dk-hint">{t("desktop.games.consentPromise")}</p>
        {/* hint: MUST-SHOW — what you agree to, before you allow it */}
        <p className="dk-hint">{t("desktop.games.consentLibrary")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn primary" onClick={onAllow}>
            {t("desktop.games.consentAllow")}
          </button>
        </div>
      </section>
    </div>
  );
}

// Where a message from an action shows: the section the action is in (or, for a scan, above the sections).
type Place = "top" | Extract<SectionId<"games">, "proton" | "recommended" | "history">;
interface Placed {
  text: string;
  at: Place;
}

// The scan and every step of game setup (pick → review → done, Undo, the
// Proton install), kept while sections fold and open.
function useGamesSetup({ onScanned, onDeclinedChange }: Pick<GamesPageProps, "onScanned" | "onDeclinedChange">) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [report, setReport] = useState<GamesReport | null>(null);
  const [error, setError] = useState<Placed | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const declined = useRef<Set<string>>(loadDeclined());
  const [declinedAtScan, setDeclinedAtScan] = useState<ReadonlySet<string>>(loadDeclined);
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(ApplyResult & { labels: Map<string, Msg> }) | null>(null);
  const [closeNote, setCloseNote] = useState<Placed | null>(null);
  const restartText = useRestartText();
  // An undo that needs running launchers closed: said first, then confirmed (where it was asked).
  const [undoAsk, setUndoAsk] = useState<{ backupId: string; launchers: RestartList; at: Place } | null>(null);
  const [backups, setBackups] = useState<GameBackup[]>([]);
  const [protonConfirm, setProtonConfirm] = useState(false);
  const [protonProgress, setProtonProgress] = useState<ProtonProgress | null>(null);
  const [protonMessage, setProtonMessage] = useState<string | null>(null);

  const receive = useCallback(
    async (r: GamesReport, keepSelection: boolean) => {
      setReport(r);
      onScanned?.(r);
      setDeclinedAtScan(new Set(declined.current));
      const all = allFixes(r);
      setChosen((prev) => (keepSelection ? new Set(all.filter((f) => prev.has(f.id)).map((f) => f.id)) : new Set(all.filter((f) => f.recommended && !declined.current.has(f.id)).map((f) => f.id))));
      setBackups(await desktop.gamesBackups());
    },
    [desktop, onScanned],
  );

  // Overlapping scans (Rescan, a game page's change, Undo): only the newest is shown.
  const [latest] = useState(latestOnly);
  const rescan = useCallback(
    async (keepSelection = false) => {
      setError(null);
      try {
        const r = await latest(desktop.gamesScan());
        if (r.current) await receive(r.value, keepSelection);
      } catch (cause) {
        // error: SHOWN — desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections
        setError({ text: causeText(cause), at: "top" });
      }
    },
    [desktop, receive, latest],
  );

  // First scan on open (state is only set once the scan resolves).
  // lifetime: OK — acquires nothing; the cleanup drops a late scan result (unmount)
  useEffect(() => {
    let live = true;
    // error: SHOWN — desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections; receive's own failure too
    latest(desktop.gamesScan()).then(
      // error: SHOWN — desktop.errors.main.gamesNotAllowed (causeText): receive's failure (the backups list) above Home's sections
      (r) => live && r.current && void receive(r.value, false).catch((cause: unknown) => setError({ text: causeText(cause), at: "top" })),
      (cause: unknown) => live && setError({ text: causeText(cause), at: "top" }),
    );
    return () => {
      live = false;
    };
  }, [desktop, receive, latest]);
  // lifetime: OK — cleanup is onProtonProgress's unsubscribe (unmount)
  useEffect(() => desktop.onProtonProgress(setProtonProgress), [desktop]);
  // A game page applied something: rescan so Home and the library agree (the ticks stay).
  const rescanAfterChange = useCallback(() => void rescan(true).catch(logged("rescan (it shows its own errors)")), [rescan]);

  const fixes = useMemo(() => (report ? allFixes(report) : []), [report]);
  // loop: HOT-PATH-OK — fixes found by the scan, tens at most; Home render on interaction
  const selected = fixes.filter((f) => chosen.has(f.id));
  // The review checks the running launchers again when it opens (and after each scan).
  const [reviews, setReviews] = useState(0);
  const fresh = useFreshRunning(step === "review" ? `${reviews}|${report?.scannedAt}` : null);
  const restart = report ? restartFor(report, selected, fresh) : [];

  // Side effects (storage, the parent's count) stay out of the state updater,
  // which React may run twice.
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) {
      next.delete(id);
      declined.current.add(id);
    } else {
      next.add(id);
      declined.current.delete(id);
    }
    setChosen(next);
    saveDeclined(declined.current);
    onDeclinedChange?.();
  };

  const review = () => {
    setReviews((n) => n + 1);
    setStep("review");
  };

  const apply = async () => {
    setBusy("apply");
    setCloseNote(null);
    try {
      // Keep the labels: after the rescan, applied fixes are no longer in the list.
      const labels = new Map(selected.map((f) => [f.id, f.label]));
      const r = await desktop.gamesApply({ fixIds: selected.map((f) => f.id), restart });
      const note = restartText(r);
      if (r.blockedBy.length) {
        // Not closed (why), or a launcher started since the scan: the rescan
        // names it on the review, and Apply asks again.
        setCloseNote(note ? { text: note, at: "recommended" } : null);
        await rescan(true);
        return;
      }
      setCloseNote(note ? { text: note, at: "recommended" } : null);
      rememberApplied(r.applied.filter((a) => a.ok).map((a) => a.id));
      setResult({ ...r, labels });
      setStep("done");
      if (r.applied.length > 0 && r.applied.every((a) => a.ok)) sayInPassing("app_games_ready");
      await rescan();
    } catch (cause) {
      // error: SHOWN — desktop.errors.badRequest (causeText: a refused request in plain words; the main process's keyed errors too), in Recommended changes. Was SILENT-BUG: the rescan right after cleared the message at once
      await rescan(true); // something may have been written before it failed
      setError({ text: causeText(cause), at: "recommended" });
    } finally {
      setBusy(null);
    }
  };

  const undo = async (backupId: string, at: Place, restart: RestartList = []) => {
    setBusy(`undo-${backupId}`);
    setUndoAsk(null);
    const note = (text: string | null) => setCloseNote(text ? { text, at } : null);
    try {
      const r = await desktop.gamesUndo({ backupId, restart });
      setCloseNote(null);
      if (r.ok) {
        forgetApplied();
        // was SILENT-BUG: the audio service's failed restart was dropped
        // The old controller levels are back, but not in ALSA's saved state (the password prompt cancelled or failed).
        const volumeNote = r.volumeNotSaved
          ? t("desktop.games.undoVolumeNotSaved", { error: r.volumeNotSaved === "cancelled" ? t("desktop.games.msg.result.passwordCancelled") : shownText(r.volumeNotSaved) })
          : null;
        note(r.audioRestartFailed ? t("desktop.games.undoAudioRestart", { error: shownText(r.audioRestartFailed) }) : (volumeNote ?? restartText(r)));
        setResult(null);
        setStep("pick");
      } else if ("blockedBy" in r) {
        // Running launchers own these files: say they'll be closed and reopened, then ask.
        // One that started after the question was asked: said too, and asked again with it.
        if (r.problem || restart.length) note(restartText(r));
        if (!r.problem) setUndoAsk({ backupId, at, launchers: [...new Set([...restart, ...r.blockedBy.filter((l): l is RestartList[number] => l === "steam" || l === "heroic" || l === "lutris")])] });
      } else if ("conflict" in r) {
        note(t("desktop.games.undoConflict", { files: r.conflict.join(", ") }));
      } else if ("noController" in r) {
        note(t("desktop.games.undoNoController"));
      }
      await rescan();
      // After the rescan, which clears the error line (was SILENT-BUG: Undo's error vanished at once).
      if (!r.ok && "error" in r) setError({ text: shownText(r.error), at });
    } catch (cause) {
      // error: SHOWN — desktop.errors.badRequest (causeText; the main process's keyed errors too), in the section Undo was pressed in. Was SILENT-BUG: the rescan right after cleared the message at once
      await rescan(true);
      setError({ text: causeText(cause), at });
    } finally {
      setBusy(null);
    }
  };

  const installProton = async () => {
    setProtonConfirm(false);
    setBusy("proton");
    setProtonMessage(null);
    try {
      const r = await desktop.installProton();
      setProtonMessage(
        r.ok
          ? t("desktop.games.protonInstalled", { name: r.name, defaultValue: "{{name}} is installed." })
          : r.problem
            ? t(feedProblemKey(r.problem, "desktop.updateFeed.offline"))
            : shownText(r.message),
      );
      await rescan();
    } catch (cause) {
      // error: SHOWN — desktop.errors.main.protonLinuxOnly and the main process's other keyed errors (causeText), as DualSense Proton's message
      setProtonMessage(causeText(cause));
    } finally {
      setProtonProgress(null);
      setBusy(null);
    }
  };

  return {
    report,
    error,
    clearError: () => setError(null),
    closeNote,
    clearCloseNote: () => setCloseNote(null),
    declinedAtScan,
    fixes,
    chosen,
    selected,
    toggle,
    step,
    setStep,
    review,
    fresh,
    restart,
    busy,
    result,
    apply,
    undo,
    undoAsk,
    cancelUndo: () => setUndoAsk(null),
    backups,
    rescan,
    rescanAfterChange,
    protonConfirm,
    setProtonConfirm,
    protonProgress,
    protonMessage,
    installProton,
  };
}
type GamesSetup = ReturnType<typeof useGamesSetup>;

function GamesHome({ bridge, profiles, onScanned, onDeclinedChange, openGame }: Omit<GamesPageProps, "allowed" | "onAllowedChange">) {
  const { t } = useTranslation();
  const setup = useGamesSetup({ onScanned, onDeclinedChange });
  // The rail's Games count opens Recommended changes (a deep link), so no section opens by itself.
  const acc = useAccordion("games", pinScope("games"));
  const computer = useMainBlock("games", "computer");
  const { report, error } = setup;
  // What needs the player, as of the last scan (unticking a change doesn't
  // move it away while the player is looking at it).
  const status = report ? homeStatus(report, setup.declinedAtScan) : null;
  const sub = !status
    ? t(protonApplies() ? "desktop.games.scanning" : "desktop.games.scanningWindows")
    : status.attention
      ? t("desktop.games.needsAttention")
      : t("desktop.games.allGood", "Everything is set up. Nothing to change.");
  return (
    <GameLibrary
      report={report}
      bridge={bridge}
      library={profiles.library}
      onLibrary={profiles.setLibrary}
      running={profiles.running}
      openGame={openGame}
      onRescan={setup.rescanAfterChange}
      home={{
        acc,
        title: t("desktop.games.title", "Game setup"),
        sub,
        top: error?.at === "top" && (
          <Notice error onDismiss={setup.clearError}>
            {error.text}
          </Notice>
        ),
        sections: report && status && <HomeSections setup={setup} report={report} status={status} />,
        blocks: report && status && protonApplies() && <ComputerBlock state={computer} report={report} status={status} />,
        blockLink: computer.revealed,
      }}
    />
  );
}

// This computer (Linux), at the top of Home's main view: what the scan found
// about the controller's audio and access, the environment and HDR, with a
// yellow dot on its header while something there needs the player.
function ComputerBlock({ state, report, status }: { state: MainBlockState; report: GamesReport; status: ReturnType<typeof homeStatus> }) {
  const { t } = useTranslation();
  const s = report.system;
  // loop: HOT-PATH-OK — N = screens, 1-3; Home render
  const hdrScreens = s.hdr.screens.filter((x) => x.hdr).map((x) => x.name);
  const hdrLine = `${t("desktop.games.hdr")} ${hdrScreens.length ? t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") }) : t(`desktop.games.hdrOff.${s.hdr.check}`)}`;
  return (
    <MainBlock
      state={state}
      icon={Cpu}
      title={t("desktop.games.systemTitle", "This computer")}
      // loop: NOT-WORTH — N = 2 parts of one status line
      status={[s.hidrawAccess !== null && `${t("desktop.games.hidraw")} ${s.hidrawAccess ? "✓" : "✗"}`, hdrLine].filter(Boolean).join(" · ")}
      task={(status.system || status.hdr) && t("desktop.games.needsAttention")}
    >
      <SystemPart report={report} hdrBad={status.hdr} />
    </MainBlock>
  );
}

// Home's sections. Messages from an action (a launcher that wasn't closed,
// an error) show in the section the action was started in.
function HomeSections({ setup, report, status }: { setup: GamesSetup; report: GamesReport; status: ReturnType<typeof homeStatus> }) {
  const { t } = useTranslation();
  const m = useMsg();
  const { busy, step, fixes, selected, result, backups, error, closeNote } = setup;
  const linux = protonApplies();
  const ours = report.ourProton.name;
  // loop: HOT-PATH-OK — N ≤ 4 launchers; Home render
  const found = report.launchers.filter((l) => l.found);
  const tookBack = overwrittenBy(fixes);
  // The rail's count, as of the last scan: recommended changes the player hasn't declined.
  // loop: HOT-PATH-OK — fixes found by the scan, tens at most; Home render
  const waiting = fixes.filter((f) => f.recommended && !setup.declinedAtScan.has(f.id)).length;
  // loop: NOT-WORTH — N = backups (tens); Home render
  const lastChange = backups.reduce((n, b) => Math.max(n, Date.parse(b.created) || 0), 0);
  // A change set's line; one whose backup can't be read says so, and where it is (error pass E2).
  const changeText = (b: GameBackup) =>
    // loop: HOT-PATH-OK — a few changes per backup; Home render
    b.damaged ? t("desktop.games.historyDamaged") : b.changes.map(m).join("; ");

  // A section's messages, at the top of its body.
  const notices = (at: Place): ReactNode => (
    <>
      {closeNote?.at === at && <Notice onDismiss={setup.clearCloseNote}>{closeNote.text}</Notice>}
      {error?.at === at && (
        <Notice error onDismiss={setup.clearError}>
          {error.text}
        </Notice>
      )}
    </>
  );
  return (
    <>
      <Section
        id="launchers"
        icon={Rocket}
        title={t("desktop.games.launchersTitle")}
        // loop: HOT-PATH-OK — N ≤ 4 launchers; Home render
        status={found.length ? found.map((l) => `${LAUNCHER_NAME[l.id]}${l.flatpak ? " (Flatpak)" : ""}`).join(" · ") : t("desktop.games.noLaunchers")}
      >
        {() => (
          <>
            {/* hint: MUST-SHOW — what Check does and promises (nothing changes until Apply), before you press it */}
            <p className="dk-hint">{t("desktop.games.intro")}</p>
            <div className="dk-games-launchers">
              {found.length === 0 && <span className="dk-hint">{t("desktop.games.noLaunchers", "No Steam, Heroic or Lutris installation found.")}</span>}
              {/* loop: HOT-PATH-OK — N ≤ 4 launchers; Home render */}
              {found.map((l) => (
                <span key={`${l.id}${l.flatpak}`} className={`dk-chip${l.defaultIsOurs ? " ok" : ""}`} title={l.defaultRunner ?? ""}>
                  {linux && <span className="dot" />}
                  <LauncherIcon id={l.id} />
                  {LAUNCHER_NAME[l.id]}
                  {l.flatpak ? " (Flatpak)" : ""}
                  {/* The launchers the app closes and reopens around a change (GOG Galaxy and Epic: never). */}
                  {(l.id === "steam" || l.id === "heroic" || l.id === "lutris") && ` · ${l.running ? t("desktop.games.running", "running") : t("desktop.games.closed", "closed")}`}
                  {l.defaultIsOurs ? ` · ${t("desktop.games.ourDefault", "our Proton is the default")}` : ""}
                </span>
              ))}
            </div>
            <div className="dk-row-btns">
              <BusyButton onClick={() => setup.rescan(step !== "pick")} disabled={busy !== null}>
                {t("desktop.games.rescan", "Rescan")}
              </BusyButton>
            </div>
          </>
        )}
      </Section>
      {linux && (
        <Section
          id="proton"
          icon={Layers}
          title={t("desktop.games.protonTitle", "DualSense Proton build")}
          status={ours ?? t("desktop.games.protonNotInstalled")}
          task={status.proton && (ours && report.ourProton.latest ? t("desktop.games.protonNewer", { name: report.ourProton.latest }) : t("desktop.games.protonNotInstalled"))}
        >
          {() => (
            <>
              {ours ? (
                <p>
                  <span className="dk-mono">{ours}</span> {t("desktop.games.protonFound", "is installed.")}
                </p>
              ) : (
                <p>{t("desktop.games.protonMissing", "Our Proton build isn't installed yet. Windows games need it for adaptive triggers and haptic feedback through {{device}}.")}</p>
              )}
              {report.ourProton.updateAvailable && report.ourProton.latest && !setup.protonConfirm && busy !== "proton" && (
                <div className="dk-row-btns">
                  <button type="button" className="dk-btn primary" onClick={() => setup.setProtonConfirm(true)}>
                    {ours
                      ? t("desktop.games.protonUpdate", { name: report.ourProton.latest, defaultValue: "Install {{name}}…" })
                      : t("desktop.games.protonInstall", { name: report.ourProton.latest, defaultValue: "Install {{name}}…" })}
                  </button>
                </div>
              )}
              {setup.protonConfirm && (
                <div className="dk-confirm">
                  <p>{t("desktop.games.protonConfirm", { name: report.ourProton.latest, size: report.ourProton.latestSize ? formatMB(report.ourProton.latestSize) : "?" })}</p>
                  <div className="dk-row-btns">
                    <button type="button" className="dk-btn primary" onClick={() => void setup.installProton().catch(logged("installProton (it shows its own errors)"))}>
                      {t("desktop.games.protonGo", "Download and install")}
                    </button>
                    <button type="button" className="dk-btn" onClick={() => setup.setProtonConfirm(false)}>
                      {t("desktop.games.cancel", "Cancel")}
                    </button>
                  </div>
                </div>
              )}
              {busy === "proton" && <ProtonProgressView progress={setup.protonProgress} />}
              {setup.protonMessage && <p className="dk-hint">{setup.protonMessage}</p>}
            </>
          )}
        </Section>
      )}
      <Section
        id="recommended"
        icon={ListChecks}
        title={t("desktop.games.changesTitle", "Recommended changes")}
        status={fixes.length ? t("desktop.games.attention", { count: fixes.length }) : t("desktop.games.nothingToChange")}
        task={waiting > 0 && t("desktop.games.attention", { count: waiting })}
        notice={notices("recommended")}
      >
        {() => (
          <>
            {step === "pick" &&
              (fixes.length > 0 ? (
                <>
                  <OverwrittenNotice launchers={tookBack} />
                  {/* hint: MUST-SHOW — the instruction for the list below it, before Apply */}
                  <p className="dk-hint">{t("desktop.games.changesHint", "Recommended changes are ticked. Untick anything you'd rather keep as it is.")}</p>
                  <FixList fixes={fixes} chosen={setup.chosen} onToggle={setup.toggle} />
                  <div className="dk-row-btns">
                    <button type="button" className="dk-btn primary" disabled={selected.length === 0} onClick={setup.review}>
                      {t("desktop.games.review", { count: selected.length })}
                    </button>
                  </div>
                </>
              ) : (
                <p className="dk-good">✓ {t("desktop.games.allGood", "Everything is set up. Nothing to change.")}</p>
              ))}
            {step === "review" && (
              <>
                <h3 className="dk-subhead">{t("desktop.games.reviewTitle", "Review before applying")}</h3>
                {/* hint: MUST-SHOW — a warning: these files change (backed up first), before Apply */}
                <p className="dk-hint">{t("desktop.games.reviewHint", "These files will be changed. Each one is backed up first, so Undo puts it back exactly as it was.")}</p>
                <ul className="dk-review">
                  {/* loop: HOT-PATH-OK — chosen fixes, tens at most; review render */}
                  {selected.map((f) => (
                    <li key={f.id}>
                      <strong>{m(f.label)}</strong>
                      {/* loop: HOT-PATH-OK — 1-3 files per chosen fix; review render */}
                      {f.files.map((file) => (
                        <div key={file} className="dk-mono dk-file">
                          {file}
                        </div>
                      ))}
                      {f.files.length === 0 && <div className="dk-hint">{t("desktop.games.noFiles", "No files change.")}</div>}
                    </li>
                  ))}
                </ul>
                <RestartNotice launchers={setup.restart} />
                <div className="dk-row-btns">
                  <BusyButton className="dk-btn primary" disabled={busy !== null || selected.length === 0 || setup.fresh === undefined} onClick={setup.apply}>
                    {t("desktop.games.apply", { count: selected.length })}
                  </BusyButton>
                  <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => setup.setStep("pick")}>
                    {t("desktop.games.back", "Back")}
                  </button>
                </div>
              </>
            )}
            {step === "done" && result && (
              <>
                <h3 className="dk-subhead">{t("desktop.games.doneTitle", "Done")}</h3>
                <ul className="dk-review">
                  {/* loop: HOT-PATH-OK — applied fixes, tens at most; result render after apply */}
                  {result.applied.map((a) => (
                    <li key={a.id} className={a.ok ? "" : "dk-bad"}>
                      {a.ok ? "✓ " : "✗ "}
                      {result.labels.has(a.id) ? m(result.labels.get(a.id)!) : a.id}
                      {a.message && <div className="dk-hint">{m(a.message)}</div>}
                    </li>
                  ))}
                </ul>
                <p className="dk-hint">{t("desktop.games.doneHint")}</p>
                <div className="dk-row-btns">
                  {result.backupId && (
                    <BusyButton className="dk-btn" disabled={busy !== null} onClick={() => setup.undo(result.backupId!, "recommended")}>
                      {t("desktop.games.undo", "Undo these changes")}
                    </BusyButton>
                  )}
                  <button type="button" className="dk-btn" onClick={() => setup.setStep("pick")}>
                    {t("desktop.games.ok", "OK")}
                  </button>
                </div>
              </>
            )}
            <UndoConfirm setup={setup} at="recommended" />
          </>
        )}
      </Section>
      <Section
        id="history"
        icon={History}
        title={t("desktop.games.history", "Change history")}
        status={backups.length ? t("desktop.games.historyStatus", { count: backups.length, date: new Date(lastChange).toLocaleDateString() }) : t("desktop.games.historyNone")}
        notice={notices("history")}
      >
        {() => (
          <>
            {backups.length === 0 ? (
              <p className="dk-hint">{t("desktop.games.historyNone")}</p>
            ) : (
              <ul className="dk-review">
                {/* loop: HOT-PATH-OK — change history entries, tens; Home render */}
                {backups.map((b) => (
                  <li key={b.id}>
                    <span className="dk-hint">{new Date(b.created).toLocaleString()}</span> {changeText(b)}
                    {b.damaged && <div className="dk-mono dk-file">{b.damaged}</div>}
                    {!b.damaged && (
                      <BusyButton className="dk-btn dk-inline-btn" disabled={busy !== null} onClick={() => setup.undo(b.id, "history")}>
                        {t("desktop.games.undoShort", "Undo")}
                      </BusyButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <UndoConfirm setup={setup} at="history" />
          </>
        )}
      </Section>
    </>
  );
}

// An undo that closes running launchers: said first, then confirmed, in the section it was asked in.
function UndoConfirm({ setup, at }: { setup: GamesSetup; at: Place }) {
  const { t } = useTranslation();
  const { undoAsk, busy } = setup;
  if (undoAsk?.at !== at) return null;
  return (
    <div className="dk-confirm">
      <RestartNotice launchers={undoAsk.launchers} undo />
      <div className="dk-row-btns">
        <BusyButton className="dk-btn primary" disabled={busy !== null} onClick={() => setup.undo(undoAsk.backupId, at, undoAsk.launchers)}>
          {t("desktop.games.undoShort", "Undo")}
        </BusyButton>
        <button type="button" className="dk-btn" disabled={busy !== null} onClick={setup.cancelUndo}>
          {t("desktop.games.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}

export { allFixes };

function FixList({ fixes, chosen, onToggle }: { fixes: Fix[]; chosen: Set<string>; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  const m = useMsg();
  // loop: HOT-PATH-OK — 4 launcher groups x tens of fixes; Home render on interaction
  const groups = (["system", "steam", "heroic", "lutris"] as const).map((g) => ({ g, items: fixes.filter((f) => f.launcher === g) })).filter((x) => x.items.length);
  return (
    <div className="dk-fixes">
      {/* loop: HOT-PATH-OK — N ≤ 4 launcher groups */}
      {groups.map(({ g, items }) => (
        <div key={g}>
          <h3 className="launcher-name">
            {g !== "system" && <LauncherIcon id={g} />}
            {g === "system" ? t("desktop.games.systemTitle", "This computer") : LAUNCHER_NAME[g]}
          </h3>
          {/* loop: HOT-PATH-OK — fixes in one group, tens at most */}
          {items.map((f) => (
            <label key={f.id} className="dk-fix">
              <input type="checkbox" checked={chosen.has(f.id)} onChange={() => onToggle(f.id)} />
              <span>
                <span className="dk-fix-label">{m(f.label)}</span>
                <span className="dk-fix-why">{m(f.why)}</span>
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

// This computer's body (Linux): the controller's audio and access, the
// environment and HDR (its checklist always shown: compact when every item
// passes, a ✗ that matters highlighted).
function SystemPart({ report, hdrBad }: { report: GamesReport; hdrBad: boolean }) {
  const { t } = useTranslation();
  const s = report.system;
  const proAudio = s.proAudio;
  // loop: HOT-PATH-OK — N = screens, 1-3; Home render
  const hdrScreens = s.hdr.screens.filter((x) => x.hdr).map((x) => x.name);
  const reqs = systemHdrReqs(report);
  return (
    <>
      <dl className="dk-kv">
        <dt>{t("desktop.games.audio", "Controller audio")}</dt>
        <dd className={proAudio ? "dk-bad" : ""}>{s.audioProfile ?? t("desktop.games.noController", "controller not connected")}</dd>
        <dt>{t("desktop.games.hidraw", "Controller access")}</dt>
        <dd className={s.hidrawAccess === false ? "dk-bad" : ""}>
          {s.hidrawAccess === null
            ? t("desktop.games.noController", "controller not connected")
            : s.hidrawAccess
              ? t("desktop.games.hidrawOk", "games can talk to the controller directly")
              : t("desktop.games.hidrawNo", "games can't reach the controller (missing udev rule)")}
        </dd>
        <dt>{t("desktop.games.env", "Environment")}</dt>
        <dd className={s.envWarnings.length ? "dk-bad" : ""}>
          {s.envWarnings.length
            ? // loop: HOT-PATH-OK — env warnings, 0-3; Home render
              s.envWarnings.map((w) => (w.file ? t("desktop.games.envSetIn", { variable: w.variable, file: w.file }) : t("desktop.games.envSession", { variable: w.variable }))).join("; ")
            : t("desktop.games.envOk", "nothing forcing the Xbox (SDL) path")}
        </dd>
        <dt>{t("desktop.games.hdr")}</dt>
        <dd>
          <div className="hdr-row">
            <span className={hdrBad ? "dk-bad" : undefined}>{hdrScreens.length ? t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") }) : t(`desktop.games.hdrOff.${s.hdr.check}`)}</span>
            <HdrChecklist reqs={reqs} />
          </div>
        </dd>
      </dl>
      {s.envWarnings.length > 0 && (
        // hint: MUST-SHOW — what to do about variables this app can't change
        <p className="dk-hint">
          {t("desktop.games.envHint", "These variables are set outside any launcher, so this app doesn't change them. Remove them from the file named above, then log out and back in.")}
        </p>
      )}
      {/* loop: HOT-PATH-OK — PipeWire pro-audio rule files, 0-3 */}
      {s.proAudioRules.some((r) => r.startsWith("/etc")) && (
        // hint: MUST-SHOW — a status: a rule this app can't change, and why
        <p className="dk-hint">{t("desktop.games.systemRule", "A system-wide audio rule forces pro-audio. It's outside your home folder, so this app won't change it.")}</p>
      )}
    </>
  );
}

function ProtonProgressView({ progress }: { progress: ProtonProgress | null }) {
  const { t } = useTranslation();
  if (!progress || progress.phase === "downloading") {
    const got = progress?.got ?? 0;
    const total = progress?.total ?? 1;
    return (
      <div className="dk-progress-wrap">
        <progress className="dk-progress" max={total} value={got} />
        <span className="dk-hint">{t("desktop.games.downloading", { got: formatMB(got), total: formatMB(total), defaultValue: "Downloading {{got}} of {{total}}" })}</span>
      </div>
    );
  }
  const label =
    progress.phase === "verifying"
      ? t("desktop.games.verifying", "Checking the archive…")
      : progress.phase === "unpacking"
        ? t("desktop.games.unpacking", "Unpacking…")
        : t("desktop.games.copying", "Copying for the Flatpak launcher…");
  return <p className="dk-hint">{label}</p>;
}
