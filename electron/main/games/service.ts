// Main-process side of the Games page (Linux only): owns scanning, applying
// confirmed fixes, undo (closing and reopening the launchers the page named),
// and installing our
// Proton build. The renderer only ever passes fix ids, a backup id or a
// launcher name, all validated in ipc.ts. Nothing here runs until the user has
// allowed the Games page to read launcher settings (the gamesScanAllowed setting).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readWindowsStores, type WindowsStores } from "./windowsStores";
import { dominantColor } from "./artColor";
import { ArtColorCache } from "./artColorCache";
import { actionUrl, availableActions, execWords, quietPlay, type QuietPlaySystem } from "./actions";
import { errorText, KeyedError, keyedText, logged } from "../../../src/errorText";
import { FeedMissingError, feedProblem } from "../updateFeed";
import { gameDetails, type GameDetails } from "./details";
import type { RunningCandidate } from "./running";
import type { ArtKind, Fix, GameAction, GameEntry, GameInfo, LauncherId } from "../../../src/desktop/games/types";
import { join } from "node:path";
import type { ProtonInstallResult, ProtonProgress, UndoResult } from "../../../src/desktop/api";
import type { ApplyResult, GamesReport, HdrSystem, RestartList } from "../../../src/desktop/games/types";
import type { Download, Manifest } from "../../../src/update/manifest";
import { Backups, UndoConflictError, type BackupSummary } from "./backup";
import { applyFixes, idHash, launchersToRestart, newestLocalBuild, scan, scanFiles, startedSince, type Scan } from "./games";
import { readAhead, withScanTexts, type ScanTexts } from "./files";
import { findHeroicInstalls, heroicTools } from "./heroic";
import { findLutrisInstalls, lutrisWineBuilds } from "./lutris";
import { heroicExeIn, launcherControl, realLayer, steamExeIn, withLaunchersClosed, type LauncherControl, type ReopenPlan } from "./processes";
import { schemeHandlerExec } from "./schemeHandler";
import { installProton, type ExtraTarget } from "./proton";
import { findSteamInstalls, installedTools, windowsSteamRoots } from "./steam";
import {
  amixerLayer,
  dualSenseCards,
  dualSenseMixers,
  restartWirePlumber,
  restoreDualSenseMixer,
  saveDualSenseMixer,
  setCardProfile,
  setDualSenseMixer,
  type AudioCard,
  type MixerLayer,
} from "./system";
import { hdrSystem } from "./hdr";

const MANIFEST_TIMEOUT_MS = 5000;
const HDR_CACHE_MS = 3000;

export interface GamesServiceDeps {
  userData: string;
  allowed: () => boolean; // the user's consent
  // The update feed, for the Proton build. asked = false: a scan's lookup
  // (index.ts: under the automatic-checks switch; null = not looked up, never
  // online with the switch off); true: Install, the user asked.
  fetchManifest: (asked: boolean) => Promise<Manifest | null>;
  download: (d: Download, path: string, progress: (got: number, total: number) => void) => Promise<void>;
  onProtonProgress: (p: ProtonProgress) => void;
  notDetected: () => Set<string>; // game keys the player marked "controller not detected"
  hdrMarked: () => Set<string>; // game keys the player marked "Supports HDR"
  launchers?: LauncherControl; // tests: a fake process layer
  gameRunning?: () => boolean; // the library sees a game running (Windows: launchers aren't closed then)
  quietPlaySystem?: Omit<QuietPlaySystem, "running" | "flatpak">; // tests: no xdg-mime, registry or file checks
  // Linux: the volume fix is remembered (the controllerVolumeFull setting): the
  // app sets the levels to full again whenever the controller's card reappears.
  volumeKept?: () => boolean;
  keepVolume?: (on: boolean) => void;
  probes?: { audioCards: () => Promise<AudioCard[]>; hdr: () => Promise<HdrSystem>; mixer?: MixerLayer }; // tests: no pactl / kscreen-doctor / gdbus / gamescope / amixer (no mixer: no controls)
}

// Where ▶ Play finds the launchers' programs on this system.
const realQuietPlaySystem = (): Omit<QuietPlaySystem, "running" | "flatpak"> => ({
  platform: process.platform,
  heroicHandler: async () => {
    const exec = await schemeHandlerExec("heroic");
    return exec === null ? null : execWords(exec);
  },
  exists: existsSync,
  steamExe: () => steamExeIn(windowsSteamRoots(), existsSync),
  heroicExe: () => heroicExeIn(process.env, existsSync),
});

