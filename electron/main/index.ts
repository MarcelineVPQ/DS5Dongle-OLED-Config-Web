import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, net, protocol, shell, session, type WebContents } from "electron";
import { IPC, type DesktopSettings, type MainErrorKey, type MainNoticeKey } from "../../src/desktop/api";
import { errorText, KeyedError, keyedText, logged } from "../../src/errorText";
import { mainText } from "./mainText";
import { APP_ID, HIDDEN_FLAG, applyAutostart } from "./autostart";
import { isAllowedUsbDevice } from "./devices";
import { allowPermissionCheck, allowPermissionRequest } from "./permissions";
import { createDesktopShortcut, integrateDesktop } from "./integration";
import { registerIpc } from "./ipc";
import { GamesService, moveOldSteamKeys } from "./games/service";
import { DEV_TOOLS_BUILT } from "./devTools";
import { FakeGamesService } from "./games/fake/service";
import { dominantColor } from "./games/artColor";
import { LibraryStore } from "./games/libraryStore";
import { isNotDetected } from "../../src/desktop/games/report";
import { RunningGameWatcher, runningInterval } from "./games/running";
import { VolumeKeeper } from "./games/volumeKeeper";
import { HeadsetProfile } from "./games/headsetProfile";
import { artRequestTarget } from "./games/artRequest";
import { ArtThumbs } from "./games/artThumbs";
import { hasSchemeHandler, openForUser, pathWithoutAppImageMounts, startForUser } from "./games/schemeHandler";
import { firmwareBytes, firmwareFeed, installFeed, latestFirmware, readBundled, type FirmwareSourceDeps } from "./firmwareSource";
import { devChannelPreview, protonFeed } from "./updateFeed";
import { OfficialFirmwareSource } from "./officialFirmware";
import { installUsbRule, usbRuleInstalled } from "./linuxSetup";
import { repairWindowsUsb } from "./windowsSetup";
import { loadSettings, settingsPath, saveSettings } from "./settings";
import { recoveredHere } from "../../src/persisted";
import { readDesktopPalette, watchDesktopPalette } from "./desktopTheme";
import { AppTray } from "./tray";
import { Updater } from "./updater";
import { FirmwareHold } from "./firmwareHold";
import { pruneUnpackLeftovers } from "./portableTemp";
import { firstInstalledStart, isInstalledApp } from "./windowsInstall";
import { isAllowedExternalUrl } from "./urls";
import { copyOledImage, saveOledImage } from "./oledShare";
import { writeFileAtomic } from "./games/backup";
import { boardHolders } from "./boardHolders";
import { holdAppImageMountUntilExit } from "./appImageQuit";

const here = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
// Icons and other runtime files: <repo>/resources in development, the
// packaged app's resources/ folder (electron-builder extraResources) otherwise.
const resourcesDir = app.isPackaged ? join(process.resourcesPath, "resources") : join(app.getAppPath(), "resources");
let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let updater: Updater;
// Restart, quit and the app update's install wait while firmware is written.
let hold: FirmwareHold;
// Scaled game art copies (ds5-art://…?w=), deleted with Games consent.
let artThumbs: ArtThumbs | null = null;
const UPDATE_FIRST_CHECK_MS = 20_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// cache: OK — key=none (settings.json); invalidated=write-through: updateSetting saves the file; bound=1 entry
let settings: DesktopSettings;
// Set when the user really quits (tray Quit, OS logout), so close-to-tray
// doesn't swallow it.
let quitting = false;
// Windows is ending the session: no update install at quit (see will-quit).
let sessionEnding = false;
// This start installed the app over the portable exe: the page says so once.
let movedFromPortable = false;
// Starts/stops the running-game watcher with the Games consent (set in start()).
let syncRunningWatcher: () => void = () => undefined;
// Tells the running-game watcher that something may need its answer sooner (set in start()).
let retimeRunningWatcher: () => void = () => undefined;
// Linux: keeps the controller's volume at full while the app runs, once the
// player applied that Games fix (the controllerVolumeFull setting).
let syncVolumeKeeper: () => void = () => undefined;
// Linux: the controller's sound profile follows its headset jack while the
// headsetStereo setting is on (set in start()).
// lifetime: NOT-WORTH — one per app; its pactl watcher runs only while the setting is on (stop() when it's turned off)
let headsetProfile: HeadsetProfile | null = null;
let syncHeadsetProfile: () => void = () => undefined;

applyLinuxWorkarounds();

