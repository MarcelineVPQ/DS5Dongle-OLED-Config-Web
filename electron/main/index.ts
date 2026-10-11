import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { app, BrowserWindow, net, protocol, shell, session, type WebContents } from "electron";
import { IPC, type DesktopSettings } from "../../src/desktop/api";
import { APP_ID, HIDDEN_FLAG, applyAutostart } from "./autostart";
import { isAllowedUsbDevice } from "./devices";
import { createDesktopShortcut, integrateDesktop } from "./integration";
import { registerIpc } from "./ipc";
import { GamesService } from "./games/service";
import { LibraryStore } from "./games/libraryStore";
import { RunningGameWatcher } from "./games/running";
import { GameKeySchema } from "../../src/desktop/games/library";
import { hasSchemeHandler } from "./games/schemeHandler";
import { micTest } from "./audioTest";
import { firmwareBytes, latestFirmware, readBundled, type FirmwareSourceDeps } from "./firmwareSource";
import { installUsbRule, usbRuleInstalled } from "./linuxSetup";
import { loadSettings, saveSettings } from "./settings";
import { readDesktopPalette, watchDesktopPalette } from "./desktopTheme";
import { AppTray } from "./tray";
import { Updater, FeedMissingError } from "./updater";
import { isAllowedExternalUrl } from "./urls";

const here = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
// Icons and other runtime files: <repo>/resources in development, the
// packaged app's resources/ folder (electron-builder extraResources) otherwise.
const resourcesDir = app.isPackaged ? join(process.resourcesPath, "resources") : join(app.getAppPath(), "resources");
let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let updater: Updater;
const UPDATE_FIRST_CHECK_MS = 20_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
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

// Game artwork for the Games library: ds5-art://art/<game key>/<kind>, served
// only from the files the last scan resolved for that game (never a path the
// page names). Must be registered before the app is ready.
const ART_KINDS = new Set(["hero", "logo", "cover", "header", "icon"]);
protocol.registerSchemesAsPrivileged([{ scheme: "ds5-art", privileges: { standard: true, secure: true } }]);

// One instance: two copies would fight over the USB interface claim.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching it again just brings the running copy forward.
  app.on("second-instance", showWindow);
  void app.whenReady().then(start);
}

// A crashed GPU process means hardware rendering isn't safe on this PC:
// Chromium falls back to software for the rest of this run, and the setting
// goes off so the next start doesn't try again (the user can turn it back on).
function recordGpuCrash(): void {
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU" || details.reason === "clean-exit" || details.reason === "killed") return;
    if (!settings?.hardwareAcceleration) return;
    console.warn(`[gpu] GPU process gone (${details.reason}); software rendering from the next start`);
    updateSetting("hardwareAcceleration", false);
  });
}