export class GamesService {
  private readonly home = homedir();
  private readonly backups: Backups;
  private readonly launchers: LauncherControl;
  // cache: OK — key=none (the published Proton build); invalidated=refreshed on each scan (5 s timeout), the last known one is kept when offline; bound=1 entry
  private latest: Manifest["proton"] | null = null;
  // Apply, undo and install never overlap (each reads and writes launcher files).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: GamesServiceDeps) {
    this.backups = new Backups(join(deps.userData, "game-setup-backups"));
    this.launchers = deps.launchers ?? launcherControl(realLayer(() => deps.gameRunning?.() ?? false));
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    // error: NOT-WORTH — runs after a failed earlier job too: one job's failure must not block the next (it already went to that job's caller)
    const next = this.queue.then(run, run);
    // error: NOT-WORTH — the queue's own copy; the caller gets `next` with the error
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireConsent(): void {
    if (!this.deps.allowed()) throw new KeyedError("desktop.errors.main.gamesNotAllowed");
  }

  private localBuilds(): string[] {
    return [...findSteamInstalls(this.home).flatMap(installedTools), ...findHeroicInstalls(this.home).flatMap(heroicTools), ...findLutrisInstalls(this.home).flatMap(lutrisWineBuilds)];
  }

  // The published Proton build; a slow or offline network never holds up a scan.
  private async refreshLatest(): Promise<void> {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // lifetime: OK — one-shot 5 s timer, cleared in the finally below once the feed answers (lifetime pass batch 4)
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), MANIFEST_TIMEOUT_MS)));
      try {
        const manifest = await Promise.race([this.deps.fetchManifest(false), timeout]);
        // No feed looked up (automatic checks off, none fetched yet): keep the last known build.
        if (manifest) this.latest = manifest.proton ?? null;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // error: NOT-WORTH — offline: the scan keeps the last known Proton build and offers no update it can't see
      // keep the last known build
    }
  }

  // The HDR check (screens, gamescope, its layer) runs again whenever a page
  // scans, e.g. when the Games page or an HDR game's page opens; a scan within
  // a few seconds of the last one reuses its answer.
  // cache: OK — key=none (the HDR check); invalidated=3 s TTL (HDR_CACHE_MS); bound=1 entry
  private hdrCache: { at: number; value: Promise<HdrSystem> } | null = null;
  private hdrCheck(probe: () => Promise<HdrSystem>): Promise<HdrSystem> {
    const now = Date.now();
    if (!this.hdrCache || now - this.hdrCache.at > HDR_CACHE_MS) this.hdrCache = { at: now, value: probe() };
    return this.hdrCache.value;
  }

  private async fresh(): Promise<{ scan: Scan; texts: ScanTexts }> {
    this.requireConsent();
    // Windows: no Proton to look up and no PipeWire audio profile to check.
    const linux = process.platform === "linux";
    const probes = this.deps.probes ?? { audioCards: dualSenseCards, hdr: () => hdrSystem() };
    const mixer = this.mixerLayer();
    const [audioCards, hdr, mixers, , texts] = await Promise.all([
      linux ? probes.audioCards() : Promise.resolve([]),
      linux ? this.hdrCheck(probes.hdr) : Promise.resolve(undefined),
      linux && mixer ? dualSenseMixers(mixer) : Promise.resolve([]),
      linux ? this.refreshLatest() : Promise.resolve(),
      readAhead(scanFiles(this.home)),
    ]);
    const running = await this.launchers.running();
    const result = withScanTexts(texts, () =>
      scan({
        home: this.home,
        // Proton is how Steam runs Windows games on Linux: nothing to offer on Windows.
        ourProton: process.platform === "win32" ? null : newestLocalBuild(this.localBuilds()),
        latestProton: this.latest?.name ?? null,
        latestSize: this.latest?.tarball.size ?? null,
        running,
        audioCards,
        mixers,
        volumeKept: this.deps.volumeKept?.() ?? false,
        windowsStores: (this.lastStores = process.platform === "win32" ? readWindowsStores() : undefined),
        notDetected: this.deps.notDetected(),
        hdrMarked: this.deps.hdrMarked(),
        hdr,
      }),
    );
    return { scan: result, texts };
  }

  // In line with apply, undo and install: a scan asked for while a change is
  // being written (launchers closing, up to 30 s) reads the files after it,
  // never a mix, and scans finish in the order they were asked for.
  scan(): Promise<GamesReport> {
    return this.exclusive(async () => {
      const { scan: result, texts } = await this.fresh();
      const report = this.shown(result.report);
      this.lastGames = report.games;
      // The details read the same manifests and localconfig: one read each.
      this.lastDetails = withScanTexts(texts, () => gameDetails(this.home, this.lastStores ? [...this.lastStores.gog.games, ...this.lastStores.epic.games] : []));
      this.colors.prune(this.lastDetails); // changed art is noticed by its mtime on the next ask
      return report;
    });
  }

  // The report as the page shows it: changed files under the home folder as
  // ~/… (a dev copy's test HOME never shows; apply works from the fresh scan).
  private shown(report: GamesReport): GamesReport {
    // loop: NOT-WORTH — files of one fix
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
  // cache: OK — key=none (the last scan's games); invalidated=replaced by every scan; bound=games in the library
  private lastGames: GameEntry[] = [];
  // cache: OK — key=none (Windows store listing); invalidated=replaced by every scan; bound=1 entry
  private lastStores: WindowsStores | undefined;
  // cache: OK — key=game key; invalidated=replaced by every scan; bound=games in the library
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

  // ▶ Play while the game's launcher is closed: the launcher started in the
  // background with the game (actions.ts quietPlay), or null to open the link.
  async quietPlay(key: string): Promise<ReopenPlan | null> {
    this.requireConsent();
    const game = this.lastGames.find((g) => g.key === key);
    const url = game && actionUrl(game, "play", this.lastDetails.get(key)?.lutrisSlug);
    if (!game || !url) return null;
    const installs: Array<{ root: string; flatpak: boolean }> = game.launcher === "steam" ? findSteamInstalls(this.home) : game.launcher === "heroic" ? findHeroicInstalls(this.home) : [];
    const flatpak = installs.some((i) => i.flatpak && key.startsWith(`${game.launcher}-${idHash(i.root)}:`));
    return quietPlay(game.launcher, url, { ...(this.deps.quietPlaySystem ?? realQuietPlaySystem()), running: () => this.launchers.running(), flatpak });
  }

  // A local art file for the ds5-art:// protocol: only files the last scan
  // resolved for a known game, and only with consent.
  artPath(key: string, kind: ArtKind): string | undefined {
    if (!this.deps.allowed()) return undefined;
    return this.lastDetails.get(key)?.artPaths[kind];
  }

  // A game's signature color from its art: kept across scans per art file +
  // mtime (artColorCache.ts), so a scan doesn't decode every cover again.
  private readonly colors = new ArtColorCache(dominantColor);
  artColor(key: string): string | null {
    this.requireConsent();
    const paths = this.lastDetails.get(key)?.artPaths;
    return this.colors.get(key, paths?.cover ?? paths?.hero ?? paths?.header);
  }

  runningCandidates(): RunningCandidate[] {
    if (!this.deps.allowed()) return [];
    return this.lastGames.map((g) => ({ key: g.key, launcher: g.launcher, id: g.id, installDir: this.lastDetails.get(g.key)?.installDir }));
  }

  // The controller's ALSA controls (Linux): amixer, a test's fake, or none
  // when a test gave probes without one.
  private mixerLayer(): MixerLayer | undefined {
    return this.deps.probes ? this.deps.probes.mixer : amixerLayer;
  }

  apply(fixIds: string[], restart: RestartList): Promise<ApplyResult> {
    const mixer = this.mixerLayer();
    const setMixer = mixer ? (key: string, changes: Parameters<typeof setDualSenseMixer>[1]) => setDualSenseMixer(key, changes, mixer) : undefined;
    const saveMixer = mixer ? (key: string) => saveDualSenseMixer(key, mixer) : undefined;
    return this.exclusive(async () =>
      applyFixes((await this.fresh()).scan, fixIds, restart, {
        backups: this.backups,
        launchers: this.launchers,
        restartWirePlumber,
        setCardProfile,
        setMixer,
        saveMixer,
        keepVolume: this.deps.keepVolume,
      }),
    );
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
        // Volume changes need the controller connected: checked before
        // anything is marked undone, so Undo can be tried again later.
        const mixer = this.mixerLayer();
        const mixerSets = this.backups.manifest(backupId).mixer ?? [];
        // loop: NOT-WORTH — mixer changes x cards, a few each; once per Undo
        if (mixerSets.length && (!mixer || mixerSets.some((m) => !mixer.cards().some((c) => c.key === m.key)))) return { ok: false, noController: true };
        const run = await withLaunchersClosed(restart, this.launchers, async () => {
          const late = await startedSince(owners, this.launchers);
          return late.length ? { late } : this.backups.restore(backupId);
        });
        if (!run.ok) return { ok: false, blockedBy: restart, problem: run.problem };
        if ("late" in run.value) return { ok: false, blockedBy: run.value.late };
        let audioRestartFailed: string | undefined;
        // error: SHOWN — desktop.games.undoAudioRestart (was SILENT-BUG: the failed restart was dropped)
        if (run.value.after.includes("restart-wireplumber")) await restartWirePlumber().catch((cause: unknown) => (audioRestartFailed = errorText(cause)));
        let volumeNotSaved: string | undefined;
        // loop: SERIAL-REQUIRED — ALSA order: one card's restore (and its save, a password prompt) after another, ≤ 2 cards; per Undo
        for (const m of run.value.mixer) {
          await restoreDualSenseMixer(m.key, m.changes, mixer!);
          // The old levels go back into ALSA's saved state too (pkexec, explained on the page).
          if (run.value.mixerSaved) {
            const saved = await saveDualSenseMixer(m.key, mixer!);
            // error: SHOWN — desktop.games.undoVolumeNotSaved (the Undo note)
            if (!saved.ok) volumeNotSaved = saved.reason === "cancelled" ? "cancelled" : saved.message;
          }
        }
        // Undone: the app stops setting them to full when the card reappears.
        if (run.value.mixer.length) this.deps.keepVolume?.(false);
        return {
          ok: true,
          restored: run.value.files.map((f) => this.tilde(f)),
          ...(run.reopenFailed.length ? { reopenFailed: run.reopenFailed } : {}),
          ...(audioRestartFailed ? { audioRestartFailed } : {}),
          ...(volumeNotSaved ? { volumeNotSaved } : {}),
        };
      } catch (cause) {
        // error: SHOWN — desktop.errors.main.alreadyUndone and the other keyed errors (shownText in GamesPage's error notice after Undo); an OS error's own text as it is
        if (cause instanceof UndoConflictError) return { ok: false, conflict: cause.changed.map((f) => this.tilde(f)) };
        return { ok: false, error: errorText(cause) };
      }
    });
  }

  // The app's own change history; like everything here, only shown once the
  // user has let the app look at launcher settings.
  listBackups(): BackupSummary[] {
    if (!this.deps.allowed()) return [];
    // loop: NOT-WORTH — files of one backup set
    return this.backups.list().map((b) => ({ ...b, files: b.files.map((f) => this.tilde(f)), ...(b.damaged ? { damaged: this.tilde(b.damaged) } : {}) }));
  }

  private tilde(path: string): string {
    return path.startsWith(this.home + "/") || path.startsWith(this.home + "\\") ? "~" + path.slice(this.home.length) : path;
  }

  installLatestProton(): Promise<ProtonInstallResult> {
    return this.exclusive(async () => {
      try {
        this.requireConsent();
        let manifest: Manifest | null;
        try {
          manifest = await this.deps.fetchManifest(true);
        } catch (cause) {
          // error: SHOWN — desktop.updateFeed.offline / .unsigned / .malformed by problem on the Proton card (the raw text goes to the log)
          if (cause instanceof FeedMissingError) return { ok: false, message: keyedText("desktop.errors.main.protonNotPublished") };
          logged("installing Proton: the update feed")(cause);
          return { ok: false, message: errorText(cause), problem: feedProblem(cause) };
        }
        const build = manifest?.proton;
        if (!build) return { ok: false, message: keyedText("desktop.errors.main.protonNotPublished") };
        const steam = findSteamInstalls(this.home);
        const heroic = findHeroicInstalls(this.home);
        const lutris = findLutrisInstalls(this.home);
        const native = [
          ...steam.filter((s) => !s.flatpak).map((s) => s.toolsDir),
          ...heroic.filter((h) => !h.flatpak).map((h) => h.toolsDir),
          ...lutris.filter((l) => !l.flatpak).map((l) => l.wineDir),
        ];
        const primary = native[0] ?? steam[0]?.toolsDir ?? heroic[0]?.toolsDir ?? lutris[0]?.wineDir;
        if (!primary) return { ok: false, message: keyedText("desktop.errors.main.noLauncher") };
        const extras: ExtraTarget[] = [
          ...steam.filter((s) => s.toolsDir !== primary).map((s) => ({ dir: s.toolsDir, link: !s.flatpak })),
          ...heroic.filter((h) => h.toolsDir !== primary).map((h) => ({ dir: h.toolsDir, link: !h.flatpak })),
          // Native Lutris already lists Steam's compatibility tools.
          // loop: NOT-WORTH — Steam installs
          ...lutris.filter((l) => l.wineDir !== primary && (l.flatpak || steam.every((s) => s.flatpak))).map((l) => ({ dir: l.wineDir, link: !l.flatpak })),
        ];
        const installed = await installProton({ name: build.name, tarball: build.tarball }, primary, extras, { download: this.deps.download }, this.deps.onProtonProgress);
        return { ok: true, name: build.name, installed: installed.map((p) => this.tilde(p)) };
      } catch (cause) {
        // error: SHOWN — desktop.errors.main.diskSpace and the other keyed install/download errors (shownText on the Proton card); an OS error's own text as it is
        return { ok: false, message: errorText(cause) };
      }
    });
  }
}