// GPU rendering is on by default (blur, glass and the live view's glows need
// it; software rendering cost ~140% CPU on the controller page). It once
// crash-looped on NVIDIA (ADR-0004); Electron 43 runs it sandboxed on native
// Wayland. App settings can turn it off, and a GPU crash turns it off for the
// next start (recordGpuCrash). Must be decided before the app is ready.
if (!loadSettings().hardwareAcceleration) app.disableHardwareAcceleration();
// HDR lighting: render in scRGB (linear, 1.0 = 80 nits). KWin 6.6's color
// manager has no "srgb" transfer function, which Chromium's default path asks
// for; scRGB (ext_linear + windows_scrgb) is the one that reaches the display.
else if (loadSettings().hdrLighting) app.commandLine.appendSwitch("force-color-profile", "scrgb-linear");

// Game artwork for the Games library (games/artRequest.ts). Must be
// registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: "ds5-art", privileges: { standard: true, secure: true } }]);

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    // error: NOT-WORTH — a missing folder is "no folder": the game action returns false and the page shows desktop.library.action.failed
    return false;
  }
};

// A copy started by an older version's in-app update inherited that copy's
// AppImage mount in PATH, dead now: drop every mount but our own, or programs
// run by name (kscreen-doctor, pactl) aren't found.
if (process.env.PATH) process.env.PATH = pathWithoutAppImageMounts(process.env.PATH, process.env.APPDIR);

// One instance: two copies would fight over the USB interface claim.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching it again just brings the running copy forward.
  app.on("second-instance", showWindow); // lifetime: NOT-WORTH — one per app, lives until quit
  // The app couldn't set itself up: without a window, a dialog says so.
  app
    .whenReady()
    .then(start)
    // error: SHOWN — desktop.errors.main.startFailed in a dialog, in the system's language (mainText); no window exists to show it in
    .catch(async (cause: unknown) => {
      // error: LOGGED-OK — the locale file couldn't be loaded: the dialog still says it, in English
      const text = await mainText(keyedText("desktop.errors.main.startFailed", { detail: errorText(cause) }), app.getLocale()).catch((why: unknown) => {
        logged("translating the start-failure dialog (shown in English)")(why);
        return `The app couldn't start: ${errorText(cause)}`;
      });
      dialog.showErrorBox("DS5 Dongle Configurator", text);
      app.quit();
    });
}

// A crashed GPU process means hardware rendering isn't safe on this PC:
// Chromium falls back to software for the rest of this run, and the setting
// goes off so the next start doesn't try again (the user can turn it back on).
function recordGpuCrash(): void {
  // lifetime: NOT-WORTH — registered once in start(), lives until quit
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU" || details.reason === "clean-exit" || details.reason === "killed") return;
    if (!settings?.hardwareAcceleration) return;
    console.warn(`[gpu] GPU process gone (${details.reason}); software rendering from the next start`);
    try {
      updateSetting("hardwareAcceleration", false);
    } catch (cause) {
      // error: LOGGED-OK — not a user action: this run already falls back to software rendering; the next crash tries again
      logged("turning hardware acceleration off after a GPU crash")(cause);
    }
  });
}

