// Main-process side of the Games page (Linux only): owns scanning, applying
// confirmed fixes, undo, closing launchers on request and installing our
// Proton build. The renderer only ever passes fix ids, a backup id or a
// launcher name, all validated in ipc.ts. Nothing here runs until the user has
// allowed the Games page to read launcher settings (the gamesScanAllowed setting).
import { homedir } from "node:os";
import { join } from "node:path";
import type { CloseLauncherResult, ProtonInstallResult, ProtonProgress, UndoResult } from "../../../src/desktop/api";
import type { ApplyResult, GamesReport, LauncherId } from "../../../src/desktop/games/types";
import type { Download, Manifest } from "../../../src/update/manifest";
import { Backups, UndoConflictError, type BackupSummary } from "./backup";
import { applyFixes, newestLocalBuild, scan, type Scan } from "./games";
import { findHeroicInstalls, heroicTools } from "./heroic";
import { findLutrisInstalls, lutrisWineBuilds } from "./lutris";
import { closeLauncher, runningLaunchers } from "./processes";
import { installProton, type ExtraTarget } from "./proton";
import { findSteamInstalls, installedTools } from "./steam";
import { dualSenseCards, restartWirePlumber, setCardProfile } from "./system";

const MANIFEST_TIMEOUT_MS = 5000;

export interface GamesServiceDeps {
  userData: string;
  allowed: () => boolean; // the user's consent
  fetchManifest: () => Promise<Manifest>;
  download: (d: Download, path: string, progress: (got: number, total: number) => void) => Promise<void>;
  onProtonProgress: (p: ProtonProgress) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export class GamesService {
  private readonly home = homedir();
  private readonly backups: Backups;
  private latest: Manifest["proton"] | null = null;
  // Apply, undo and install never overlap (each reads and writes launcher files).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: GamesServiceDeps) {
    this.backups = new Backups(join(deps.userData, "game-setup-backups"));
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

  private async fresh(): Promise<Scan> {
    this.requireConsent();
    const [audioCards] = await Promise.all([dualSenseCards(), this.refreshLatest()]);
    return scan({
      home: this.home,
      ourProton: newestLocalBuild(this.localBuilds()),
      latestProton: this.latest?.name ?? null,
      latestSize: this.latest?.tarball.size ?? null,
      running: runningLaunchers(),
      audioCards,
    });
  }

  async scan(): Promise<GamesReport> {
    return (await this.fresh()).report;
  }

  apply(fixIds: string[]): Promise<ApplyResult> {
    return this.exclusive(async () => applyFixes(await this.fresh(), fixIds, { backups: this.backups, runningLaunchers, restartWirePlumber, setCardProfile }));
  }

  undo(backupId: string): Promise<UndoResult> {
    return this.exclusive(async () => {
      this.requireConsent();
      try {
        // Same rule as writing: a running launcher would overwrite the restored files.
        const running = runningLaunchers();
        const blockedBy = this.backups.owners(backupId).filter((l) => running.has(l));
        if (blockedBy.length) return { ok: false, blockedBy };
        const { files, after } = this.backups.restore(backupId);
        if (after.includes("restart-wireplumber")) await restartWirePlumber().catch(() => undefined);
        return { ok: true, restored: files.map((f) => this.tilde(f)) };
      } catch (cause) {
        if (cause instanceof UndoConflictError) return { ok: false, conflict: cause.changed.map((f) => this.tilde(f)) };
        return { ok: false, error: message(cause) };
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
    return path.startsWith(this.home + "/") ? "~" + path.slice(this.home.length) : path;
  }

  async close(launcher: LauncherId): Promise<CloseLauncherResult> {
    this.requireConsent();
    try {
      return await closeLauncher(launcher);
    } catch {
      return "failed";
    }
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
        return { ok: false, message: message(cause) };
      }
    });
  }
}
