// Games: checks Steam, Heroic and Lutris (Linux; Steam, GOG Galaxy and Epic
// on Windows) for settings that stop the DualSense's native features
// (adaptive triggers, haptics) from reaching games, and fixes them with the
// user's consent. On Home it's calm when healthy (one "Everything is set up"
// line over the library, the details folded) and loud when not: what needs
// the player shows open at the top with its action (homeStatus).
//
// Consent flow (load-bearing, see src/desktop/games/types.ts):
//   allow (first visit: what will be read, nothing until the user agrees)
//   -> scan (reads only) -> pick changes (each says what, why and which files)
//   -> review (every file listed; a running launcher that owns a change is
//      named there: it will be closed for the change, then reopened)
//   -> apply (backed up first) -> Undo (the same close-and-reopen, said first).
// Downloading Proton is its own confirmation with size and destination.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LauncherIcon } from "../library/LauncherIcon";
import { protonApplies } from "../games/platform";
import { latestOnly } from "../games/scanOrder";
import { HdrChecklist } from "../library/HdrChecklist";
import { homeStatus, systemHdrReqs } from "../library/setupStatus";
import { errorText } from "../../errorText";
import { readPref, writePref } from "../storage";
import GameLibrary from "../library/GameLibrary";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { GameProfileState } from "../library/useGameProfile";
import { useTranslation } from "react-i18next";
import { BusyButton } from "../controls";
import { say } from "../narrator";
import type { GameBackup, ProtonProgress } from "../api";
import type { ApplyResult, CloseProblem, Fix, GamesReport, LauncherId, Msg, RestartList } from "../games/types";
import { allFixes } from "../games/types";
import { forgetApplied, overwrittenBy, rememberApplied, restartFor, startedSinceCheck, useFreshRunning } from "../games/launcherCheck";

// Product names stay untranslated; "sideload" is translated where it's shown.
const LAUNCHER_NAME: Record<LauncherId, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris", gog: "GOG Galaxy", epic: "Epic Games" };
type Step = "pick" | "review" | "done";

// Changes the user unticked stay unticked across rescans and visits until
// they tick them again (a recommendation is a suggestion, not a default).
const DECLINED_KEY = "ds5-games-declined";

export function loadDeclined(): Set<string> {
  try {
    const raw = readPref(DECLINED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set(); // unreadable: nothing declined
  }
}

const saveDeclined = (ids: Set<string>) => writePref(DECLINED_KEY, JSON.stringify([...ids]));

// Translate a main-process message (see Msg in games/types.ts); params may be messages too.
export function useMsg(): (m: Msg) => string {
  const { t } = useTranslation();
  return useCallback(
    function render(m: Msg): string {
      const params = Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : render(v)]));
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
      {launchers.map((l) => (
        <div key={l} className="dk-notice">
          {t(undo ? "desktop.games.willRestartUndo" : "desktop.games.willRestart", { launcher: LAUNCHER_NAME[l] })}
        </div>
      ))}
    </>
  );
}

// A change applied this session that a launcher wrote back (launcherCheck.ts).
export function OverwrittenNotice({ launchers }: { launchers: LauncherId[] }) {
  const { t } = useTranslation();
  return (
    <>
      {launchers.map((l) => (
        <div key={l} className="dk-notice">
          {t("desktop.games.launcherOverwrote", { launcher: LAUNCHER_NAME[l] })}
        </div>
      ))}
    </>
  );
}

// Why a launcher wasn't closed (nothing was written), or that one wasn't started again.
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

export default function GamesPage({ allowed, onAllowedChange, bridge, profiles, onScanned, openGame, ...rest }: GamesPageProps) {
  // The library shows the games of the latest scan; Home (setup and fixes)
  // runs the scans, and rescans when a game page applied something.
  const [report, setReport] = useState<GamesReport | null>(null);
  const [rescanToken, setRescanToken] = useState(0);
  const scanned = useCallback(
    (r: GamesReport) => {
      setReport(r);
      onScanned?.(r);
    },
    [onScanned],
  );
  if (!allowed) return <GamesConsent onAllow={() => onAllowedChange(true)} />;
  return (
    <GameLibrary
      report={report}
      bridge={bridge}
      library={profiles.library}
      onLibrary={profiles.setLibrary}
      running={profiles.running}
      openGame={openGame}
      onRescan={() => setRescanToken((n) => n + 1)}
      home={<GamesSetup {...rest} rescanToken={rescanToken} onScanned={scanned} />}
    />
  );
}