function start(): void {
  recordGpuCrash();
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  settings = loadSettings();
  integrateDesktop(resourcesDir);
  updater = new Updater((state) => {
    mainWindow?.webContents.send(IPC.updateState, state);
    tray?.updateUpdateState(state);
  });
  updater.pruneStaleFiles();
  setTimeout(() => settings.checkForUpdates && void checkForUpdates(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => settings.checkForUpdates && void checkForUpdates(), UPDATE_INTERVAL_MS);
  applyAutostart(settings.launchAtLogin, settings.startMinimized);
  lockDownSession();

  tray = new AppTray(
    resourcesDir,
    {
      toggleWindow,
      command: (command) => {
        if (command.type === "openPage") showWindow();
        mainWindow?.webContents.send(IPC.trayCommand, command);
      },
      setSetting: (key, value) => void updateSetting(key, value),
      createDesktopShortcut: process.platform === "win32" ? () => void createDesktopShortcut() : undefined,
      checkForUpdates: () => {
        showWindow();
        void updater.check();
      },
      restartToUpdate: () => updater.restart(),
      quit: () => {
        quitting = true;
        app.quit();
      },
    },
    settings,
  );

  // Games page (Linux): launcher setup for native DualSense features.
  const games =
    process.platform === "linux"
      ? new GamesService({
          userData: app.getPath("userData"),
          allowed: () => settings.gamesScanAllowed,
          fetchManifest: () => updater.fetchManifest(),
          download: (d, path, progress) => updater.downloadAsset(d, path, progress),
          onProtonProgress: (p) => mainWindow?.webContents.send(IPC.protonProgress, p),
        })
      : null;
  const linuxOnly = <T>(run: (g: GamesService) => T): T => {
    if (!games) throw new Error("Game setup is only available on Linux.");
    return run(games);
  };

  // Games library: the player's per-game data (works on every OS), the
  // running game (Linux scan; polled only while Games is allowed).
  const library = new LibraryStore(app.getPath("userData"));
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
        () => watcher.start(),
        () => undefined,
      );
    else watcher.stop();
  };
  syncRunningWatcher();
  protocol.handle("ds5-art", (request) => {
    const parts = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [key, kind] = parts;
    const file = parts.length === 2 && GameKeySchema.safeParse(key).success && ART_KINDS.has(kind) ? games?.artPath(key, kind as never) : undefined;
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 });
  });

  // Firmware the app offers: bundled with this release, or a newer published one.
  const firmwareSource: FirmwareSourceDeps = {
    bundled: () => readBundled(resourcesDir),
    // Fresh every time (a cached feed would go stale with automatic checks
    // off); the last one fetched is the fallback when offline.
    manifest: async () => {
      try {
        return { manifest: await updater.fetchManifest(), problem: null };
      } catch (cause) {
        if (cause instanceof FeedMissingError) return { manifest: null, problem: "unpublished" };
        const cached = updater.getManifest();
        return cached ? { manifest: cached, problem: null } : { manifest: null, problem: "offline" };
      }
    },
    downloadPublished: () => updater.downloadFirmware(),
  };

  registerIpc({
    isTrusted,
    gamesScan: () => linuxOnly((g) => g.scan()),
    gamesApply: (ids) => linuxOnly((g) => g.apply(ids)),
    gamesUndo: (id) => linuxOnly((g) => g.undo(id)),
    gamesBackups: () => linuxOnly((g) => g.listBackups()),
    closeLauncher: (l) => linuxOnly((g) => g.close(l)),
    installProton: () => linuxOnly((g) => g.installLatestProton()),
    gamesDetails: () => linuxOnly((g) => g.details()),
    gamesRunning: () => watcher?.running ?? null,
    libraryGet: () => library.get(),
    librarySetProfile: (u) => library.setProfile(u.gameKey, u.title, u.settings),
    libraryDeleteProfile: (key) => library.deleteProfile(key),
    librarySetMine: (u) => library.setMine(u.gameKey, u.title, u.mine),
    librarySetRestore: (r) => library.setRestore(r ?? undefined),
    gameArtColor: (key) => linuxOnly((g) => g.artColor(key)),
    micTest: () => {
      if (process.platform !== "linux") return Promise.resolve({ ok: false, peak: 0, problem: "failed" as const });
      return micTest((level) => mainWindow?.webContents.send(IPC.micLevel, level));
    },
    gameAction: async (u) => {
      const target = linuxOnly((g) => g.gameAction(u.gameKey, u.action));
      if (target.url) {
        // Launchers often exit non-zero after handing the link to their
        // running instance (Steam does), so the open result means nothing:
        // success = a handler is registered for the scheme.
        if (!hasSchemeHandler(target.url)) return false;
        shell.openExternal(target.url).catch(() => undefined);
        return true;
      }
      if (target.folder && existsSync(target.folder)) return (await shell.openPath(target.folder)) === "";
      return false;
    },
    onStatus: (status) => tray?.update(status),
    onTrayIcon: (png) => tray?.setCustomIcon(png),
    getSettings: () => settings,
    setSetting: updateSetting,
    usbAccessInstalled: () => usbRuleInstalled(resourcesDir),
    setupUsbAccess: () => installUsbRule(resourcesDir),
    appVersion: () => app.getVersion(),
    checkForUpdates: () => updater.check(),
    getUpdateState: () => updater.getState(),
    installUpdate: () => updater.downloadAndInstall(),
    restartToUpdate: () => updater.restart(),
    latestFirmware: () => latestFirmware(firmwareSource),
    downloadFirmware: () => firmwareBytes(firmwareSource),
    getDesktopPalette: () => readDesktopPalette(),
    firmwareChangelog: () => updater.firmwareChangelog(),
  });

  createWindow(!(settings.startMinimized || process.argv.includes(HIDDEN_FLAG)));
  watchDesktopPalette(() => void readDesktopPalette().then((palette) => mainWindow?.webContents.send(IPC.desktopPalette, palette)));
  app.on("activate", showWindow);
  app.on("before-quit", () => (quitting = true));
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// A scheduled check; with automatic updates on, a newer version is downloaded,
// verified and installed in the background (the same path as the banner's
// button), and starts the next time the app opens.
async function checkForUpdates(): Promise<void> {
  const state = await updater.check();
  if (state.phase === "available" && settings.autoInstallUpdates) await updater.downloadAndInstall();
}

function updateSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): DesktopSettings {
  settings = { ...settings, [key]: value };
  saveSettings(settings);
  if (key === "launchAtLogin" || key === "startMinimized") applyAutostart(settings.launchAtLogin, settings.startMinimized);
  // Turned on with an update already waiting: install it now.
  if (key === "autoInstallUpdates" && value === true && updater.getState().phase === "available") void updater.downloadAndInstall();
  if (key === "gamesScanAllowed") syncRunningWatcher();
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

// The page gets exactly one web permission, WebUSB, and only for the app's own
// origin and the devices in devices.ts. Everything else is refused. The one
// check besides it: "media" for audio, so the narrator can find the
// controller's speaker by name (Chromium hides device names otherwise). It
// grants no capture: getUserMedia goes through the request handler, which
// refuses everything.
function lockDownSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      // ("speaker-selection" isn't in Electron's type list yet; it is checked at runtime.)
      isAppOrigin(requestingOrigin) &&
      (permission === "usb" || (permission as string) === "speaker-selection" || (permission === "media" && (details as { mediaType?: string }).mediaType === "audio")),
  );
  ses.setDevicePermissionHandler((details) => details.deviceType === "usb" && isAppOrigin(details.origin) && isAllowedUsbDevice(details.device as { vendorId?: number; productId?: number }));

  // navigator.usb.requestDevice() has no picker in Electron: answer it with the
  // first allowed device that matches, or none.
  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const match = details.deviceList.find((d) => isAllowedUsbDevice(d));
    callback(match?.deviceId ?? "");
  });
}

function createWindow(visible: boolean): void {
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
  mainWindow.webContents.on("did-finish-load", () => mainWindow?.webContents.setZoomFactor(1));
  mainWindow.once("ready-to-show", () => {
    if (visible) showWindow();
  });
  // Close-to-tray: hide instead of quitting; tray Quit and logout still quit.
  mainWindow.on("close", (event) => {
    if (settings.closeToTray && !quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));
  // Tell the page when it's actually on screen, so live polling stops in the tray.
  const sendVisible = () => mainWindow?.webContents.send(IPC.windowVisible, !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized());
  for (const event of ["show", "hide", "minimize", "restore"] as const) mainWindow.on(event as "show", sendVisible);
  mainWindow.webContents.on("did-finish-load", sendVisible);

  const contents = mainWindow.webContents;
  // External links open in the system browser, and only to allowlisted hosts.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });

  if (devServerUrl) void mainWindow.loadURL(devServerUrl);
  else void mainWindow.loadFile(join(here, "../renderer/index.html"));
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
