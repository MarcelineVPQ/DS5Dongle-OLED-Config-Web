// Main-process side of the Games page (Linux only): owns scanning, applying
// confirmed fixes, undo (closing and reopening the launchers the page named),
// and installing our
// Proton build. The renderer only ever passes fix ids, a backup id or a
// launcher name, all validated in ipc.ts. Nothing here runs until the user has
// allowed the Games page to read launcher settings (the gamesScanAllowed setting).
import { homedir } from "node:os";
import { readWindowsStores, type WindowsStores } from "./windowsStores";
import { dominantColor } from "./artColor";
import { actionUrl, availableActions } from "./actions";
import { errorText } from "../../../src/errorText";
import { gameDetails, type GameDetails } from "./details";
import type { RunningCandidate } from "./running";
import type { ArtKind, Fix, GameAction, GameEntry, GameInfo, LauncherId } from "../../../src/desktop/games/types";
import { join } from "node:path";
import type { ProtonInstallResult, ProtonProgress, UndoResult } from "../../../src/desktop/api";
import type { ApplyResult, GamesReport, HdrSystem, RestartList } from "../../../src/desktop/games/types";
import type { Download, Manifest } from "../../../src/update/manifest";
import { Backups, UndoConflictError, type BackupSummary } from "./backup";
import { applyFixes, launchersToRestart, newestLocalBuild, scan, startedSince, type Scan } from "./games";
import { findHeroicInstalls, heroicTools } from "./heroic";
import { findLutrisInstalls, lutrisWineBuilds } from "./lutris";
import { launcherControl, realLayer, withLaunchersClosed, type LauncherControl } from "./processes";
import { installProton, type ExtraTarget } from "./proton";
import { findSteamInstalls, installedTools } from "./steam";
import { dualSenseCards, restartWirePlumber, setCardProfile, type AudioCard } from "./system";
import { hdrSystem } from "./hdr";

const MANIFEST_TIMEOUT_MS = 5000;
const HDR_CACHE_MS = 3000;

export interface GamesServiceDeps {
  userData: string;
  allowed: () => boolean; // the user's consent
  fetchManifest: () => Promise<Manifest>;
  download: (d: Download, path: string, progress: (got: number, total: number) => void) => Promise<void>;
  onProtonProgress: (p: ProtonProgress) => void;
  notDetected: () => Set<string>; // game keys the player marked "controller not detected"
  hdrMarked: () => Set<string>; // game keys the player marked "Supports HDR"
  launchers?: LauncherControl; // tests: a fake process layer
  gameRunning?: () => boolean; // the library sees a game running (Windows: launchers aren't closed then)
  probes?: { audioCards: () => Promise<AudioCard[]>; hdr: () => Promise<HdrSystem> }; // tests: no pactl / kscreen-doctor / gdbus / gamescope
}

export class GamesService {
  private readonly home = homedir();
  private readonly backups: Backups;
  private readonly launchers: LauncherControl;
  private latest: Manifest["proton"] | null = null;
  // Apply, undo and install never overlap (each reads and writes launcher files).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: GamesServiceDeps) {
    this.backups = new Backups(join(deps.userData, "game-setup-backups"));
    this.launchers = deps.launchers ?? launcherControl(realLayer(() => deps.gameRunning?.() ?? false));
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireConsent(): void {
    if (!this.deps.allowed()) throw new Error("Game setup hasn't been allowed to read launcher settings.");
  }

  private localBuilds(): string[] {
    return [...findSteamInstalls(this.home).flatMap(installedTools), ...findHeroicInstalls(this.home).flatMap(heroicTools), ...findLutrisInstalls(this.home).flatMap(lutrisWineBuilds)];
  }

