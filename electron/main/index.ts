import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { app, BrowserWindow, shell, session, type WebContents } from "electron";
import { IPC, type DesktopSettings } from "../../src/desktop/api";
import { APP_ID, HIDDEN_FLAG, applyAutostart } from "./autostart";
import { isAllowedUsbDevice } from "./devices";
import { createDesktopShortcut, integrateDesktop } from "./integration";
import { registerIpc } from "./ipc";
import { installUsbRule, usbRuleInstalled } from "./linuxSetup";
import { loadSettings, saveSettings } from "./settings";
import { AppTray } from "./tray";
import { Updater } from "./updater";
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

applyLinuxWorkarounds();

// One instance: two copies would fight over the USB interface claim.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching it again just brings the running copy forward.
  app.on("second-instance", showWindow);
  void app.whenReady().then(start);
}

function start(): void {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  settings = loadSettings();
  integrateDesktop(resourcesDir);
  updater = new Updater((state) => {
    mainWindow?.webContents.send(IPC.updateState, state);
    tray?.updateUpdateState(state);
  });
  updater.pruneStaleFiles();
  setTimeout(() => settings.checkForUpdates && void updater.check(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => settings.checkForUpdates && void updater.check(), UPDATE_INTERVAL_MS);
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

  registerIpc({
    isTrusted,
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
    latestFirmware: async () => {
      const manifest = updater.getManifest() ?? (await updater.fetchManifest().catch(() => null));
      return manifest?.firmware ? { version: manifest.firmware.version, notesUrl: manifest.firmware.notes_url } : null;
    },
    downloadFirmware: () => updater.downloadFirmware(),
  });

  createWindow(!(settings.startMinimized || process.argv.includes(HIDDEN_FLAG)));
  app.on("activate", showWindow);
  app.on("before-quit", () => (quitting = true));
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

function updateSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): DesktopSettings {
  settings = { ...settings, [key]: value };
  saveSettings(settings);
  if (key === "launchAtLogin" || key === "startMinimized") applyAutostart(settings.launchAtLogin, settings.startMinimized);
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
// origin and the devices in devices.ts. Everything else is refused.
function lockDownSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permission === "usb" && isAppOrigin(requestingOrigin));
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
    title: "DS5 Dongle Configurator",
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

function isAppUrl(url: string): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl);
  return url.startsWith("file://") && url.includes("/renderer/");
}

function isTrusted(sender: WebContents, frameUrl: string): boolean {
  return mainWindow !== null && sender === mainWindow.webContents && isAppUrl(frameUrl);
}

function isAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (devServerUrl) return origin === new URL(devServerUrl).origin;
  return origin === "file://";
}

// Must run before app ready.
function applyLinuxWorkarounds(): void {
  if (process.platform !== "linux") return;

  // Note: the Chromium sandbox can't be switched off from here (the zygote has
  // already started). On Ubuntu 23.10+ AppArmor blocks the namespace sandbox
  // unless a profile is installed; packaging handles that (docs/adr/0004), and
  // `npm run dev:desktop` / `start:desktop` pass --no-sandbox for local runs.

  // NVIDIA proprietary driver: Electron's GPU process crash-loops (SIGTRAP on
  // Wayland, SIGSEGV under XWayland with driver 615). A settings window has no
  // use for GPU compositing, so render in software.
  if (existsSync("/proc/driver/nvidia/version")) app.disableHardwareAcceleration();

  // Follow the desktop's (fractional) display scale on Wayland, e.g. KDE at
  // 120%. Without this Chromium guesses a device scale and text comes out too
  // small or too large.
  app.commandLine.appendSwitch("enable-features", "WaylandFractionalScaleV1,WaylandPerSurfaceScale");
}
