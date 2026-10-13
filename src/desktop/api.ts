import type { ApplyResult, CloseProblem, GamesReport, LauncherId, Msg, RestartList } from "./games/types";
import type { GameAction, GameInfo } from "./games/types";
import type { LibraryFile, Mine, ProfileSettings } from "./games/library";
import type { DesktopPalette } from "./theme/desktopPalette";
import type { OfficialFirmware } from "../protocol/officialFirmware";

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

export type UpdateChannel = "stable" | "dev";

export interface DevChannelPreview {
  app: string;
  firmware: string | null;
  notes: string | null; // Markdown
  notesUrl: string | null;
}

export interface DesktopSettings {
  closeToTray: boolean;
  startMinimized: boolean;
  launchAtLogin: boolean;
  checkForUpdates: boolean;
  // Download and install app updates in the background (they start the next
  // time the app opens); asked once on first run (updatesAsked).
  autoInstallUpdates: boolean;
  updatesAsked: boolean;
  gamesScanAllowed: boolean; // the user agreed to let the Games page read launcher settings
  // The narrator: "ask" until the user answers the tour's question (silent
  // until then), then on or off; changeable in App settings.
  narratorVoice: "ask" | "on" | "off";
  // Show her words as a caption while she speaks (and, with the voice off,
  // the short confirmations as text only).
  narratorCaptions: boolean;
  // Draw with the graphics card (needed for blur, glass and smooth effects).
  // Turned off automatically if the GPU process crashes; applies at restart.
  hardwareAcceleration: boolean;
  // Experimental: the lightbar glow brighter than paper white on HDR displays
  // (starts the app with the scRGB color profile; applies at restart).
  hdrLighting: boolean;
  // Which update feed the app follows: "stable" (everyone), or "dev" (opt-in
  // development builds, which also get every stable release).
  updateChannel: UpdateChannel;
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
  source: "bundled" | "online"; // bundled = shipped inside this app, works offline
}

// Result of looking for firmware to offer. problem says why the feed gave no
// answer: "unpublished" (no release in the feed yet) or "offline".
export interface FirmwareLookup {
  latest: LatestFirmware | null;
  problem: "unpublished" | "offline" | null;
}

// Sony's official controller firmware (check only): the latest version per
// firmware line, or why there's none ("disabled": automatic checks are off
// and the user hasn't asked; "unavailable": offline or an unexpected answer).
export interface OfficialFirmwareLookup {
  latest: OfficialFirmware | null;
  problem: "disabled" | "unavailable" | null;
}

export interface GameBackup {
  id: string;
  created: string;
  changes: Msg[];
  files: string[];
}

export type ProtonProgress = { phase: "downloading"; got: number; total: number } | { phase: "verifying" } | { phase: "unpacking" } | { phase: "copying"; target: string };
export type ProtonInstallResult = { ok: true; name: string; installed: string[] } | { ok: false; message: string };
// conflict: files a launcher changed after our write (undo would discard that, so it refuses).
// blockedBy: as in ApplyResult (not in the restart list, or not closed: `problem`).
export type UndoResult =
  { ok: true; restored: string[]; reopenFailed?: LauncherId[] } | { ok: false; blockedBy: LauncherId[]; problem?: CloseProblem } | { ok: false; conflict: string[] } | { ok: false; error: string };

