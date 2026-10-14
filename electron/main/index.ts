import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { statSync } from "node:fs";
import { app, BrowserWindow, dialog, net, protocol, shell, session, type WebContents } from "electron";
import { IPC, type DesktopSettings, type MainErrorKey } from "../../src/desktop/api";
import { errorText, logged } from "../../src/errorText";
import { APP_ID, HIDDEN_FLAG, applyAutostart } from "./autostart";
import { isAllowedUsbDevice } from "./devices";
import { allowPermissionCheck, allowPermissionRequest } from "./permissions";
import { createDesktopShortcut, integrateDesktop } from "./integration";
import { registerIpc } from "./ipc";
import { GamesService } from "./games/service";
import { LibraryStore } from "./games/libraryStore";
import { RunningGameWatcher } from "./games/running";
import { artRequestTarget } from "./games/artRequest";
import { hasSchemeHandler, openForUser, startForUser } from "./games/schemeHandler";
import { firmwareBytes, firmwareFeed, latestFirmware, readBundled, type FirmwareSourceDeps } from "./firmwareSource";
import { devChannelPreview } from "./updateFeed";
import { OfficialFirmwareSource } from "./officialFirmware";
import { installUsbRule, usbRuleInstalled } from "./linuxSetup";
import { repairWindowsUsb } from "./windowsSetup";
import { loadSettings, saveSettings } from "./settings";
import { readDesktopPalette, watchDesktopPalette } from "./desktopTheme";
import { AppTray } from "./tray";
import { Updater } from "./updater";
import { FirmwareHold } from "./firmwareHold";
import { isAllowedExternalUrl } from "./urls";

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
const UPDATE_FIRST_CHECK_MS = 20_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// cache: OK — key=none (settings.json); invalidated=write-through: updateSetting saves the file; bound=1 entry
let settings: DesktopSettings;
// Set when the user really quits (tray Quit, OS logout), so close-to-tray
// doesn't swallow it.
let quitting = false;
// Starts/stops the running-game watcher with the Games consent (set in start()).
let syncRunningWatcher: () => void = () => undefined;

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
    // error: SHOWN — main-english: "The app couldn't start" dialog; no window exists to show it in (batch E3: main-process text in English)
    .catch((cause: unknown) => {
      dialog.showErrorBox("DS5 Dongle Configurator", `The app couldn't start: ${errorText(cause)}\n\nTry starting it again. If this keeps happening, reinstall the app.`);
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

  // Games library: the player's per-game data (works on every OS).
  const library = new LibraryStore(app.getPath("userData"));
  // Games page (Linux and Windows): the library, per-game profiles and, on
  // Linux, launcher / Proton setup for native DualSense features.
  const games =
    process.platform === "linux" || process.platform === "win32"
      ? new GamesService({
          userData: app.getPath("userData"),
          allowed: () => settings.gamesScanAllowed,
          fetchManifest: () => updater.fetchManifest(),
          download: (d, path, progress) => updater.downloadAsset(d, path, progress),
          onProtonProgress: (p) => mainWindow?.webContents.send(IPC.protonProgress, p),
          // Games the player marked "controller not detected" get the standard-gamepad fix.
          // Windows: no launcher is closed while the library sees a game running.
          gameRunning: (): boolean => watcher?.running != null,
          notDetected: () => new Set(Object.entries(library.get().games).flatMap(([key, r]) => (r.mine?.tags?.includes("not-detected") ? [key] : []))),
          // Games the player marked "Supports HDR" get the Turn on HDR fix (with an HDR screen).
          hdrMarked: () => new Set(Object.entries(library.get().games).flatMap(([key, r]) => (r.mine?.hdr ? [key] : []))),
        })
      : null;
  const withGames = <T>(run: (g: GamesService) => T): T => {
    if (!games) throw new Error("The Games page isn't available on this system yet.");
    return run(games);
  };

  // The running game (polled only while Games is allowed).
  const watcher = games
    ? new RunningGameWatcher(
        () => games.runningCandidates(),
        (key) => mainWindow?.webContents.send(IPC.runningGame, key),
      )
    : null;
  syncRunningWatcher = () => {
    if (!games || !watcher) return;
    if (settings.gamesScanAllowed)
      void games.scan().then(
        // Consent may have been turned off while the scan ran.
        () => settings.gamesScanAllowed && watcher.start(),
        logged("background scan for the running-game watcher (the Games page scans again and shows its own errors)"),
      );
    else watcher.stop();
  };
  syncRunningWatcher();
  // lifetime: NOT-WORTH — one scheme handler per app, lives until quit
  protocol.handle("ds5-art", (request) => {
    const target = artRequestTarget(request.url);
    const file = target ? games?.artPath(target.key, target.kind) : undefined;
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
    manifest: firmwareFeed(
      updater.feed,
      () => settings.checkForUpdates,
      () => settings.updateChannel,
    ),
    freshFeed: (channel) => updater.feed.get(channel, 0),
    download: (uf2) => updater.downloadFirmwareFile(uf2),
  };

  registerIpc({
    isTrusted,
    gamesScan: () => withGames((g) => g.scan()),
    gamesApply: (r) => withGames((g) => g.apply(r.fixIds, r.restart)),
    gamesUndo: (r) => withGames((g) => g.undo(r.backupId, r.restart)),
    gamesBackups: () => withGames((g) => g.listBackups()),
    gamesRunningLaunchers: () => withGames((g) => g.runningLaunchers()),
    installProton: () => withGames((g) => (process.platform === "linux" ? g.installLatestProton() : Promise.reject(new Error("Proton is only used on Linux.")))),
    gamesDetails: () => withGames((g) => g.details()),
    gamesRunning: () => watcher?.running ?? null,
    libraryGet: () => library.get(),
    librarySetProfile: (u) => library.setProfile(u.gameKey, u.title, u.settings),
    libraryDeleteProfile: (key) => library.deleteProfile(key),
    librarySetMine: (u) => library.setMine(u.gameKey, u.title, u.mine),
    librarySetRestore: (r) => library.setRestore(r ?? undefined),
    librarySetLayout: (u) => library.setLayout(u.id, u.name, u.table, u.extra),
    libraryDeleteLayout: (id) => library.deleteLayout(id),
    gameArtColor: (key) => withGames((g) => g.artColor(key)),
    gameAction: async (u) => {
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
    setSetting: updateSetting,
    usbAccessInstalled: () => usbRuleInstalled(resourcesDir),
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
  watchDesktopPalette(
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
  const state = await updater.check();
  if (state.phase === "available" && settings.autoInstallUpdates) hold.whenDone("install", installInBackground);
}

// downloadAndInstall() doesn't reject: a failure is the "failed" banner state.
const installInBackground = () => void updater.downloadAndInstall().catch(logged("automatic update install (a failure shows as the 'failed' banner)"));

// A user action outside the page failed (a tray toggle, a link): the page's notice says so.
function showMainError(key: MainErrorKey): void {
  mainWindow?.webContents.send(IPC.showError, key);
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
  if (key === "autoInstallUpdates" && value === true && updater.getState().phase === "available") hold.whenDone("install", installInBackground);
  if (key === "gamesScanAllowed") syncRunningWatcher();
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
  mainWindow.webContents.on("did-finish-load", sendVisible); // lifetime: OK — goes with the window (destroyed on "closed")

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