function start(): void {
  recordGpuCrash();
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  settings = loadSettings();
  integrateDesktop(resourcesDir);
  updater = new Updater(
    (state) => {
      mainWindow?.webContents.send(IPC.updateState, state);
      tray?.updateUpdateState(state);
    },
    () => settings.updateChannel,
  );
  updater.pruneStaleFiles();
  if (process.platform === "win32") {
    // The portable exe this installed app replaced left unpacked copies in Temp.
    // Electron's own fs, without .asar support: an app.asar is a file to delete here.
    const originalFs = createRequire(import.meta.url)("original-fs") as typeof import("node:fs");
    const remove = (dir: string) => originalFs.promises.rm(dir, { recursive: true, force: true });
    // lifetime: OK — fires once
    // Also the update installer that started this version (it was still running at start).
    setTimeout(() => {
      updater.pruneStaleFiles();
      void pruneUnpackLeftovers(app.getPath("temp"), process.execPath, Date.now(), remove).catch(logged("tidying the portable exe's leftovers in Temp (best effort, retried next start)"));
    }, 20_000);
    // The first start of the installed app over a portable exe's settings: say so once.
    if (app.isPackaged && isInstalledApp(process.execPath, app.getName(), existsSync)) {
      try {
        const marker = join(app.getPath("userData"), "installed-app");
        movedFromPortable = firstInstalledStart(settingsPath(), marker, existsSync, (path) => writeFileSync(path, `${app.getVersion()}\n`)) === "moved";
      } catch (cause) {
        // error: LOGGED-OK — only the one-time "now installed" notice depends on it
        logged("the first start of the installed app")(cause);
      }
    }
  }
  hold = new FirmwareHold((state) => mainWindow?.webContents.send(IPC.firmwareHold, state));
  const scheduledCheck = () => {
    if (settings.checkForUpdates) checkForUpdates().catch(logged("scheduled update check (not started by the user; a failed check shows as the 'failed' banner state)"));
  };
  // lifetime: OK — fires once, the first update check
  setTimeout(scheduledCheck, UPDATE_FIRST_CHECK_MS);
  // lifetime: NOT-WORTH — one per app, a background update check meant to run in the tray too
  setInterval(scheduledCheck, UPDATE_INTERVAL_MS);
  try {
    applyAutostart(settings.launchAtLogin, settings.startMinimized);
  } catch (cause) {
    // error: LOGGED-OK — the start-up re-apply of an unchanged setting; changing it in App settings or the tray shows desktop.errors.settingNotSaved
    logged("re-applying launch at login at start")(cause);
  }
  lockDownSession();

  tray = new AppTray(
    resourcesDir,
    {
      toggleWindow,
      command: (command) => {
        if (command.type === "openPage") showWindow();
        mainWindow?.webContents.send(IPC.trayCommand, command);
      },
      setSetting: (key, value) => {
        try {
          updateSetting(key, value);
        } catch {
          // error: SHOWN — desktop.errors.settingNotSaved (the tray's checkbox goes back; updateSetting logged the cause)
          showWindow();
          showMainError("desktop.errors.settingNotSaved");
        }
      },
      createDesktopShortcut: process.platform === "win32" ? () => void createDesktopShortcut() : undefined,
      checkForUpdates: () => {
        showWindow();
        updater.check().catch(logged("updater.check() doesn't reject: a failed check is the 'failed' banner in the window just shown"));
      },
      restartToUpdate,
      // before-quit marks it quitting, or holds it while firmware is written.
      quit: () => app.quit(),
    },
    settings,
  );

  // lifetime: NOT-WORTH — one per app; its card watcher runs only while the setting is on (stop() when it's turned off)
  const volumeKeeper = process.platform === "linux" ? new VolumeKeeper(() => showMainNotice("desktop.notices.volumeRestored")) : null;
  syncVolumeKeeper = () => {
    if (settings.controllerVolumeFull) volumeKeeper?.start();
    else volumeKeeper?.stop();
  };
  syncVolumeKeeper();

  // The first switch to stereo is explained on the page (with Undo); later ones are quiet.
  headsetProfile =
    process.platform === "linux"
      ? new HeadsetProfile((done) => {
          if (!done.plugged || settings.headsetStereoExplained || !mainWindow) return;
          mainWindow.webContents.send(IPC.headsetSwitched);
          try {
            updateSetting("headsetStereoExplained", true);
          } catch {
            // error: LOGGED-OK — updateSetting logged the cause; the explanation only shows again on the next switch
          }
        })
      : null;
  syncHeadsetProfile = () => {
    if (settings.headsetStereo) headsetProfile?.start();
    else headsetProfile?.stop();
  };
  syncHeadsetProfile();

  // The update feed for the firmware lookups and the Games scan's Proton
  // lookup: online only with automatic checks on or when the user asks.
  const feedLookup = firmwareFeed(
    updater.feed,
    () => settings.checkForUpdates,
    () => settings.updateChannel,
  );

  // Games library: the player's per-game data (works on every OS).
  const library = new LibraryStore(app.getPath("userData"));
  // Windows: a profile or rating saved on the second copy of a Steam game
  // (bug hunt B1) moves to the one copy shown now; the page reads the library after.
  const libraryReady: Promise<unknown> =
    process.platform === "win32" && settings.gamesScanAllowed
      ? // error: LOGGED-OK — the entries stay where they were (as before this fix) and are moved at the next start
        moveOldSteamKeys(library).catch(logged("moving library entries from an older Steam folder spelling"))
      : Promise.resolve();
  // Games page (Linux and Windows): the library, per-game profiles and, on
  // Linux, launcher / Proton setup for native DualSense features.
  const games =
    process.platform === "linux" || process.platform === "win32"
      ? new GamesService({
          userData: app.getPath("userData"),
          allowed: () => settings.gamesScanAllowed,
          // A scan's Proton lookup follows the automatic-checks switch (off: never online); Install fetches.
          fetchManifest: protonFeed(updater.feed, feedLookup),
          download: (d, path, progress) => updater.downloadAsset(d, path, progress),
          onProtonProgress: (p) => mainWindow?.webContents.send(IPC.protonProgress, p),
          // Games the player marked "controller not detected" get the standard-gamepad fix.
          // Windows: no launcher is closed while the library sees a game running.
          gameRunning: (): boolean => watcher?.running != null,
          notDetected: () => new Set(Object.entries(library.get().games).flatMap(([key, r]) => (isNotDetected(r.mine) ? [key] : []))),
          // Games the player marked "Supports HDR" get the Turn on HDR fix (with an HDR screen).
          hdrMarked: () => new Set(Object.entries(library.get().games).flatMap(([key, r]) => (r.mine?.hdr ? [key] : []))),
          // The volume fix applied (on) or undone (off): remembered, and the card watcher follows.
          volumeKept: () => settings.controllerVolumeFull,
          keepVolume: (on) => {
            if (settings.controllerVolumeFull === on) return;
            try {
              updateSetting("controllerVolumeFull", on);
            } catch {
              // error: SHOWN — desktop.errors.settingNotSaved (the levels are set; only keeping them after a reconnect isn't remembered; updateSetting logged the cause)
              showMainError("desktop.errors.settingNotSaved");
            }
          },
        })
      : null;
  const withGames = <T>(run: (g: GamesService) => T): T => {
    if (!games) throw new KeyedError("desktop.errors.main.gamesUnavailable");
    return run(games);
  };

  // Developer card → Fake games (dev builds only: DEV_TOOLS_BUILT is the
  // constant false in a release, so all of this is left out of it). While on,
  // Games answers from a made-up library (games/fake/) that never touches the
  // launchers, their files or the player's own library.
  // cache: OK — key=none (the fake library service); invalidated=dropped when Fake games is turned off (a fresh one next time); bound=1 instance
  let fake: FakeGamesService | null = null;
  const fakeGames = (): FakeGamesService | null => {
    if (!DEV_TOOLS_BUILT || !settings.devFakeGames) return null;
    return (fake ??= new FakeGamesService({
      dir: join(app.getPath("userData"), "dev-fake-games"),
      platform: process.platform,
      encode: (b, png) => {
        const img = nativeImage.createFromBitmap(Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength), { width: b.width, height: b.height });
        return png ? img.toPNG() : img.toJPEG(90);
      },
      colorOf: dominantColor,
      onRunning: (key) => mainWindow?.webContents.send(IPC.runningGame, key),
      onProtonProgress: (p) => mainWindow?.webContents.send(IPC.protonProgress, p),
      layouts: () => library.get().layouts,
    }));
  };
  const lib = (): LibraryStore => fakeGames()?.library() ?? library;

  // The running game (polled only while Games is allowed).
  // Linux: every 2 s while a game has a profile or the window is on screen,
  // every 10 s in the tray otherwise (runningInterval); Windows: every 3 s.
  const windowShown = () => !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
  const watcher = games
    ? new RunningGameWatcher(
        () => games.runningCandidates(),
        (key) => mainWindow?.webContents.send(IPC.runningGame, key),
        undefined,
        undefined,
        process.platform === "linux" ? () => runningInterval(library.hasProfiles() || windowShown()) : undefined,
      )
    : null;
  retimeRunningWatcher = () => watcher?.retime();
  syncRunningWatcher = () => {
    if (!games || !watcher) return;
    // Fake games: no real game is looked for (the fake library says which one runs).
    if (fakeGames()) watcher.stop();
    else if (settings.gamesScanAllowed)
      void games.scan().then(
        // Consent may have been turned off while the scan ran.
        () => settings.gamesScanAllowed && watcher.start(),
        logged("background scan for the running-game watcher (the Games page scans again and shows its own errors)"),
      );
    else watcher.stop();
  };
  syncRunningWatcher();
  // Art asked for at a width (?w=) is served from scaled-down copies kept in
  // userData/art-cache (artThumbs.ts); only ever derived from a scanned file.
  const thumbs = new ArtThumbs(join(app.getPath("userData"), "art-cache"));
  artThumbs = thumbs;
  // Consent was turned off while a delete failed, or before this version: none kept without it.
  if (!settings.gamesScanAllowed) thumbs.forget();
  // lifetime: NOT-WORTH — one scheme handler per app, lives until quit
  protocol.handle("ds5-art", async (request) => {
    const target = artRequestTarget(request.url);
    const fakeArt = fakeGames();
    const source = !target ? undefined : fakeArt ? await fakeArt.artFile(target.key, target.kind) : games?.artPath(target.key, target.kind);
    const file = source && target?.width ? await thumbs.path(source, target.kind, target.width) : source;
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });

  // Sony's controller firmware versions: with automatic checks on, or when asked.
  const officialFirmware = new OfficialFirmwareSource(
    (url, init) => net.fetch(url, init),
    () => settings.checkForUpdates,
  );
  // Firmware the app offers: bundled with this release, or a newer published
  // one. The feed is looked up only with automatic checks on or when the user
  // asks; Install downloads exactly the entry shown.
  const firmwareSource: FirmwareSourceDeps = {
    bundled: () => readBundled(resourcesDir),
    manifest: feedLookup,
    freshFeed: installFeed(updater.feed),
    download: (uf2) => updater.downloadFirmwareFile(uf2),
  };

  registerIpc({
    isTrusted,
    gamesScan: () => fakeGames()?.scan() ?? withGames((g) => g.scan()),
    gamesApply: (r) => fakeGames()?.apply(r.fixIds, r.restart) ?? withGames((g) => g.apply(r.fixIds, r.restart)),
    gamesUndo: (r) => fakeGames()?.undo(r.backupId, r.restart) ?? withGames((g) => g.undo(r.backupId, r.restart)),
    gamesBackups: () => fakeGames()?.listBackups() ?? withGames((g) => g.listBackups()),
    gamesRunningLaunchers: () => fakeGames()?.runningLaunchers() ?? withGames((g) => g.runningLaunchers()),
    // Share your OLED: the system save dialog picks the path (modal on the asking window).
    saveOledImage: (image, sender) =>
      saveOledImage(
        {
          ask: async (options) => {
            const win = BrowserWindow.fromWebContents(sender);
            const r = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
            return r.canceled || !r.filePath ? null : r.filePath;
          },
          write: writeFileAtomic,
          pictures: () => {
            try {
              return app.getPath("pictures");
            } catch {
              // error: NOT-WORTH — no Pictures folder on this system: the dialog starts in the home folder
              return app.getPath("home");
            }
          },
        },
        image,
      ),
    copyOledImage: (png) =>
      copyOledImage(
        {
          decodes: (buf) => !nativeImage.createFromBuffer(buf).isEmpty(),
          write: (buf) => clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(buf)], { type: "image/png" }) })]),
        },
        png,
      ),
    installProton: () =>
      fakeGames()?.installLatestProton() ?? withGames((g) => (process.platform === "linux" ? g.installLatestProton() : Promise.reject(new KeyedError("desktop.errors.main.protonLinuxOnly")))),
    gamesDetails: () => fakeGames()?.details() ?? withGames((g) => g.details()),
    gamesRunning: () => {
      const f = fakeGames();
      return f ? f.running : (watcher?.running ?? null);
    },
    libraryGet: async () => {
      await libraryReady;
      return lib().get();
    },
    librarySetProfile: (u) => {
      const file = lib().setProfile(u.gameKey, u.title, u.settings);
      retimeRunningWatcher(); // a first profile: the watcher looks every 2 s again
      return file;
    },
    libraryDeleteProfile: (key) => lib().deleteProfile(key),
    librarySetMine: (u) => lib().setMine(u.gameKey, u.title, u.mine),
    librarySetRestore: (r) => lib().setRestore(r ?? undefined),
    librarySetLayout: (u) => lib().setLayout(u.id, u.name, u.table, u.extra),
    libraryDeleteLayout: (id) => lib().deleteLayout(id),
    gameArtColor: (key) => fakeGames()?.artColor(key) ?? withGames((g) => g.artColor(key)),
    // Dev builds only: the Developer card's Fake games switch, running game and HDR setup.
    devFakeGames: DEV_TOOLS_BUILT
      ? (c) => {
          if (c.on !== undefined && c.on !== settings.devFakeGames) {
            if (!c.on) fake?.stop();
            fake = null;
            updateSetting("devFakeGames", c.on);
            // The page reloads after the switch; the watcher follows (stopped while on).
            syncRunningWatcher();
          }
          const f = fakeGames();
          if (f && c.running !== undefined) f.setRunning(c.running);
          if (f && c.hdr) f.setHdr(c.hdr);
          return Promise.resolve({ on: !!f, status: f?.status() ?? null });
        }
      : undefined,
    gameAction: async (u) => {
      // Fake games: ▶ Play "runs" the game; nothing is opened or started.
      const f = fakeGames();
      if (f) return f.gameAction(u.gameKey, u.action);
      const target = withGames((g) => g.gameAction(u.gameKey, u.action));
      if (target.url) {
        // Launchers often exit non-zero after handing the link to their
        // running instance (Steam does), so the open result means nothing:
        // success = a handler is registered for the scheme.
        if (!(await hasSchemeHandler(target.url, (u) => app.getApplicationNameForProtocol(u)))) return false;
        // ▶ Play with the launcher closed: it starts in the background with
        // the game (Steam -silent, Heroic --no-gui; actions.ts), in its own
        // unit like everything we start; if that can't start, the link.
        // error: NOT-WORTH — no quiet start for this game: the launcher link below starts it instead
        const quiet = u.action === "play" ? await withGames((g) => g.quietPlay(u.gameKey)).catch(() => null) : null;
        if (quiet && (await startForUser(quiet.cmd, quiet.args))) return true;
        // Linux: xdg-open with the real home, so a launcher that wasn't
        // running doesn't start inside the dev copy's test HOME, in its own
        // unit, so it outlives the app (schemeHandler.ts).
        if (process.platform === "linux") return openForUser(target.url);
        // error: SHOWN — desktop.library.action.failed (was SILENT-BUG: a failed open still answered true)
        return shell.openExternal(target.url).then(
          () => true,
          () => false,
        );
      }
      // Only a folder: launcher configs could name a file, which openPath would run.
      if (target.folder && isDirectory(target.folder)) {
        if (process.platform === "linux") return openForUser(target.folder);
        return (await shell.openPath(target.folder)) === "";
      }
      return false;
    },
    onStatus: (status) => tray?.update(status),
    onTrayIcon: (png) => tray?.setCustomIcon(png),
    getSettings: () => settings,
    recoveredFiles: () => recoveredHere(),
    headsetUndo: () => headsetProfile?.undo() ?? Promise.resolve(false),
    headsetHint: (headphones) => headsetProfile?.setHint(headphones),
    setSetting: updateSetting,
    usbAccessInstalled: () => usbRuleInstalled(resourcesDir),
    boardHolders: () => boardHolders(),
    setupUsbAccess: () => installUsbRule(resourcesDir),
    repairWindowsUsb,
    appVersion: () => app.getVersion(),
    checkForUpdates: () => updater.check(),
    getUpdateState: () => updater.getState(),
    // The banner's button is disabled while firmware is written; this backs it up.
    installUpdate: () => (hold.active ? Promise.resolve(updater.getState()) : updater.downloadAndInstall()),
    // The channel first (without the routine re-check, which would race this
    // one), then the stable version on offer even though it's older.
    devChannelPreview: (asked) => devChannelPreview(updater.feed, settings.checkForUpdates, asked),
    backToStable: () => {
      updateSetting("updateChannel", "stable", false);
      return updater.backToStable();
    },
    restartToUpdate,
    latestFirmware: (asked) => latestFirmware(firmwareSource, asked),
    officialControllerFirmware: (asked) => officialFirmware.lookup(asked),
    downloadFirmware: (shown) => firmwareBytes(firmwareSource, shown),
    setFirmwareWriting: (writing) => hold.setWriting(writing),
    getFirmwareHold: () => hold.state(),
    getDesktopPalette: () => readDesktopPalette(),
  });

  createWindow(!(settings.startMinimized || process.argv.includes(HIDDEN_FLAG)));
  // Stopped at quit (lifetime pass batch 4: the stop was dropped).
  const stopPalette = watchDesktopPalette(
    () =>
      void readDesktopPalette()
        .then((palette) => mainWindow?.webContents.send(IPC.desktopPalette, palette))
        .catch(logged("following the desktop's accent color (the theme keeps its last colors)")),
  );
  app.on("activate", showWindow); // lifetime: NOT-WORTH — one per app, lives until quit
  // Quitting (tray Quit, Ctrl+Q, logout) mid-write would leave the board
  // half-written: show the window, which says it closes when the write ends.
  // lifetime: NOT-WORTH — one per app, lives until quit
  app.on("before-quit", (event) => {
    if (hold.allowQuit(event, () => app.quit())) quitting = true;
    else showWindow();
  });
  // Windows: an update that is downloaded and verified but wasn't restarted
  // into installs as the app quits (not when Windows is signing out or
  // shutting down: an installer cut short would leave a broken app).
  // lifetime: NOT-WORTH — one per app, fires at quit
  app.on("will-quit", () => {
    stopPalette();
    headsetProfile?.stop(); // its pactl child ends with the app
    if (!sessionEnding) updater.installOnQuit();
    // Linux AppImage: the mount stays until Chromium's processes are gone (no SIGBUS on the way out).
    holdAppImageMountUntilExit();
  });
  // lifetime: NOT-WORTH — one per app, lives until quit
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