// Firmware being written to the board, and what waits for it to finish
// (electron/main/firmwareHold.ts).
export interface FirmwareHoldState {
  writing: boolean;
  restartQueued: boolean;
  quitQueued: boolean;
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
  // Windows: forget Windows' cached USB setup for the dongle's IDs (one UAC
  // prompt), so it sets up the WinUSB driver again on the next plug-in.
  repairWindowsUsb(): Promise<{ ok: boolean; message: string }>;
  appVersion: string;
  // App updates.
  checkForUpdates(): Promise<UpdateState>;
  getUpdateState(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  // Switch to the stable channel and offer its latest version, even if older.
  backToStable(): Promise<UpdateState>;
  // The newest development build (app and firmware versions, the app's notes)
  // from the signed dev feed, shown before joining the Development channel.
  devChannelPreview(): Promise<DevChannelPreview | null>;
  restartToUpdate(): void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  // Firmware: what's published, and the verified UF2 bytes.
  latestFirmware(): Promise<FirmwareLookup>;
  // Sony's latest DualSense / Edge firmware versions (fetched by the main
  // process; `asked` = the user pressed Refresh, allowed with automatic checks off).
  officialControllerFirmware(asked: boolean): Promise<OfficialFirmwareLookup>;
  // "Match desktop" theme: the desktop's colors, and changes to them.
  getDesktopPalette(): Promise<DesktopPalette | null>;
  // The firmware repo's CHANGELOG.md (fetched by the main process).
  firmwareChangelog(): Promise<string>;
  onDesktopPalette(listener: (palette: DesktopPalette | null) => void): () => void;
  // The window was shown or hidden (tray, minimize). Chromium's own visibility
  // stays "visible" while hidden here (background throttling is off).
  onWindowVisible(listener: (visible: boolean) => void): () => void;
  downloadFirmware(): Promise<{ version: string; bytes: Uint8Array }>;
  // Firmware write in progress (firmwareUpdate.ts): restart, quit and the
  // app update's install wait for it to end.
  setFirmwareWriting(writing: boolean): void;
  getFirmwareHold(): Promise<FirmwareHoldState>;
  onFirmwareHold(listener: (state: FirmwareHoldState) => void): () => void;
  // Linux Games page: read-only scan, apply only confirmed fix ids, undo.
  gamesScan(): Promise<GamesReport>;
  // `restart`: the running launchers the page said it will close and reopen.
  gamesApply(request: { fixIds: string[]; restart: RestartList }): Promise<ApplyResult>;
  gamesUndo(request: { backupId: string; restart: RestartList }): Promise<UndoResult>;
  gamesBackups(): Promise<GameBackup[]>;
  installProton(): Promise<ProtonInstallResult>;
  onProtonProgress(listener: (progress: ProtonProgress) => void): () => void;
  // Games library (Linux scan; the library file works everywhere): details
  // and artwork from the last scan, the running game, and the player's own
  // per-game data (profile, rating, notes) plus the profile restore point.
  gamesDetails(): Promise<Record<string, GameInfo>>;
  gamesRunning(): Promise<string | null>;
  onRunningGame(listener: (gameKey: string | null) => void): () => void;
  libraryGet(): Promise<LibraryFile>;
  librarySetProfile(update: { gameKey: string; title: string; settings: ProfileSettings }): Promise<LibraryFile>;
  libraryDeleteProfile(gameKey: string): Promise<LibraryFile>;
  librarySetMine(update: { gameKey: string; title: string; mine: Mine }): Promise<LibraryFile>;
  librarySetRestore(restore: LibraryFile["restore"] | null): Promise<LibraryFile>;
  librarySetLayout(layout: { id: string; name: string; table: number[]; extra?: number[] }): Promise<LibraryFile>;
  libraryDeleteLayout(id: string): Promise<LibraryFile>;
  // Launch a game or open its launcher page / folder (resolved in main).
  gameAction(update: { gameKey: string; action: GameAction }): Promise<boolean>;
  // A game's signature color from its artwork (#rrggbb), or null.
  gameArtColor(gameKey: string): Promise<string | null>;
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
  backToStable: "desktop:back-to-stable",
  devChannelPreview: "desktop:dev-channel-preview",
  restartToUpdate: "desktop:restart-to-update",
  updateState: "desktop:update-state",
  latestFirmware: "desktop:latest-firmware",
  officialControllerFirmware: "desktop:official-controller-firmware",
  downloadFirmware: "desktop:download-firmware",
  setFirmwareWriting: "desktop:set-firmware-writing",
  getFirmwareHold: "desktop:get-firmware-hold",
  firmwareHold: "desktop:firmware-hold",
  getDesktopPalette: "desktop:get-desktop-palette",
  firmwareChangelog: "desktop:firmware-changelog",
  desktopPalette: "desktop:desktop-palette",
  windowVisible: "desktop:window-visible",
  setupUsbAccess: "desktop:setup-usb-access",
  repairWindowsUsb: "desktop:repair-windows-usb",
  gamesScan: "desktop:games-scan",
  gamesApply: "desktop:games-apply",
  gamesUndo: "desktop:games-undo",
  gamesBackups: "desktop:games-backups",
  installProton: "desktop:install-proton",
  protonProgress: "desktop:proton-progress",
  gamesDetails: "desktop:games-details",
  gamesRunning: "desktop:games-running",
  runningGame: "desktop:running-game",
  libraryGet: "desktop:library-get",
  librarySetProfile: "desktop:library-set-profile",
  libraryDeleteProfile: "desktop:library-delete-profile",
  librarySetMine: "desktop:library-set-mine",
  librarySetRestore: "desktop:library-set-restore",
  librarySetLayout: "desktop:library-set-layout",
  libraryDeleteLayout: "desktop:library-delete-layout",
  gameAction: "desktop:game-action",
  gameArtColor: "desktop:game-art-color",
} as const;

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop !== undefined;
}
