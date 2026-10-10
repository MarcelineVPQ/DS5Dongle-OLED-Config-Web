import type { DesktopPalette } from "./theme/desktopPalette";

// What the Electron preload exposes as `window.desktop`. Absent in the browser
// build, so `isDesktop()` is the switch between the two targets. Every call
// goes through a fixed IPC channel that the main process validates
// (electron/main/ipc.ts); the page never gets ipcRenderer itself.

// The renderer owns the USB connection, so it reports device state to the main
// process, which drives the tray icon, tooltip and menu from it.
export interface DeviceStatus {
  dongle: boolean;
  controller: boolean;
  slot: number; // 0-3, -1 when unknown
  firmware: string | null;
  charging: boolean;
  battery: number | null; // 0-100 in 10% steps, null when unknown
}

// Actions picked from the tray menu that need the USB connection.
export type TrayCommand = { type: "switchSlot"; slot: number } | { type: "openPage"; page: string };

export interface DesktopSettings {
  closeToTray: boolean;
  startMinimized: boolean;
  launchAtLogin: boolean;
  checkForUpdates: boolean;
}

// App self-update state, pushed from the main process (electron/main/updater.ts).
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date"; version: string }
  | { phase: "available"; version: string; size: number; notesUrl?: string }
  | { phase: "manual"; version: string; notesUrl?: string; detail: string }
  | { phase: "downloading"; version: string; got: number; total: number }
  | { phase: "installing"; version: string }
  | { phase: "ready"; version: string }
  | { phase: "failed"; detail: string };

export interface LatestFirmware {
  version: string;
  notesUrl?: string;
}

export interface DesktopApi {
  platform: string;
  reportStatus(status: DeviceStatus): void;
  // A PNG data URL drawn by the renderer (src/desktop/tray/trayIcon.ts).
  setTrayIcon(pngDataUrl: string): void;
  onTrayCommand(listener: (command: TrayCommand) => void): () => void;
  getSettings(): Promise<DesktopSettings>;
  setSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): Promise<DesktopSettings>;
  // Linux: whether the app's udev rule is installed, and installing it (pkexec).
  usbAccessInstalled(): Promise<boolean>;
  setupUsbAccess(): Promise<{ ok: boolean; message: string }>;
  appVersion: string;
  // App updates.
  checkForUpdates(): Promise<UpdateState>;
  getUpdateState(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  restartToUpdate(): void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  // Firmware: what's published, and the verified UF2 bytes.
  latestFirmware(): Promise<LatestFirmware | null>;
  // "Match desktop" theme: the desktop's colors, and changes to them.
  getDesktopPalette(): Promise<DesktopPalette | null>;
  onDesktopPalette(listener: (palette: DesktopPalette | null) => void): () => void;
  downloadFirmware(): Promise<{ version: string; bytes: Uint8Array }>;
}

export const IPC = {
  reportStatus: "desktop:report-status",
  setTrayIcon: "desktop:set-tray-icon",
  trayCommand: "desktop:tray-command",
  getSettings: "desktop:get-settings",
  setSetting: "desktop:set-setting",
  usbAccessInstalled: "desktop:usb-access-installed",
  appVersion: "desktop:app-version",
  checkForUpdates: "desktop:check-for-updates",
  getUpdateState: "desktop:get-update-state",
  installUpdate: "desktop:install-update",
  restartToUpdate: "desktop:restart-to-update",
  updateState: "desktop:update-state",
  latestFirmware: "desktop:latest-firmware",
  downloadFirmware: "desktop:download-firmware",
  getDesktopPalette: "desktop:get-desktop-palette",
  desktopPalette: "desktop:desktop-palette",
  setupUsbAccess: "desktop:setup-usb-access",
} as const;

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop !== undefined;
}
