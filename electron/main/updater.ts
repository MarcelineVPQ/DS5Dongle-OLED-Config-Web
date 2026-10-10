// Self-update for the app, plus verified firmware downloads for the renderer's
// firmware updater. Ported from Neon Debris (auto_battler/scripts/autoload/
// update_manager.gd) with the Electron lessons from Sonata
// (apple-music-for-linux/main.js). ADR-0003.
//
// Flow: check the manifest -> tell the user -> download on request (streamed
// SHA-256, progress) -> install -> "Restart now". Nothing installs without a
// matching checksum, nothing downgrades, and every failure is reported to the
// user verbatim.
import { createHash } from "node:crypto";
import { createWriteStream, readdirSync, renameSync, rmSync, chmodSync, lstatSync, symlinkSync, realpathSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { app, net } from "electron";
import { Manifest, isAllowedDownloadUrl, isNewer, type Download } from "../../src/update/manifest";
import type { UpdateState } from "../../src/desktop/api";

const MANIFEST_URL = "https://raw.githubusercontent.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web/master/latest.json";
const FIRMWARE_MAX_BYTES = 8 * 1024 * 1024;
const STABLE_APPIMAGE = "DS5Dongle-OLED-Edition-Configurator.AppImage";

// Test feed: DS5_UPDATE_MANIFEST=http://127.0.0.1:8765/latest.json points the
// updater at a server on this machine, so a full update cycle can be exercised
// before anything is published. Loopback only, so nothing on the network can
// stand in for GitHub; with it set, downloads must also come from loopback.
function isLoopbackHttp(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

const testFeed = isLoopbackHttp(process.env.DS5_UPDATE_MANIFEST) ? process.env.DS5_UPDATE_MANIFEST! : null;

function manifestUrl(): string {
  return testFeed ?? MANIFEST_URL;
}

function downloadAllowed(url: string): boolean {
  return testFeed ? isLoopbackHttp(url) : isAllowedDownloadUrl(url);
}

type Platform = "linux" | "windows" | "macos";

export class Updater {
  private state: UpdateState = { phase: "idle" };
  private manifest: Manifest | null = null;
  private busy = false;
  private installedPath: string | null = null;

  constructor(private readonly emit: (state: UpdateState) => void) {}

  getState(): UpdateState {
    return this.state;
  }

  getManifest(): Manifest | null {
    return this.manifest;
  }

  // Why this copy can't replace itself, or null if it can.
  private selfInstallBlocker(): string | null {
    if (!app.isPackaged) return "running from source";
    if (process.platform === "linux" && !process.env.APPIMAGE) return "not running as an AppImage";
    if (process.platform === "win32" && !process.env.PORTABLE_EXECUTABLE_FILE) return "not the portable build";
    if (process.platform === "darwin") return "macOS builds update from the release page";
    return null;
  }

  private platformKey(): Platform | null {
    if (process.platform === "linux") return "linux";
    if (process.platform === "win32") return "windows";
    if (process.platform === "darwin") return "macos";
    return null;
  }

  // Leftovers from a previous session's update: partial downloads, the old
  // Windows exe (it was the running process, so it couldn't be deleted then),
  // and older versioned AppImages beside the current one.
  pruneStaleFiles(): void {
    try {
      if (process.platform === "linux" && process.env.APPIMAGE) {
        const current = realpathSync(process.env.APPIMAGE);
        const dir = dirname(current);
        for (const f of readdirSync(dir)) {
          const full = join(dir, f);
          if (f.endsWith(".AppImage.part")) rmSync(full, { force: true });
          const m = /^DS5Dongle-OLED-Edition-Configurator-(\d+\.\d+\.\d+)-linux-x86_64\.AppImage$/.exec(f);
          if (m && full !== current && isNewer(app.getVersion(), m[1])) rmSync(full, { force: true });
        }
      } else if (process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_FILE) {
        const exe = process.env.PORTABLE_EXECUTABLE_FILE;
        rmSync(`${exe}.old`, { force: true });
        rmSync(`${exe}.part`, { force: true });
      }
    } catch {
      // Best effort; nothing depends on it.
    }
  }

  async check(): Promise<UpdateState> {
    if (this.busy) return this.state;
    this.set({ phase: "checking" });
    try {
      const manifest = await this.fetchManifest();
      this.manifest = manifest;
      const remote = manifest.app.version;
      if (!isNewer(remote, app.getVersion())) return this.set({ phase: "up-to-date", version: app.getVersion() });
      const key = this.platformKey();
      const download = key ? manifest.app.platforms[key] : undefined;
      if (!download) return this.set({ phase: "failed", detail: `No ${process.platform} build is published for ${remote}.` });
      const blocker = this.selfInstallBlocker();
      if (blocker) return this.set({ phase: "manual", version: remote, notesUrl: manifest.app.notes_url, detail: blocker });
      return this.set({ phase: "available", version: remote, size: download.size, notesUrl: manifest.app.notes_url });
    } catch (cause) {
      return this.set({ phase: "failed", detail: `Couldn't check for updates: ${message(cause)}` });
    }
  }

  async fetchManifest(): Promise<Manifest> {
    const response = await net.fetch(manifestUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error(`update server returned HTTP ${response.status}`);
    const parsed = Manifest.safeParse(await response.json());
    if (!parsed.success) throw new Error("the update manifest is malformed");
    return parsed.data;
  }

  async downloadAndInstall(): Promise<UpdateState> {
    if (this.busy || this.state.phase !== "available" || !this.manifest) return this.state;
    const key = this.platformKey();
    const download = key ? this.manifest.app.platforms[key] : undefined;
    if (!download) return this.state;
    this.busy = true;
    const version = this.manifest.app.version;
    try {
      const target = this.installTarget(download);
      const part = `${target}.part`;
      await this.downloadTo(download, part, (got, total) => this.set({ phase: "downloading", version, got, total }));
      this.set({ phase: "installing", version });
      this.installedPath = this.install(part, target);
      return this.set({ phase: "ready", version });
    } catch (cause) {
      return this.set({ phase: "failed", detail: `${message(cause)} Your current version is untouched.` });
    } finally {
      this.busy = false;
    }
  }

  // Firmware for the renderer's flasher: downloaded and verified here (the
  // renderer's CSP can't reach the network), returned as bytes.
  async downloadFirmware(): Promise<{ version: string; bytes: Uint8Array }> {
    const manifest = this.manifest ?? (await this.fetchManifest());
    this.manifest = manifest;
    const fw = manifest.firmware;
    if (!fw) throw new Error("No firmware is published in the update manifest.");
    if (fw.uf2.size > FIRMWARE_MAX_BYTES) throw new Error("The published firmware is implausibly large.");
    const bytes = await this.downloadBytes(fw.uf2);
    return { version: fw.version, bytes };
  }

  // Where the new build goes. Linux: a versioned file beside the running
  // AppImage (never overwrite it: it's FUSE-mounted and would SIGBUS). Windows:
  // the portable exe's own path (swapped by rename in install()).
  private installTarget(download: Download): string {
    if (process.platform === "linux") {
      const dir = dirname(realpathSync(process.env.APPIMAGE!));
      const name = basename(new URL(download.url).pathname);
      if (!/^DS5Dongle-OLED-Edition-Configurator-\d+\.\d+\.\d+-linux-x86_64\.AppImage$/.test(name)) throw new Error("Unexpected AppImage file name in the manifest.");
      return join(dir, name);
    }
    return process.env.PORTABLE_EXECUTABLE_FILE!;
  }

  private install(part: string, target: string): string {
    if (process.platform === "linux") {
      chmodSync(part, 0o755);
      renameSync(part, target);
      // Repoint the stable symlink the menu entry and autostart use.
      const stable = join(dirname(target), STABLE_APPIMAGE);
      if (lstatSync(stable, { throwIfNoEntry: false })) rmSync(stable, { force: true });
      symlinkSync(target, stable);
      return stable;
    }
    // Windows: a running exe can be renamed but not overwritten.
    const old = `${target}.old`;
    rmSync(old, { force: true });
    renameSync(target, old);
    try {
      renameSync(part, target);
    } catch (cause) {
      renameSync(old, target); // roll back
      throw cause;
    }
    return target;
  }

  private async downloadTo(download: Download, path: string, progress: (got: number, total: number) => void): Promise<void> {
    if (!downloadAllowed(download.url)) throw new Error("The update points somewhere other than GitHub; refusing.");
    rmSync(path, { force: true });
    const response = await net.fetch(download.url);
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
    const hash = createHash("sha256");
    const file = createWriteStream(path);
    let got = 0;
    let lastReport = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        if (got > download.size) throw new Error("The download is larger than the manifest says.");
        hash.update(value);
        if (!file.write(value)) await new Promise<void>((r) => file.once("drain", () => r()));
        if (Date.now() - lastReport > 150) {
          lastReport = Date.now();
          progress(got, download.size);
        }
      }
      await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (cause) {
      file.destroy();
      rmSync(path, { force: true });
      throw cause;
    }
    progress(got, download.size);
    if (got !== download.size || hash.digest("hex") !== download.sha256) {
      rmSync(path, { force: true });
      throw new Error("The download is corrupt (size or checksum mismatch).");
    }
  }

  private async downloadBytes(download: Download): Promise<Uint8Array> {
    if (!downloadAllowed(download.url)) throw new Error("The firmware points somewhere other than GitHub; refusing.");
    const response = await net.fetch(download.url);
    if (!response.ok) throw new Error(`Firmware download failed (HTTP ${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== download.size || createHash("sha256").update(bytes).digest("hex") !== download.sha256) {
      throw new Error("The firmware download is corrupt (size or checksum mismatch).");
    }
    return bytes;
  }

  // Start the installed version and quit this one.
  restart(): void {
    if (this.state.phase !== "ready" || !this.installedPath) return;
    const target = this.installedPath;
    if (process.platform === "linux") {
      // Relaunch in a clean session environment through the user's systemd
      // (Sonata: inheriting this process's Chromium environment crashed the
      // new instance). Fallback: a detached shell with the same allowlist.
      const vars = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XAUTHORITY", "HOME", "LANG", "PATH"];
      const env: Record<string, string> = {};
      for (const v of vars) if (process.env[v]) env[v] = process.env[v]!;
      let started = false;
      try {
        const setenv = Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`);
        execFileSync("systemd-run", ["--user", "--collect", `--unit=ds5-configurator-relaunch-${Date.now()}`, ...setenv, "--", target], { stdio: "ignore" });
        started = true;
      } catch {
        // systemd-run unavailable
      }
      if (!started) spawn("/bin/sh", ["-c", 'sleep 0.5; exec "$0"', target], { detached: true, stdio: "ignore", env }).unref();
    } else {
      spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    }
    app.releaseSingleInstanceLock();
    app.exit(0);
  }

  private set(state: UpdateState): UpdateState {
    this.state = state;
    this.emit(state);
    return state;
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