  // The published Proton build; a slow or offline network never holds up a scan.
  private async refreshLatest(): Promise<void> {
    try {
      const manifest = await Promise.race([this.deps.fetchManifest(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), MANIFEST_TIMEOUT_MS))]);
      this.latest = manifest.proton ?? null;
    } catch {
      // keep the last known build
    }
  }

  // The HDR check (screens, gamescope, its layer) runs again whenever a page
  // scans, e.g. when the Games page or an HDR game's page opens; a scan within
  // a few seconds of the last one reuses its answer.
  private hdrCache: { at: number; value: Promise<HdrSystem> } | null = null;
  private hdrCheck(probe: () => Promise<HdrSystem>): Promise<HdrSystem> {
    const now = Date.now();
    if (!this.hdrCache || now - this.hdrCache.at > HDR_CACHE_MS) this.hdrCache = { at: now, value: probe() };
    return this.hdrCache.value;
  }

  private async fresh(): Promise<Scan> {
    this.requireConsent();
    // Windows: no Proton to look up and no PipeWire audio profile to check.
    const linux = process.platform === "linux";
    const probes = this.deps.probes ?? { audioCards: dualSenseCards, hdr: () => hdrSystem() };
    const [audioCards, hdr] = await Promise.all([
      linux ? probes.audioCards() : Promise.resolve([]),
      linux ? this.hdrCheck(probes.hdr) : Promise.resolve(undefined),
      linux ? this.refreshLatest() : Promise.resolve(),
    ]);
    return scan({
      home: this.home,
      // Proton is how Steam runs Windows games on Linux: nothing to offer on Windows.
      ourProton: process.platform === "win32" ? null : newestLocalBuild(this.localBuilds()),
      latestProton: this.latest?.name ?? null,
      latestSize: this.latest?.tarball.size ?? null,
      running: await this.launchers.running(),
      audioCards,
      windowsStores: (this.lastStores = process.platform === "win32" ? readWindowsStores() : undefined),
      notDetected: this.deps.notDetected(),
      hdrMarked: this.deps.hdrMarked(),
      hdr,
    });
  }

  // In line with apply, undo and install: a scan asked for while a change is
  // being written (launchers closing, up to 30 s) reads the files after it,
  // never a mix, and scans finish in the order they were asked for.
  scan(): Promise<GamesReport> {
    return this.exclusive(async () => {
      const report = this.shown((await this.fresh()).report);
      this.lastGames = report.games;
      this.lastDetails = gameDetails(this.home, this.lastStores ? [...this.lastStores.gog.games, ...this.lastStores.epic.games] : []);
      this.colors.clear(); // the art may have arrived or changed since
      return report;
    });
  }

  // The report as the page shows it: changed files under the home folder as
  // ~/… (a dev copy's test HOME never shows; apply works from the fresh scan).
  private shown(report: GamesReport): GamesReport {
    const fixes = (list: Fix[]) => list.map((f) => ({ ...f, files: f.files.map((file) => this.tilde(file)) }));
    return {
      ...report,
      launchers: report.launchers.map((l) => ({ ...l, fixes: fixes(l.fixes) })),
      system: { ...report.system, fixes: fixes(report.system.fixes) },
      games: report.games.map((g) => ({ ...g, fixes: fixes(g.fixes) })),
    };
  }

  // The launchers running right now (the review asks when it opens: a scan's
  // answer may be minutes old).
  async runningLaunchers(): Promise<LauncherId[]> {
    this.requireConsent();
    return [...(await this.launchers.running())];
  }

  // ---- Games library: details, artwork, the running game ----
  private lastGames: GameEntry[] = [];
  private lastStores: WindowsStores | undefined;
  private lastDetails = new Map<string, GameDetails>();

  // Install folder, size, play time and which artwork exists, per game key
  // (from the last scan; the page asks after scanning).
  details(): Record<string, GameInfo> {
    this.requireConsent();
    const games = new Map(this.lastGames.map((g) => [g.key, g]));
    return Object.fromEntries(
      [...this.lastDetails].map(([key, { artPaths: _paths, prefixDir, lutrisSlug, ...info }]) => {
        const game = games.get(key);
        const actions = game ? availableActions(game, { installDir: !!info.installDir, prefixDir: !!prefixDir, lutrisSlug }) : [];
        return [key, { ...info, actions }];
      }),
    );
  }

  // A game page action, resolved here from the last scan: a launcher link to
  // open, or a scanned folder to show. Unknown games and actions do nothing.
  gameAction(key: string, action: GameAction): { url?: string; folder?: string } {
    this.requireConsent();
    const game = this.lastGames.find((g) => g.key === key);
    const d = this.lastDetails.get(key);
    if (!game) return {};
    if (action === "installFolder") return d?.installDir ? { folder: d.installDir } : {};
    if (action === "prefixFolder") return d?.prefixDir ? { folder: d.prefixDir } : {};
    const url = actionUrl(game, action, d?.lutrisSlug);
    return url ? { url } : {};
  }

  // A local art file for the ds5-art:// protocol: only files the last scan
  // resolved for a known game, and only with consent.
  artPath(key: string, kind: ArtKind): string | undefined {
    if (!this.deps.allowed()) return undefined;
    return this.lastDetails.get(key)?.artPaths[kind];
  }

  // A game's signature color from its art (cached per game).
  private colors = new Map<string, string | null>();
  artColor(key: string): string | null {
    this.requireConsent();
    if (this.colors.has(key)) return this.colors.get(key)!;
    const paths = this.lastDetails.get(key)?.artPaths;
    const file = paths?.cover ?? paths?.hero ?? paths?.header;
    const color = file ? dominantColor(file) : null;
    this.colors.set(key, color);
    return color;
  }

  runningCandidates(): RunningCandidate[] {
    if (!this.deps.allowed()) return [];
    return this.lastGames.map((g) => ({ key: g.key, launcher: g.launcher, id: g.id, installDir: this.lastDetails.get(g.key)?.installDir }));
  }

  apply(fixIds: string[], restart: RestartList): Promise<ApplyResult> {
    return this.exclusive(async () => applyFixes(await this.fresh(), fixIds, restart, { backups: this.backups, launchers: this.launchers, restartWirePlumber, setCardProfile }));
  }

  undo(backupId: string, allowed: RestartList): Promise<UndoResult> {
    return this.exclusive(async () => {
      this.requireConsent();
      try {
        // Same rule as writing: a running launcher would overwrite the restored
        // files, so it's closed and reopened, only if the page said so.
        const { restart, blockedBy } = launchersToRestart(this.backups.owners(backupId), await this.launchers.running(), allowed);
        if (blockedBy.length) return { ok: false, blockedBy };
        const owners = this.backups.owners(backupId);
        const run = await withLaunchersClosed(restart, this.launchers, async () => {
          const late = await startedSince(owners, this.launchers);
          return late.length ? { late } : this.backups.restore(backupId);
        });
        if (!run.ok) return { ok: false, blockedBy: restart, problem: run.problem };
        if ("late" in run.value) return { ok: false, blockedBy: run.value.late };
        if (run.value.after.includes("restart-wireplumber")) await restartWirePlumber().catch(() => undefined);
        return { ok: true, restored: run.value.files.map((f) => this.tilde(f)), ...(run.reopenFailed.length ? { reopenFailed: run.reopenFailed } : {}) };
      } catch (cause) {
        if (cause instanceof UndoConflictError) return { ok: false, conflict: cause.changed.map((f) => this.tilde(f)) };
        return { ok: false, error: errorText(cause) };
      }
    });
  }

  // The app's own change history; like everything here, only shown once the
  // user has let the app look at launcher settings.
  listBackups(): BackupSummary[] {
    if (!this.deps.allowed()) return [];
    return this.backups.list().map((b) => ({ ...b, files: b.files.map((f) => this.tilde(f)) }));
  }

  private tilde(path: string): string {
    return path.startsWith(this.home + "/") || path.startsWith(this.home + "\\") ? "~" + path.slice(this.home.length) : path;
  }

  installLatestProton(): Promise<ProtonInstallResult> {
    return this.exclusive(async () => {
      try {
        this.requireConsent();
        const build = (await this.deps.fetchManifest()).proton;
        if (!build) return { ok: false, message: "No Proton build is published yet." };
        const steam = findSteamInstalls(this.home);
        const heroic = findHeroicInstalls(this.home);
        const lutris = findLutrisInstalls(this.home);
        const native = [
          ...steam.filter((s) => !s.flatpak).map((s) => s.toolsDir),
          ...heroic.filter((h) => !h.flatpak).map((h) => h.toolsDir),
          ...lutris.filter((l) => !l.flatpak).map((l) => l.wineDir),
        ];
        const primary = native[0] ?? steam[0]?.toolsDir ?? heroic[0]?.toolsDir ?? lutris[0]?.wineDir;
        if (!primary) return { ok: false, message: "No Steam, Heroic or Lutris installation was found." };
        const extras: ExtraTarget[] = [
          ...steam.filter((s) => s.toolsDir !== primary).map((s) => ({ dir: s.toolsDir, link: !s.flatpak })),
          ...heroic.filter((h) => h.toolsDir !== primary).map((h) => ({ dir: h.toolsDir, link: !h.flatpak })),
          // Native Lutris already lists Steam's compatibility tools.
          ...lutris.filter((l) => l.wineDir !== primary && (l.flatpak || steam.every((s) => s.flatpak))).map((l) => ({ dir: l.wineDir, link: !l.flatpak })),
        ];
        const installed = await installProton({ name: build.name, tarball: build.tarball }, primary, extras, { download: this.deps.download }, this.deps.onProtonProgress);
        return { ok: true, name: build.name, installed: installed.map((p) => this.tilde(p)) };
      } catch (cause) {
        return { ok: false, message: errorText(cause) };
      }
    });
  }
}
