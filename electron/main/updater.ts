// Self-update for the app, plus verified firmware downloads for the renderer's
// firmware updater. Ported from Neon Debris (auto_battler/scripts/autoload/
// update_manager.gd) with the Electron lessons from Sonata
// (apple-music-for-linux/main.js). ADR-0003.
//
// Flow: check the manifest -> tell the user -> download on request (streamed
// SHA-256, progress) -> install -> "Restart now". Nothing installs without a
// matching checksum, nothing downgrades, and every failure is reported to the
// user verbatim.
import { TRUSTED_KEYS, feedSignedBy } from "./feedSignature";
import { errorText, KeyedError, keyedText } from "../../src/errorText";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { app, net } from "electron";
import { Manifest, devNumber, isNewer, sameVersion, type Download } from "../../src/update/manifest";
import { DEV_TOOLS_BUILT } from "./devTools";
import { isAllowedDownloadUrl } from "./urls";
import type { UpdateChannel } from "../../src/desktop/api";
import type { UpdateState } from "../../src/desktop/api";
import { downloadBytes, downloadVerified } from "./download";
import { FIRMWARE_MAX_BYTES } from "./firmwareSource";
import { FeedCache, FeedError, FeedMissingError, feedProblem } from "./updateFeed";
import { pathWithoutAppImageMounts } from "./games/schemeHandler";
import { WINDOWS_SETUP_NAME, installerArgs, isInstalledApp } from "./windowsInstall";
import { linkStableAppImage } from "./integration";

// Published by the release workflow on the firmware repo, where every release
// (app + firmware) lives; see docs/adr/0005-releases-on-the-firmware-repo.md.
const MANIFEST_URL = "https://raw.githubusercontent.com/MarcelineVPQ/DS5Dongle-OLED-Edition/master/latest.json";
// The development channel's feed (opt-in): the newest development build or
// stable release, whichever is newer. Same signing key, same checks.
const DEV_MANIFEST_URL = "https://raw.githubusercontent.com/MarcelineVPQ/DS5Dongle-OLED-Edition/master/latest-dev.json";
// The versioned AppImage an update downloads (its partial download adds ".part").
const OUR_APPIMAGE = /^DS5Dongle-OLED-Edition-Configurator-(\d+\.\d+\.\d+(?:-dev\.\d+)?)-linux-x86_64\.AppImage$/;

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
    // error: NOT-WORTH — not a URL: no test feed
    return false;
  }
}

const testFeed = isLoopbackHttp(process.env.DS5_UPDATE_MANIFEST) ? process.env.DS5_UPDATE_MANIFEST! : null;

// The test feed may be signed with a test key (DS5_UPDATE_PUBKEY, base64
// SPKI); only together with a loopback feed, never for the real one.
function trustedKeys(): readonly string[] {
  const testKey = process.env.DS5_UPDATE_PUBKEY;
  return testFeed && testKey ? [...TRUSTED_KEYS, testKey] : TRUSTED_KEYS;
}

function manifestUrl(channel: UpdateChannel): string {
  if (testFeed) return channel === "dev" ? testFeed.replace(/latest\.json$/, "latest-dev.json") : testFeed;
  return channel === "dev" ? DEV_MANIFEST_URL : MANIFEST_URL;
}

function downloadAllowed(url: string): boolean {
  return testFeed ? isLoopbackHttp(url) : isAllowedDownloadUrl(url);
}

type Platform = "linux" | "windows" | "macos";

// A build with the developer tools (DS5_DEV_TOOLS=1 or X.Y.Z-dev.N) offered a
// release (X.Y.Z): installing it drops the tools. The offer says so and is
// never installed automatically; the user chooses.
export function updateDropsDevTools(devToolsBuilt: boolean, remote: string): boolean {
  return devToolsBuilt && devNumber(remote) === null;
}