function restartToUpdate(): void {
  hold.whenDone("restart", () => updater.restart());
}

// A scheduled check; with automatic updates on, a newer version is downloaded,
// verified and installed in the background (the same path as the banner's
// button), and starts the next time the app opens.
async function checkForUpdates(): Promise<void> {
  await updater.check();
  if (updater.autoInstallable() && settings.autoInstallUpdates) hold.whenDone("install", installInBackground);
}

// downloadAndInstall() doesn't reject: a failure is the "failed" banner state.
const installInBackground = () => void updater.downloadAndInstall().catch(logged("automatic update install (a failure shows as the 'failed' banner)"));

// A user action outside the page failed (a tray toggle, a link): the page's notice says so.
function showMainError(key: MainErrorKey): void {
  mainWindow?.webContents.send(IPC.showError, key);
}

// Something the app did on its own (in the background): the page's notice says so.
function showMainNotice(key: MainNoticeKey): void {
  mainWindow?.webContents.send(IPC.showNotice, key);
}

// Throws when the setting can't be saved (or launch at login can't be
// changed): it is put back first, and the caller shows
// desktop.errors.settingNotSaved (the page through setSetting's rejection,
// the tray through showMainError).
function updateSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K], recheck = true): DesktopSettings {
  const before = settings;
  settings = { ...settings, [key]: value };
  try {
    saveSettings(settings);
    if (key === "launchAtLogin" || key === "startMinimized") applyAutostart(settings.launchAtLogin, settings.startMinimized);
  } catch (cause) {
    logged(`saving the setting ${key}`)(cause);
    settings = before;
    try {
      saveSettings(before);
    } catch {
      // error: NOT-WORTH — the file couldn't be written a moment ago either; it still holds the old value
    }
    tray?.updateSettings(settings);
    throw new Error(`The setting ${key} couldn't be saved: ${errorText(cause)}`, { cause });
  }
  // Turned on with an update already waiting: install it now.
  if (key === "autoInstallUpdates" && value === true && updater.autoInstallable()) hold.whenDone("install", installInBackground);
  if (key === "gamesScanAllowed") syncRunningWatcher();
  // The scaled art copies are made from the library: they go with consent.
  if (key === "gamesScanAllowed" && value === false) artThumbs?.forget();
  if (key === "controllerVolumeFull") syncVolumeKeeper();
  if (key === "headsetStereo") syncHeadsetProfile();
  // A different feed: look again (a development build may now be offered),
  // only with automatic checks on (off: the next "Check for updates" does).
  if (key === "updateChannel" && recheck && settings.checkForUpdates && updater.getState().phase !== "ready")
    updater.check().catch(logged("updater.check() doesn't reject: a failed check is the 'failed' banner"));
  tray?.updateSettings(settings);
  return settings;
}

