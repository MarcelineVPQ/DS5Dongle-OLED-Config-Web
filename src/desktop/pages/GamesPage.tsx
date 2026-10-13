// Games (Linux): checks Steam, Heroic and Lutris for settings that stop the
// DualSense's native features (adaptive triggers, haptics) from reaching games,
// and fixes them with the user's consent.
//
// Consent flow (load-bearing, see src/desktop/games/types.ts):
//   allow (first visit: what will be read, nothing until the user agrees)
//   -> scan (reads only) -> pick changes (each says what, why and which files)
//   -> review (every file listed; running launchers must be closed, on request)
//   -> apply (backed up first) -> Undo.
// Downloading Proton is its own confirmation with size and destination.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LauncherIcon } from "../library/LauncherIcon";
import { protonApplies } from "../games/platform";
import { errorText } from "../../errorText";
import { readPref, writePref } from "../storage";
import GameLibrary from "../library/GameLibrary";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { GameProfileState } from "../library/useGameProfile";
import { useTranslation } from "react-i18next";
import { BusyButton } from "../controls";
import { say } from "../narrator";
import type { GameBackup, ProtonProgress } from "../api";
import type { ApplyResult, Fix, GamesReport, LauncherId, Msg } from "../games/types";

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
      home={<GamesSetup {...rest} rescanToken={rescanToken} onScanned={scanned} onStop={() => onAllowedChange(false)} />}
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
        <div className="dk-row-btns">
          <button type="button" className="dk-btn primary" onClick={onAllow}>
            {t("desktop.games.consentAllow")}
          </button>
        </div>
      </section>
    </div>
  );
}