// Windows: where the downloaded installer waits (removed at the next start).
const windowsUpdateDir = (): string => join(app.getPath("temp"), "ds5-configurator-update");

// Runs the verified installer silently and independent of this app (it
// outlives the exit that follows).
function runInstaller(installer: string, relaunch: boolean): void {
  // lifetime: OK — detached and unref'd: the installer outlives this app on purpose (app.exit follows)
  // error: NOT-WORTH — the verified installer of the update the user chose; if it can't start, the current version stays and the next check offers the update again
  spawn(installer, installerArgs(relaunch), { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

export class Updater {
  private state: UpdateState = { phase: "idle" };
  // cache: OK — key=none (the feed the app offer on screen came from); invalidated=each update check; bound=1 entry. Only the app update installs from it; firmware downloads use the entry the user was shown (firmwareSource.ts)
  private manifest: Manifest | null = null;
  // The channel `manifest` came from: an offer is installed only on that channel.
  private manifestChannel: UpdateChannel | null = null;
  // Each check's number: only the newest check's answer is used (two checks on
  // different channels could otherwise answer out of order, the last one winning).
  private checkSeq = 0;
  // The feed, shared by the update check and the firmware lookups (one fetch per check).
  readonly feed = new FeedCache((channel) => this.fetchManifest(channel));
  private busy = false;
  // cache: OK — key=none (the installed update); invalidated=replaced by the next install, used once on restart; bound=1 entry
  private installedPath: string | null = null;
  // "Back to stable" was chosen: the stable version stays on offer (even
  // though it's older) until it's installed or the Development channel is
  // picked again, so a routine check can't take the offer back.
  private returningToStable = false;
  // Restart now started the installer (Windows): quitting doesn't run it again.
  private restarting = false;
  // A download started in this run: the start-up tidy-up (Windows, 20 s in)
  // leaves the update folder alone, or it could delete the new installer.
  private downloadStarted = false;

  constructor(
    private readonly emit: (state: UpdateState) => void,
    private readonly channel: () => UpdateChannel = () => "stable",
  ) {}

  getState(): UpdateState {
    return this.state;
  }

  // An update waits that automatic updates may install: never one that would
  // replace this developer build with a regular one (updateDropsDevTools).
  autoInstallable(): boolean {
    return this.state.phase === "available" && !this.state.dropsDevTools && this.manifestChannel === this.channel();
  }

  // Why this copy can't replace itself, or null if it can.
  private selfInstallBlocker(): string | null {
    if (!app.isPackaged) return "running from source";
    if (process.platform === "linux" && !process.env.APPIMAGE) return "not running as an AppImage";
    if (process.platform === "win32" && !isInstalledApp(process.execPath, app.getName(), existsSync)) return "not the installed app";
    if (process.platform === "darwin") return "macOS builds update from the release page";
    return null;
  }

  private platformKey(): Platform | null {
    if (process.platform === "linux") return "linux";
    if (process.platform === "win32") return "windows";
    if (process.platform === "darwin") return "macos";
    return null;
  }

  // Leftovers from a previous session's update: partial downloads, the
  // Windows installer that already ran, and older versioned AppImages beside
  // the current one.
  pruneStaleFiles(): void {
    try {
      if (process.platform === "linux" && process.env.APPIMAGE) {
        const current = realpathSync(process.env.APPIMAGE);
        const dir = dirname(current);
        for (const f of readdirSync(dir)) {
          const full = join(dir, f);
          // Only our own partial download: other programs' *.AppImage.part (a browser's download into ~/Downloads) are theirs.
          if (f.endsWith(".part") && OUR_APPIMAGE.test(f.slice(0, -".part".length))) rmSync(full, { force: true });
          const m = OUR_APPIMAGE.exec(f);
          if (m && full !== current && isNewer(app.getVersion(), m[1])) rmSync(full, { force: true });
        }
      } else if (process.platform === "win32" && !this.downloadStarted) {
        rmSync(windowsUpdateDir(), { recursive: true, force: true });
      }
    } catch {
      // error: NOT-WORTH — Best effort; nothing depends on it.
    }
  }

  // "Back to stable": the stable version, even when it's older than this
  // (development) build. The one path that may go backwards.
  backToStable(): Promise<UpdateState> {
    this.returningToStable = true;
    return this.check();
  }

  async check(): Promise<UpdateState> {
    if (this.channel() === "dev") this.returningToStable = false;
    const allowOlder = this.returningToStable;
    // Once an update is installed, only a restart moves on (a fresh check would
    // see the old running version and offer the same update again).
    if (this.busy || this.state.phase === "ready") return this.state;
    const seq = ++this.checkSeq;
    const channel = this.channel();
    // A newer check started, or the channel changed while this one waited:
    // its answer is dropped (a dev build is never offered on stable).
    const stale = () => seq !== this.checkSeq || channel !== this.channel();
    // The newest check, on a channel that changed since: nothing is on offer until the next check.
    const dropped = () => (seq === this.checkSeq ? this.set({ phase: "idle" }) : this.state);
    this.set({ phase: "checking" });
    try {
      const manifest = await this.feed.get(channel, 0);
      if (stale()) return dropped();
      this.manifest = manifest;
      this.manifestChannel = channel;
      const remote = manifest.app.version;
      const offer = allowOlder ? !sameVersion(remote, app.getVersion()) : isNewer(remote, app.getVersion());
      if (!offer) return this.set({ phase: "up-to-date", version: app.getVersion() });
      const key = this.platformKey();
      const download = key ? manifest.app.platforms[key] : undefined;
      // error: SHOWN — desktop.updateFeed.noBuild (CheckNow, SetupScreen; was "Are you online?" with an English detail)
      if (!download) return this.set({ phase: "failed", detail: keyedText("desktop.updateFeed.noBuild"), problem: "noBuild" });
      const blocker = this.selfInstallBlocker();
      if (blocker) return this.set({ phase: "manual", version: remote, notesUrl: manifest.app.notes_url, detail: blocker });
      const dropsDevTools = updateDropsDevTools(DEV_TOOLS_BUILT, remote) || undefined;
      return this.set({ phase: "available", version: remote, size: download.size, notesUrl: manifest.app.notes_url, dropsDevTools });
    } catch (cause) {
      // error: SHOWN — desktop.setup.checkFailed or desktop.updateFeed.unsigned / .malformed (by problem, after Check for updates; a scheduled check that fails stays quiet: phase failed without "install"); a stale check's failure is dropped (the newest check answers)
      if (stale()) return dropped();
      return this.set({ phase: "failed", detail: `Couldn't check for updates: ${errorText(cause)}`, problem: feedProblem(cause) });
    }
  }

  // Verified download of any manifest asset (the app update, the Proton build).
  // Only GitHub release URLs (or the loopback test feed) are fetched.
  async downloadAsset(download: Download, path: string, progress: (got: number, total: number) => void): Promise<void> {
    if (!downloadAllowed(download.url)) throw new KeyedError("desktop.errors.main.downloadElsewhere");
    await downloadVerified(download, path, progress);
  }

  async fetchManifest(channel: UpdateChannel = this.channel()): Promise<Manifest> {
    const url = manifestUrl(channel);
    // The server answering at all: a failure here is a network one (offline, unreachable, a timeout).
    // error: PASSES-ON — status/ok are read right below (404 = FeedMissingError, else FeedError "offline"; a bad .sig = "unsigned")
    const reach = async (u: string): Promise<{ status: number; ok: boolean; text: string }> => {
      try {
        const r = await net.fetch(u, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : "" };
      } catch (cause) {
        // error: PASSES-ON — thrown as FeedError "offline" to check()'s / the lookups' catch
        throw new FeedError("offline", `the update server can't be reached (${errorText(cause)})`);
      }
    };
    const response = await reach(url);
    if (response.status === 404) throw new FeedMissingError();
    if (!response.ok) throw new FeedError("offline", `update server returned HTTP ${response.status}`);
    const text = response.text;
    // Nothing in the feed is used before its signature checks out.
    const sig = await reach(`${url}.sig`);
    if (!sig.ok || !feedSignedBy(text, sig.text, trustedKeys())) throw new FeedError("unsigned", "the update feed isn't signed by the developer; ignoring it");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new FeedError("malformed", "the update manifest is malformed");
    }
    // error: PASSES-ON — a malformed manifest throws FeedError "malformed" to check()'s catch
    const parsed = Manifest.safeParse(json);
    if (!parsed.success) throw new FeedError("malformed", "the update manifest is malformed");
    return parsed.data;
  }

  async downloadAndInstall(): Promise<UpdateState> {
    if (this.busy || this.state.phase !== "available" || !this.manifest) return this.state;
    // The offer came from another channel than the one now chosen: look again on this one (the user pressed Install, so going online is asked).
    if (this.manifestChannel !== this.channel()) return this.check();
    const key = this.platformKey();
    const download = key ? this.manifest.app.platforms[key] : undefined;
    if (!download) return this.state;
    this.busy = true;
    this.downloadStarted = true;
    const version = this.manifest.app.version;
    try {
      const target = this.installTarget(download);
      const part = `${target}.part`;
      await this.downloadAsset(download, part, (got, total) => this.set({ phase: "downloading", version, got, total }));
      this.set({ phase: "installing", version });
      this.installedPath = this.install(part, target);
      this.returningToStable = false;
      return this.set({ phase: "ready", version });
    } catch (cause) {
      // error: SHOWN — desktop.update.appFailed (was SILENT-BUG: the banner just disappeared when Download and install failed)
      return this.set({ phase: "failed", detail: `${errorText(cause)} ${keyedText("desktop.update.untouched")}`, during: "install" });
    } finally {
      this.busy = false;
    }
  }

  // A published firmware file for the renderer's flasher: downloaded and
  // verified (size + SHA-256 of `uf2`) here, since the renderer's CSP can't
  // reach the network. Which entry to download is firmwareSource.ts's call.
  async downloadFirmwareFile(uf2: Download): Promise<Uint8Array> {
    if (uf2.size > FIRMWARE_MAX_BYTES) throw new KeyedError("desktop.errors.main.downloadTooLarge");
    if (!downloadAllowed(uf2.url)) throw new KeyedError("desktop.errors.main.downloadElsewhere");
    return downloadBytes(uf2);
  }

  // Where the new build goes. Linux: a versioned file beside the running
  // AppImage (never overwrite it: it's FUSE-mounted and would SIGBUS). Windows:
  // the installer, in a folder of its own under Temp (run on restart or quit).
  private installTarget(download: Download): string {
    if (process.platform === "linux") {
      const dir = dirname(realpathSync(process.env.APPIMAGE!));
      const name = basename(new URL(download.url).pathname);
      if (!/^DS5Dongle-OLED-Edition-Configurator-\d+\.\d+\.\d+(?:-dev\.\d+)?-linux-x86_64\.AppImage$/.test(name)) throw new KeyedError("desktop.errors.main.unexpectedFile", { name });
      return join(dir, name);
    }
    const name = basename(new URL(download.url).pathname);
    if (!WINDOWS_SETUP_NAME.test(name)) throw new KeyedError("desktop.errors.main.unexpectedFile", { name });
    const dir = windowsUpdateDir();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return join(dir, name);
  }

  private install(part: string, target: string): string {
    if (process.platform === "linux") {
      chmodSync(part, 0o755);
      renameSync(part, target);
      // Repoint the stable symlink the menu entry and autostart use.
      return linkStableAppImage(target);
    }
    // Windows: the verified installer waits; restart() or quitting runs it.
    renameSync(part, target);
    return target;
  }

  // Windows, quitting with an update downloaded and verified ("Restart now"
  // not pressed): the installer runs silently as the app exits, so the next
  // start is the new version (as on Linux). Called once, from will-quit.
  installOnQuit(): void {
    if (process.platform !== "win32" || this.state.phase !== "ready" || !this.installedPath || this.restarting || !existsSync(this.installedPath)) return;
    runInstaller(this.installedPath, false);
  }

  // Start the installed version and quit this one.
  restart(): void {
    if (this.state.phase !== "ready" || !this.installedPath) return;
    const target = this.installedPath;
    // The downloaded installer (or AppImage) is gone (deleted from Temp): say
    // so and keep running, instead of quitting into nothing.
    if (!existsSync(target)) {
      this.installedPath = null;
      // error: SHOWN — desktop.update.appFailed with desktop.errors.main.updateMissing (the banner; Check for updates downloads it again)
      this.set({ phase: "failed", detail: `${keyedText("desktop.errors.main.updateMissing")} ${keyedText("desktop.update.untouched")}`, during: "install" });
      return;
    }
    // Before the new instance starts, or it could find the lock still held
    // and quit, leaving no app running.
    app.releaseSingleInstanceLock();
    if (process.platform === "linux") {
      // Relaunch in a clean session environment through the user's systemd
      // (Sonata: inheriting this process's Chromium environment crashed the
      // new instance). Fallback: a detached shell with the same allowlist.
      const vars = ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XAUTHORITY", "HOME", "LANG", "PATH"];
      const env: Record<string, string> = {};
      for (const v of vars) if (process.env[v]) env[v] = process.env[v]!;
      // This copy's AppImage mount dies when it exits: the new copy adds its own.
      if (env.PATH) env.PATH = pathWithoutAppImageMounts(env.PATH)!;
      // The unit lasts until its last process is gone (ExitType=cgroup, as
      // KDE's launcher sets it; systemd < 250 refuses it: KillMode=process),
      // never killing the new copy's AppImage runtime and zygote together
      // the moment its main process quits (a SIGBUS and a stale mount).
      let started = false;
      const setenv = Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`);
      // loop: SERIAL-REQUIRED — retry/backoff: the second form only when systemd refused the first (2 tries)
      for (const lifetime of ["--property=ExitType=cgroup", "--property=KillMode=process"]) {
        try {
          execFileSync("systemd-run", ["--user", "--collect", `--unit=ds5-configurator-relaunch-${Date.now()}`, lifetime, ...setenv, "--", target], { stdio: "ignore" });
          started = true;
          break;
        } catch {
          // error: NOT-WORTH — systemd-run unavailable or too old for the property: the next form, then the shell below
        }
      }
      // lifetime: OK — detached and unref'd: the relaunch outlives this app on purpose (app.quit next)
      // error: NOT-WORTH — relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again)
      if (!started) spawn("/bin/sh", ["-c", 'sleep 0.5; exec "$0"', target], { detached: true, stdio: "ignore", env }).unref();
      // A normal quit, not app.exit: will-quit stops the app's own children
      // (the headset watcher's pactl) and holds the AppImage mount until
      // Chromium's processes are gone. app.exit skipped both: the old copy's
      // pactl kept its AppImage runtime serving the mount for hours.
      app.quit();
      // lifetime: OK — fires once; the process is gone before it unless the quit was held up
      setTimeout(() => app.exit(0), 10_000);
      return;
    } else if (process.platform === "win32") {
      // The installer closes this copy if it is still running, installs over
      // it and starts the new version (--force-run).
      this.restarting = true;
      runInstaller(target, true);
    } else {
      // lifetime: OK — detached relaunch, app.exit next
      // error: NOT-WORTH — relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again)
      spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    }
    app.exit(0);
  }

  private set(state: UpdateState): UpdateState {
    this.state = state;
    this.emit(state);
    return state;
  }
}