function showWindow(): void {
  if (!mainWindow) return createWindow(true);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

// The page gets WebUSB, only for the app's own origin and the devices in
// devices.ts, and audio capture (the microphone test), only for the app's
// own page; permissions.ts has the rules. Everything else is refused.
function lockDownSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowPermissionRequest(permission, details as { mediaTypes?: string[] }, isTrusted(contents, details.requestingUrl))),
  );
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => allowPermissionCheck(permission, details as { mediaType?: string }, isAppOrigin(requestingOrigin)));
  ses.setDevicePermissionHandler((details) => details.deviceType === "usb" && isAppOrigin(details.origin) && isAllowedUsbDevice(details.device as { vendorId?: number; productId?: number }));

  // navigator.usb.requestDevice() has no picker in Electron: answer it with the
  // first allowed device that matches, or none.
  // lifetime: NOT-WORTH — once per app on the default session, lives until quit
  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const match = details.deviceList.find((d) => isAllowedUsbDevice(d));
    callback(match?.deviceId ?? "");
  });
}

function createWindow(visible: boolean): void {
  // lifetime: OK — one window; "closed" drops the reference, showWindow() makes a new one only after that
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: "DS5 Dongle OLED Edition Configurator",
    icon: join(resourcesDir, "icon.png"),
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Keep polling the dongle while hidden in the tray.
      backgroundThrottling: false,
    },
  });

  // The layout is sized for 100%; the desktop's display scale is applied on top.
  // (Chromium persists zoom per origin, so pin it rather than inherit a stale one.)
  mainWindow.webContents.on("did-finish-load", () => mainWindow?.webContents.setZoomFactor(1)); // lifetime: OK — goes with the window (destroyed on "closed")
  // lifetime: OK — goes with the window (destroyed on "closed")
  mainWindow.once("ready-to-show", () => {
    if (visible) showWindow();
  });
  // Close-to-tray: hide instead of quitting; tray Quit and logout still quit.
  // lifetime: OK — goes with the window (destroyed on "closed")
  mainWindow.on("close", (event) => {
    if (settings.closeToTray && !quitting) {
      event.preventDefault();
      mainWindow?.hide();
    } else if (!hold.allowQuit(event, () => app.quit())) {
      // Closing quits the app: it waits for the firmware write.
      showWindow();
    }
  });
  // Windows is signing out, restarting or shutting down (Windows only event).
  mainWindow.on("session-end", () => (sessionEnding = true)); // lifetime: OK — goes with the window (destroyed on "closed")
  // lifetime: OK — goes with the window (destroyed on "closed")
  mainWindow.on("closed", () => {
    mainWindow = null;
    hold.setWriting(false);
  });
  // A fresh or crashed page isn't writing anything any more.
  mainWindow.webContents.on("did-finish-load", () => hold.setWriting(false)); // lifetime: OK — goes with the window (destroyed on "closed")
  mainWindow.webContents.on("render-process-gone", () => hold.setWriting(false)); // lifetime: OK — goes with the window (destroyed on "closed")
  // Tell the page when it's actually on screen, so live polling stops in the tray.
  const sendVisible = () => mainWindow?.webContents.send(IPC.windowVisible, !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized());
  // lifetime: OK — goes with the window (destroyed on "closed")
  for (const event of ["show", "hide", "minimize", "restore"] as const) mainWindow.on(event as "show", sendVisible);
  // On screen again: the running-game watcher looks now and every 2 s (Playing, the game's art).
  // lifetime: OK — goes with the window (destroyed on "closed")
  for (const event of ["show", "restore"] as const) mainWindow.on(event as "show", () => retimeRunningWatcher());
  mainWindow.webContents.on("did-finish-load", sendVisible); // lifetime: OK — goes with the window (destroyed on "closed")
  // lifetime: OK — goes with the window (destroyed on "closed"); acts once
  mainWindow.webContents.on("did-finish-load", () => {
    if (!movedFromPortable) return;
    movedFromPortable = false;
    showMainNotice("desktop.notices.nowInstalled");
  });

  const contents = mainWindow.webContents;
  // External links open in the system browser, and only to allowlisted hosts.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) openExternalLink(url);
    return { action: "deny" };
  });
  // lifetime: OK — goes with the window (destroyed on "closed")
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) openExternalLink(url);
    }
  });

  // A page that can't load is a broken install or a stopped dev server; Chromium logs did-fail-load too.
  (devServerUrl ? mainWindow.loadURL(devServerUrl) : mainWindow.loadFile(join(here, "../renderer/index.html"))).catch(logged("loading the app's own page"));
}

