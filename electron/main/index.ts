import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { app, BrowserWindow, shell, session } from "electron";
import { isAllowedUsbDevice } from "./devices";
import { isAllowedExternalUrl } from "./urls";

const here = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;

applyLinuxWorkarounds();

// One instance: two copies would fight over the USB interface claim.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app.whenReady().then(start);
}

function start(): void {
  lockDownSession();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: "DS5 Dongle Configurator",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // The layout is sized for 100%; the desktop's display scale is applied on top.
  // (Chromium persists zoom per origin, so pin it rather than inherit a stale one.)
  mainWindow.webContents.on("did-finish-load", () => mainWindow?.webContents.setZoomFactor(1));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
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