// First visit: say exactly what checking reads, and read nothing until the user agrees.
function GamesConsent({ onAllow }: { onAllow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="dk-stack">
      <section className="dk-card">
        <h2>{t("desktop.games.title", "Game setup")}</h2>
        <p>{t(protonApplies() ? "desktop.games.consentIntro" : "desktop.games.consentIntroWindows")}</p>
        <ul className="dk-review">
          <li>{t(protonApplies() ? "desktop.games.consentLaunchers" : "desktop.games.consentLaunchersWindows")}</li>
          <li>{t(protonApplies() ? "desktop.games.consentAudio" : "desktop.games.consentRunningWindows")}</li>
          {protonApplies() && <li>{t("desktop.games.consentProton")}</li>}
        </ul>
        <p className="dk-hint">{t("desktop.games.consentPromise")}</p>
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

function GamesSetup({ onScanned, onDeclinedChange, rescanToken }: Omit<GamesPageProps, "allowed" | "onAllowedChange" | "bridge" | "profiles"> & { rescanToken: number }) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [report, setReport] = useState<GamesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const declined = useRef<Set<string>>(loadDeclined());
  const [declinedAtScan, setDeclinedAtScan] = useState<ReadonlySet<string>>(loadDeclined);
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(ApplyResult & { labels: Map<string, Msg> }) | null>(null);
  const m = useMsg();
  const [closeNote, setCloseNote] = useState<string | null>(null);
  const restartText = useRestartText();
  // An undo that needs running launchers closed: said first, then confirmed.
  const [undoAsk, setUndoAsk] = useState<{ backupId: string; launchers: RestartList } | null>(null);
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
        setError(errorText(cause));
      }
    },
    [desktop, receive, latest],
  );

  // First scan on open (state is only set once the scan resolves).
  useEffect(() => {
    let live = true;
    latest(desktop.gamesScan()).then(
      (r) => live && r.current && void receive(r.value, false),
      (cause: unknown) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
  }, [desktop, receive, latest]);
  useEffect(() => desktop.onProtonProgress(setProtonProgress), [desktop]);
  // A game page applied a fix: rescan so Home and the library agree.
  const firstToken = useRef(rescanToken);
  useEffect(() => {
    if (rescanToken !== firstToken.current) void rescan(true);
  }, [rescanToken, rescan]);

  const fixes = useMemo(() => (report ? allFixes(report) : []), [report]);
  const selected = fixes.filter((f) => chosen.has(f.id));
  // The review checks the running launchers again when it opens (and after each scan).
  const [reviews, setReviews] = useState(0);
  const fresh = useFreshRunning(step === "review" ? `${reviews}|${report?.scannedAt}` : null);
  const restart = report ? restartFor(report, selected, fresh) : [];
  const tookBack = overwrittenBy(fixes);

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

  const apply = async () => {
    setBusy("apply");
    setCloseNote(null);
    try {
      // Keep the labels: after the rescan, applied fixes are no longer in the list.
      const labels = new Map(selected.map((f) => [f.id, f.label]));
      const r = await desktop.gamesApply({ fixIds: selected.map((f) => f.id), restart });
      if (r.blockedBy.length) {
        // Not closed (why), or a launcher started since the scan: the rescan
        // names it on the review, and Apply asks again.
        setCloseNote(restartText(r));
        await rescan(true);
        return;
      }
      setCloseNote(restartText(r));
      rememberApplied(r.applied.filter((a) => a.ok).map((a) => a.id));
      setResult({ ...r, labels });
      setStep("done");
      if (r.applied.length > 0 && r.applied.every((a) => a.ok)) void say("app_games_ready");
      await rescan();
    } catch (cause) {
      setError(errorText(cause));
      await rescan(true); // something may have been written before it failed
    } finally {
      setBusy(null);
    }
  };

  const undo = async (backupId: string, restart: RestartList = []) => {
    setBusy(`undo-${backupId}`);
    setUndoAsk(null);
    try {
      const r = await desktop.gamesUndo({ backupId, restart });
      setCloseNote(null);
      if (r.ok) {
        forgetApplied();
        setCloseNote(restartText(r));
        setResult(null);
        setStep("pick");
      } else if ("blockedBy" in r) {
        // Running launchers own these files: say they'll be closed and reopened, then ask.
        // One that started after the question was asked: said too, and asked again with it.
        if (r.problem || restart.length) setCloseNote(restartText(r));
        if (!r.problem) setUndoAsk({ backupId, launchers: [...new Set([...restart, ...r.blockedBy.filter((l): l is RestartList[number] => l === "steam" || l === "heroic" || l === "lutris")])] });
      } else if ("conflict" in r) {
        setCloseNote(t("desktop.games.undoConflict", { files: r.conflict.join(", ") }));
      } else {
        setError(r.error);
      }
      await rescan();
    } catch (cause) {
      setError(errorText(cause));
      await rescan(true);
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
      setProtonMessage(r.ok ? t("desktop.games.protonInstalled", { name: r.name, defaultValue: "{{name}} is installed." }) : r.message);
      await rescan();
    } catch (cause) {
      setProtonMessage(errorText(cause));
    } finally {
      setProtonProgress(null);
      setBusy(null);
    }
  };

  if (!report) {
    return (
      <div className="dk-stack">
        <section className="dk-card lib-status">
          {error ? <p className="dk-bad">{error}</p> : <p className="dk-hint">{t(protonApplies() ? "desktop.games.scanning" : "desktop.games.scanningWindows")}</p>}
        </section>
      </div>
    );
  }

  const found = report.launchers.filter((l) => l.found);
  const ours = report.ourProton.name;
  const linux = protonApplies();
  // What needs the player, as of the last scan (unticking a change doesn't
  // move it away while the player is looking at it).
  const status = homeStatus(report, declinedAtScan);
  // An install in progress or just finished stays where it was started.
  const protonTop = linux && (status.proton || protonConfirm || busy === "proton" || protonMessage !== null);
  const open = status.attention || protonTop;
  const showFixes = step === "pick" && fixes.length > 0;
  const fixesTop = showFixes && status.fixes;
  const systemTop = status.system || status.hdr;

  const rescanButton = (
    <BusyButton onClick={() => rescan(step !== "pick")} disabled={busy !== null}>
      {t("desktop.games.rescan", "Rescan")}
    </BusyButton>
  );
  const launcherChips = (
    <div className="dk-games-launchers">
      {found.length === 0 && <span className="dk-hint">{t("desktop.games.noLaunchers", "No Steam, Heroic or Lutris installation found.")}</span>}
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
  );
  const proton = linux && (
    <div className="lib-setup-part">
      <h3>{t("desktop.games.protonTitle", "DualSense Proton build")}</h3>
      {ours ? (
        <p>
          <span className="dk-mono">{ours}</span> {t("desktop.games.protonFound", "is installed.")}
        </p>
      ) : (
        <p>{t("desktop.games.protonMissing", "Our Proton build isn't installed yet. Windows games need it for adaptive triggers and haptic feedback through {{device}}.")}</p>
      )}
      {report.ourProton.updateAvailable && report.ourProton.latest && !protonConfirm && busy !== "proton" && (
        <button type="button" className="dk-btn primary" onClick={() => setProtonConfirm(true)}>
          {ours
            ? t("desktop.games.protonUpdate", { name: report.ourProton.latest, defaultValue: "Install {{name}}…" })
            : t("desktop.games.protonInstall", { name: report.ourProton.latest, defaultValue: "Install {{name}}…" })}
        </button>
      )}
      {protonConfirm && (
        <div className="dk-confirm">
          <p>{t("desktop.games.protonConfirm", { name: report.ourProton.latest, size: report.ourProton.latestSize ? formatMB(report.ourProton.latestSize) : "?" })}</p>
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" onClick={() => void installProton()}>
              {t("desktop.games.protonGo", "Download and install")}
            </button>
            <button type="button" className="dk-btn" onClick={() => setProtonConfirm(false)}>
              {t("desktop.games.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {busy === "proton" && <ProtonProgressView progress={protonProgress} />}
      {protonMessage && <p className="dk-hint">{protonMessage}</p>}
    </div>
  );
  const system = linux && <SystemPart report={report} hdrOpen={status.hdr} />;
  const fixList = showFixes && (
    <div className="lib-setup-part">
      <h3>{t("desktop.games.changesTitle", "Recommended changes")}</h3>
      <OverwrittenNotice launchers={tookBack} />
      <p className="dk-hint">{t("desktop.games.changesHint", "Recommended changes are ticked. Untick anything you'd rather keep as it is.")}</p>
      <FixList fixes={fixes} chosen={chosen} onToggle={toggle} />
      <div className="dk-row-btns">
        <button type="button" className="dk-btn primary" disabled={selected.length === 0} onClick={() => (setReviews((n) => n + 1), setStep("review"))}>
          {t("desktop.games.review", { count: selected.length })}
        </button>
      </div>
    </div>
  );
  // Everything that isn't shown open above: what checking does, the
  // launchers, Proton, This computer, changes the player declined, and the
  // change history (quiet, one more fold).
  const details = (
    <>
      <p className="dk-hint">
        {t(
          "desktop.games.intro",
          "Checks your launchers for settings that stop adaptive triggers and haptics from reaching games. Checking only reads your settings. Nothing changes until you review the changes and press Apply, and every change can be undone.",
        )}
      </p>
      {!fixesTop && launcherChips}
      {!protonTop && proton}
      {!systemTop && system}
      {!fixesTop && fixList}
      {backups.length > 0 && (
        <details className="gp-legend lib-history">
          <summary>{t("desktop.games.history", "Change history")}</summary>
          <ul className="dk-review">
            {backups.map((b) => (
              <li key={b.id}>
                <span className="dk-hint">{new Date(b.created).toLocaleString()}</span> {b.changes.map(m).join("; ")}
                <BusyButton className="dk-btn dk-inline-btn" disabled={busy !== null} onClick={() => undo(b.id)}>
                  {t("desktop.games.undoShort", "Undo")}
                </BusyButton>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
  const hdrScreens = linux ? report.system.hdr.screens.filter((x) => x.hdr).map((x) => x.name) : [];

  return (
    <div className="dk-stack">
      {open ? (
        <section className="dk-card lib-setup" aria-label={t("desktop.games.title", "Game setup")}>
          <div className="lib-setup-head">
            <h2>
              {t("desktop.games.title", "Game setup")}{" "}
              {status.attention && (
                <span className="dk-chip warn">
                  <span className="dot" aria-hidden="true" />
                  {t("desktop.games.needsAttention")}
                </span>
              )}
            </h2>
            {rescanButton}
          </div>
          {fixesTop && (
            <>
              {launcherChips}
              {fixList}
            </>
          )}
          {protonTop && proton}
          {systemTop && system}
          <details className="gp-legend lib-system">
            <summary>{t("desktop.games.details")}</summary>
            {details}
          </details>
        </section>
      ) : (
        // All fine: one line, the details one click away.
        <section className="dk-card lib-status">
          <details className="gp-legend lib-system">
            <summary>
              {found.length === 0 ? (
                <span className="dk-hint">{t("desktop.games.noLaunchers")}</span>
              ) : (
                <span className="dk-good">✓ {t("desktop.games.allGood", "Everything is set up. Nothing to change.")}</span>
              )}
              <span className="lib-facts">
                {found.map((l) => (
                  <span key={`${l.id}${l.flatpak}`}>
                    <LauncherIcon id={l.id} />
                    {LAUNCHER_NAME[l.id]}
                  </span>
                ))}
                {linux && ours && <span className="dk-mono">{ours}</span>}
                {linux && hdrScreens.length > 0 && (
                  <span>
                    {t("desktop.games.hdr")} {t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") })}
                  </span>
                )}
              </span>
            </summary>
            {details}
          </details>
          {rescanButton}
        </section>
      )}

      {closeNote && <div className="dk-notice">{closeNote}</div>}
      {undoAsk && (
        <div className="dk-confirm">
          <RestartNotice launchers={undoAsk.launchers} undo />
          <div className="dk-row-btns">
            <BusyButton className="dk-btn primary" disabled={busy !== null} onClick={() => undo(undoAsk.backupId, undoAsk.launchers)}>
              {t("desktop.games.undoShort", "Undo")}
            </BusyButton>
            <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => setUndoAsk(null)}>
              {t("desktop.games.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <div className="dk-notice error">{error}</div>}

      {step === "review" && (
        <section className="dk-card">
          <h2>{t("desktop.games.reviewTitle", "Review before applying")}</h2>
          <p className="dk-hint">{t("desktop.games.reviewHint", "These files will be changed. Each one is backed up first, so Undo puts it back exactly as it was.")}</p>
          <ul className="dk-review">
            {selected.map((f) => (
              <li key={f.id}>
                <strong>{m(f.label)}</strong>
                {f.files.map((file) => (
                  <div key={file} className="dk-mono dk-file">
                    {file}
                  </div>
                ))}
                {f.files.length === 0 && <div className="dk-hint">{t("desktop.games.noFiles", "No files change.")}</div>}
              </li>
            ))}
          </ul>
          <RestartNotice launchers={restart} />
          <div className="dk-row-btns">
            <BusyButton className="dk-btn primary" disabled={busy !== null || selected.length === 0 || fresh === undefined} onClick={apply}>
              {t("desktop.games.apply", { count: selected.length })}
            </BusyButton>
            <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => setStep("pick")}>
              {t("desktop.games.back", "Back")}
            </button>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section className="dk-card">
          <h2>{t("desktop.games.doneTitle", "Done")}</h2>
          <ul className="dk-review">
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
              <BusyButton className="dk-btn" disabled={busy !== null} onClick={() => undo(result.backupId!)}>
                {t("desktop.games.undo", "Undo these changes")}
              </BusyButton>
            )}
            <button type="button" className="dk-btn" onClick={() => setStep("pick")}>
              {t("desktop.games.ok", "OK")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export { allFixes };

function FixList({ fixes, chosen, onToggle }: { fixes: Fix[]; chosen: Set<string>; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  const m = useMsg();
  const groups = (["system", "steam", "heroic", "lutris"] as const).map((g) => ({ g, items: fixes.filter((f) => f.launcher === g) })).filter((x) => x.items.length);
  return (
    <div className="dk-fixes">
      {groups.map(({ g, items }) => (
        <div key={g}>
          <h3 className="launcher-name">
            {g !== "system" && <LauncherIcon id={g} />}
            {g === "system" ? t("desktop.games.systemTitle", "This computer") : LAUNCHER_NAME[g]}
          </h3>
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

// This computer (Linux): the controller's audio and access, the environment
// and HDR (its checklist opens from the row; open already when it has a ✗
// that matters).
function SystemPart({ report, hdrOpen }: { report: GamesReport; hdrOpen: boolean }) {
  const { t } = useTranslation();
  const s = report.system;
  const proAudio = s.proAudio;
  const hdrScreens = s.hdr.screens.filter((x) => x.hdr).map((x) => x.name);
  const reqs = systemHdrReqs(report);
  return (
    <div className="lib-setup-part">
      <h3>{t("desktop.games.systemTitle", "This computer")}</h3>
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
            ? s.envWarnings.map((w) => (w.file ? t("desktop.games.envSetIn", { variable: w.variable, file: w.file }) : t("desktop.games.envSession", { variable: w.variable }))).join("; ")
            : t("desktop.games.envOk", "nothing forcing the Xbox (SDL) path")}
        </dd>
        <dt>{t("desktop.games.hdr")}</dt>
        <dd>
          <details className="gp-legend hdr-row" open={hdrOpen || undefined}>
            <summary className={hdrOpen ? "dk-bad" : undefined}>{hdrScreens.length ? t("desktop.games.hdrOn", { outputs: hdrScreens.join(", ") }) : t(`desktop.games.hdrOff.${s.hdr.check}`)}</summary>
            <HdrChecklist reqs={reqs} />
          </details>
        </dd>
      </dl>
      {s.envWarnings.length > 0 && (
        <p className="dk-hint">
          {t("desktop.games.envHint", "These variables are set outside any launcher, so this app doesn't change them. Remove them from the file named above, then log out and back in.")}
        </p>
      )}
      {s.proAudioRules.some((r) => r.startsWith("/etc")) && (
        <p className="dk-hint">{t("desktop.games.systemRule", "A system-wide audio rule forces pro-audio. It's outside your home folder, so this app won't change it.")}</p>
      )}
    </div>
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