function GamesSetup({ onScanned, onDeclinedChange, onStop, rescanToken }: Omit<GamesPageProps, "allowed" | "onAllowedChange" | "bridge" | "profiles"> & { onStop: () => void; rescanToken: number }) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const [report, setReport] = useState<GamesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const declined = useRef<Set<string>>(loadDeclined());
  const [step, setStep] = useState<Step>("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(ApplyResult & { labels: Map<string, Msg> }) | null>(null);
  const m = useMsg();
  const [closeNote, setCloseNote] = useState<string | null>(null);
  const [backups, setBackups] = useState<GameBackup[]>([]);
  const [protonConfirm, setProtonConfirm] = useState(false);
  const [protonProgress, setProtonProgress] = useState<ProtonProgress | null>(null);
  const [protonMessage, setProtonMessage] = useState<string | null>(null);

  const receive = useCallback(
    async (r: GamesReport, keepSelection: boolean) => {
      setReport(r);
      onScanned?.(r);
      const all = allFixes(r);
      setChosen((prev) => (keepSelection ? new Set(all.filter((f) => prev.has(f.id)).map((f) => f.id)) : new Set(all.filter((f) => f.recommended && !declined.current.has(f.id)).map((f) => f.id))));
      setBackups(await desktop.gamesBackups());
    },
    [desktop, onScanned],
  );

  const rescan = useCallback(
    async (keepSelection = false) => {
      setError(null);
      try {
        await receive(await desktop.gamesScan(), keepSelection);
      } catch (cause) {
        setError(errorText(cause));
      }
    },
    [desktop, receive],
  );

  // First scan on open (state is only set once the scan resolves).
  useEffect(() => {
    let live = true;
    desktop.gamesScan().then(
      (r) => live && void receive(r, false),
      (cause: unknown) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
  }, [desktop, receive]);
  useEffect(() => desktop.onProtonProgress(setProtonProgress), [desktop]);
  // A game page applied a fix: rescan so Home and the library agree.
  const firstToken = useRef(rescanToken);
  useEffect(() => {
    if (rescanToken !== firstToken.current) void rescan(true);
  }, [rescanToken, rescan]);

  const fixes = useMemo(() => (report ? allFixes(report) : []), [report]);
  const selected = fixes.filter((f) => chosen.has(f.id));
  const blocking = report ? [...new Set(selected.map((f) => f.launcher))].filter((l): l is LauncherId => l !== "system" && !!report.launchers.find((x) => x.id === l && x.running)) : [];

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

  const closeLauncher = async (launcher: LauncherId) => {
    setBusy(`close-${launcher}`);
    setCloseNote(null);
    try {
      const r = await desktop.closeLauncher(launcher).catch(() => "failed" as const);
      if (r === "failed") setCloseNote(t("desktop.games.closeFailed", { launcher: LAUNCHER_NAME[launcher] }));
      else if (r === "game-running") setCloseNote(t("desktop.games.closeGameRunning", "A game is still running. Quit the game first, then try again."));
      else if (r === "timeout")
        setCloseNote(t("desktop.games.closeTimeout", { launcher: LAUNCHER_NAME[launcher], defaultValue: "{{launcher}} didn't quit within 30 seconds. Quit it yourself, then press Rescan." }));
      await rescan(true);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("apply");
    try {
      // Keep the labels: after the rescan, applied fixes are no longer in the list.
      const labels = new Map(selected.map((f) => [f.id, f.label]));
      const r = await desktop.gamesApply(selected.map((f) => f.id));
      if (r.blockedBy.length) {
        await rescan(true);
        return;
      }
      setResult({ ...r, labels });
      setStep("done");
      if (r.applied.length > 0 && r.applied.every((a) => a.ok)) void say("app_games_ready");
      await rescan();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const undo = async (backupId: string) => {
    setBusy(`undo-${backupId}`);
    try {
      const r = await desktop.gamesUndo(backupId);
      setCloseNote(null);
      if (r.ok) {
        setResult(null);
        setStep("pick");
      } else if ("blockedBy" in r) {
        setCloseNote(t("desktop.games.undoBlocked", { launchers: r.blockedBy.map((l) => LAUNCHER_NAME[l]).join(", ") }));
      } else if ("conflict" in r) {
        setCloseNote(t("desktop.games.undoConflict", { files: r.conflict.join(", ") }));
      } else {
        setError(r.error);
      }
      await rescan();
    } catch (cause) {
      setError(errorText(cause));
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
        <section className="dk-card">
          {error ? <p className="dk-bad">{error}</p> : <p className="dk-hint">{t(protonApplies() ? "desktop.games.scanning" : "desktop.games.scanningWindows")}</p>}
        </section>
      </div>
    );
  }

  const found = report.launchers.filter((l) => l.found);
  const ours = report.ourProton.name;

  return (
    <div className="dk-stack">
      <section className="dk-card">
        <h2>{t("desktop.games.title", "Game setup")}</h2>
        <p className="dk-hint">
          {t(
            "desktop.games.intro",
            "Checks your launchers for settings that stop adaptive triggers and haptics from reaching games. Checking only reads your settings. Nothing changes until you review the changes and press Apply, and every change can be undone.",
          )}
        </p>
        <div className="dk-games-launchers">
          {found.length === 0 && <span className="dk-hint">{t("desktop.games.noLaunchers", "No Steam, Heroic or Lutris installation found.")}</span>}
          {found.map((l) => (
            <span key={`${l.id}${l.flatpak}`} className={`dk-chip${l.defaultIsOurs ? " ok" : ""}`} title={l.defaultRunner ?? ""}>
              {protonApplies() && <span className="dot" />}
              <LauncherIcon id={l.id} />
              {LAUNCHER_NAME[l.id]}
              {l.flatpak ? " (Flatpak)" : ""}
              {/* Windows: whether a launcher runs isn't checked (only needed for Linux fixes). */}
              {protonApplies() && ` · ${l.running ? t("desktop.games.running", "running") : t("desktop.games.closed", "closed")}`}
              {l.defaultIsOurs ? ` · ${t("desktop.games.ourDefault", "our Proton is the default")}` : ""}
            </span>
          ))}
          <span className="dk-spacer" />
          <BusyButton onClick={() => rescan(step !== "pick")} disabled={busy !== null}>
            {t("desktop.games.rescan", "Rescan")}
          </BusyButton>
          <button type="button" className="dk-btn" onClick={onStop} disabled={busy !== null} title={t("desktop.games.stopHint")}>
            {t("desktop.games.stop")}
          </button>
        </div>
      </section>

      {protonApplies() && (
        <section className="dk-card">
          <h2>{t("desktop.games.protonTitle", "DualSense Proton build")}</h2>
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
        </section>
      )}

      {protonApplies() && <SystemCard report={report} />}

      {closeNote && <div className="dk-notice">{closeNote}</div>}
      {error && <div className="dk-notice error">{error}</div>}

      {step === "pick" && (
        <section className="dk-card">
          <h2>{t("desktop.games.changesTitle", "Recommended changes")}</h2>
          {fixes.length === 0 ? (
            <p className="dk-good">{t("desktop.games.allGood", "Everything is set up. Nothing to change.")}</p>
          ) : (
            <>
              <p className="dk-hint">{t("desktop.games.changesHint", "Recommended changes are ticked. Untick anything you'd rather keep as it is.")}</p>
              <FixList fixes={fixes} chosen={chosen} onToggle={toggle} />
              <div className="dk-row-btns">
                <button type="button" className="dk-btn primary" disabled={selected.length === 0} onClick={() => setStep("review")}>
                  {t("desktop.games.review", { count: selected.length })}
                </button>
              </div>
            </>
          )}
        </section>
      )}

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
          {blocking.map((l) => (
            <div key={l} className="dk-notice">
              <span>
                {t("desktop.games.mustClose", {
                  launcher: LAUNCHER_NAME[l],
                  defaultValue: "{{launcher}} is running. It rewrites these settings when it quits, which would undo the changes, so it has to be closed first.",
                })}
              </span>
              <span className="dk-spacer" />
              <BusyButton className="dk-btn" disabled={busy !== null} onClick={() => closeLauncher(l)}>
                {t("desktop.games.closeLauncher", { launcher: LAUNCHER_NAME[l], defaultValue: "Close {{launcher}}" })}
              </BusyButton>
            </div>
          ))}
          <div className="dk-row-btns">
            <BusyButton className="dk-btn primary" disabled={blocking.length > 0 || busy !== null || selected.length === 0} onClick={apply}>
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
          <p className="dk-hint">{t("desktop.games.doneHint", "Start the launcher again; it picks up the new settings when it starts.")}</p>
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

      {backups.length > 0 && (
        <details className="dk-card dk-advanced">
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
    </div>
  );
}

export function allFixes(r: GamesReport): Fix[] {
  return [...r.launchers.flatMap((l) => l.fixes), ...r.system.fixes, ...r.games.flatMap((g) => g.fixes)];
}

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

function SystemCard({ report }: { report: GamesReport }) {
  const { t } = useTranslation();
  const s = report.system;
  const proAudio = s.proAudio;
  return (
    <section className="dk-card">
      <h2>{t("desktop.games.systemTitle", "This computer")}</h2>
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
      </dl>
      {s.envWarnings.length > 0 && (
        <p className="dk-hint">
          {t("desktop.games.envHint", "These variables are set outside any launcher, so this app doesn't change them. Remove them from the file named above, then log out and back in.")}
        </p>
      )}
      {s.proAudioRules.some((r) => r.startsWith("/etc")) && (
        <p className="dk-hint">{t("desktop.games.systemRule", "A system-wide audio rule forces pro-audio. It's outside your home folder, so this app won't change it.")}</p>
      )}
    </section>
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
