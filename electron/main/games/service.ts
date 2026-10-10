// Main-process side of the Games page (Linux only): owns scanning, applying
// confirmed fixes, undo, closing launchers on request and installing our
// Proton build. The renderer only ever passes fix ids, a backup id or a
// launcher name, all validated in ipc.ts.
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApplyResult, GamesReport, LauncherId } from "../../../src/desktop/games/types";
import type { Manifest } from "../../../src/update/manifest";
import type { Download } from "../../../src/update/manifest";
import { Backups, type BackupSummary } from "./backup";
import { applyFixes, newestLocalBuild, scan } from "./games";
import { findHeroicInstalls, heroicTools } from "./heroic";
import { findLutrisInstalls, lutrisWineBuilds } from "./lutris";
import { closeLauncher, runningLaunchers, type CloseResult } from "./processes";
import { installProton, type ExtraTarget, type ProtonPhase } from "./proton";
import { findSteamInstalls, installedTools } from "./steam";
import { dualSenseCards, restartWirePlumber, setCardProfile } from "./system";

export type ProtonInstallResult = { ok: true; name: string; installed: string[] } | { ok: false; message: string };

export interface GamesServiceDeps {
  userData: string;
  fetchManifest: () => Promise<Manifest>;
  download: (d: Download, path: string, progress: (got: number, total: number) => void) => Promise<void>;
  onProtonProgress: (p: ProtonPhase) => void;
}

export class GamesService {
  private readonly home = homedir();
  private readonly backups: Backups;
  private latest: Manifest["proton"] | null = null;
  private installing = false;

  constructor(private readonly deps: GamesServiceDeps) {
    this.backups = new Backups(join(deps.userData, "game-setup-backups"));
  }

  private localBuilds(): string[] {
    return [...findSteamInstalls(this.home).flatMap(installedTools), ...findHeroicInstalls(this.home).flatMap(heroicTools), ...findLutrisInstalls(this.home).flatMap(lutrisWineBuilds)];
  }

  private async fresh() {
    try {
      this.latest = (await this.deps.fetchManifest()).proton ?? null;
    } catch {
      // offline: keep the last known build, scan with what's installed
    }
    return scan({
      home: this.home,
      ourProton: newestLocalBuild(this.localBuilds()),
      latestProton: this.latest?.name ?? null,
      running: runningLaunchers(),
      audioCards: await dualSenseCards(),
    });
  }

  async scan(): Promise<GamesReport> {
    return (await this.fresh()).report;
  }

  async apply(fixIds: string[]): Promise<ApplyResult> {
    return applyFixes(await this.fresh(), fixIds, { backups: this.backups, restartWirePlumber, setCardProfile });
  }

  undo(backupId: string): { restored: string[]; blockedBy: LauncherId[] } {
    // Same rule as writing: a running launcher would overwrite the restored files.
    const running = runningLaunchers();
    const files = this.backups.manifest(backupId).files.map((f) => f.path);
    const blockedBy = ([...running] as LauncherId[]).filter((l) => files.some((f) => ownedBy(f, this.home) === l));
    if (blockedBy.length) return { restored: [], blockedBy };
    return { restored: this.backups.restore(backupId), blockedBy: [] };
  }

  listBackups(): BackupSummary[] {
    return this.backups.list();
  }

  close(launcher: LauncherId): Promise<CloseResult> {
    return closeLauncher(launcher);
  }

  async installLatestProton(): Promise<ProtonInstallResult> {
    if (this.installing) return { ok: false, message: "An install is already running." };
    this.installing = true;
    try {
      const build = (await this.deps.fetchManifest()).proton;
      if (!build) return { ok: false, message: "No Proton build is published yet." };
      const steam = findSteamInstalls(this.home);
      const heroic = findHeroicInstalls(this.home);
      const lutris = findLutrisInstalls(this.home);
      const native = [...steam.filter((s) => !s.flatpak).map((s) => s.toolsDir), ...heroic.filter((h) => !h.flatpak).map((h) => h.toolsDir), ...lutris.filter((l) => !l.flatpak).map((l) => l.wineDir)];
      const primary = native[0] ?? steam[0]?.toolsDir ?? heroic[0]?.toolsDir ?? lutris[0]?.wineDir;
      if (!primary) return { ok: false, message: "No Steam, Heroic or Lutris installation was found." };
      const extras: ExtraTarget[] = [
        ...steam.filter((s) => s.toolsDir !== primary).map((s) => ({ dir: s.toolsDir, link: !s.flatpak })),
        ...heroic.filter((h) => h.toolsDir !== primary).map((h) => ({ dir: h.toolsDir, link: !h.flatpak })),
        // Native Lutris already lists Steam's compatibility tools.
        ...lutris.filter((l) => l.wineDir !== primary && (l.flatpak || steam.every((s) => s.flatpak))).map((l) => ({ dir: l.wineDir, link: !l.flatpak })),
      ];
      const installed = await installProton({ name: build.name, tarball: build.tarball }, primary, extras, { download: this.deps.download }, this.deps.onProtonProgress);
      return { ok: true, name: build.name, installed };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      this.installing = false;
    }
  }
}

function ownedBy(file: string, home: string): LauncherId | null {
  const rel = file.startsWith(home) ? file.slice(home.length) : file;
  if (/steam/i.test(rel)) return "steam";
  if (/heroic/i.test(rel)) return "heroic";
  if (/lutris/i.test(rel)) return "lutris";
  return null;
}