// An allowlisted web link in the system browser. Linux: through xdg-open in
// its own unit (openForUser), so a browser it starts outlives the app and
// gets the real home; elsewhere the OS starts it (LaunchServices / ShellExecute).
function openExternalLink(url: string): void {
  const opened = process.platform === "linux" ? openForUser(url) : shell.openExternal(url).then(() => true);
  // error: SHOWN — desktop.errors.linkNotOpened (was SILENT-BUG: a link that didn't open showed nothing)
  opened.then(
    (ok) => ok || showMainError("desktop.errors.linkNotOpened"),
    () => showMainError("desktop.errors.linkNotOpened"),
  );
}

// Exactly the app's own page: the dev server's origin, or the packaged
// index.html itself (not any local file, e.g. one dropped onto the window).
// (Compared decoded, and case-insensitively on Windows, where drive-letter
// case can differ.)
const pagePath = (pathname: string) => {
  const p = decodeURIComponent(pathname);
  return process.platform === "win32" ? p.toLowerCase() : p;
};
const APP_PAGE = pagePath(pathToFileURL(join(here, "../renderer/index.html")).pathname);
function isAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // error: NOT-WORTH — not a URL is "not the app's page": navigation stays blocked, as intended
    return false;
  }
  if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin;
  return parsed.protocol === "file:" && pagePath(parsed.pathname) === APP_PAGE;
}

function isTrusted(sender: WebContents, frameUrl: string): boolean {
  return mainWindow !== null && sender === mainWindow.webContents && isAppUrl(frameUrl);
}

function isAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (devServerUrl) return origin === new URL(devServerUrl).origin;
  // Chromium reports the packaged page's origin as "file://" or "file:///".
  return origin === "file://" || origin === "file:///";
}

// Must run before app ready.
function applyLinuxWorkarounds(): void {
  if (process.platform !== "linux") return;

  // Note: the Chromium sandbox can't be switched off from here (the zygote has
  // already started). On Ubuntu 23.10+ AppArmor blocks the namespace sandbox
  // unless a profile is installed; packaging handles that (docs/adr/0004), and
  // `npm run dev:desktop` / `start:desktop` pass --no-sandbox for local runs.

  // Follow the desktop's (fractional) display scale on Wayland, e.g. KDE at
  // 120%. Without this Chromium guesses a device scale and text comes out too
  // small or too large.
  app.commandLine.appendSwitch("enable-features", "WaylandFractionalScaleV1,WaylandPerSurfaceScale");
}
