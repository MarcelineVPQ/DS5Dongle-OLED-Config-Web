import type { Recovered } from "../persisted";
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
  // The controller on a cable (chargeState() in src/protocol/controllerInfo.ts):
  // charging, plugged in but not charging, or fully charged; null on battery.
  power: "charging" | "pluggedIn" | "full" | null;
  battery: number | null; // 0-100 in 10% steps, null when unknown
}

// Actions picked from the tray menu that need the USB connection.
export type TrayCommand = { type: "switchSlot"; slot: number } | { type: "openPage"; page: string };

export type UpdateChannel = "stable" | "dev";

// The main process's answer to a request that doesn't fit its schema (an app
// bug; ipc.ts logs the details). The page shows desktop.errors.badRequest.
export const BAD_REQUEST = "DS5_BAD_REQUEST";

// Errors the main process asks the page to show (CLAUDE.md "Error pass"):
// failures of something the user did outside the page (a tray toggle, a link
// opened from the page). Fixed keys only; the page shows them with shown().
export const MAIN_ERROR_KEYS = ["desktop.errors.settingNotSaved", "desktop.errors.linkNotOpened"] as const;
export type MainErrorKey = (typeof MAIN_ERROR_KEYS)[number];

// News from the main process the page shows as a notice (not an error):
// something the app did on its own in the background. Fixed keys only.
export const MAIN_NOTICE_KEYS = ["desktop.notices.volumeRestored", "desktop.notices.nowInstalled"] as const;
export type MainNoticeKey = (typeof MAIN_NOTICE_KEYS)[number];

export interface DevChannelPreview {
  app: string;
  firmware: string | null;
  notes: string | null; // Markdown
  notesUrl: string | null;
}

// Why the update feed gave no answer: "offline" (the server couldn't be
// reached: no network, a timeout, an HTTP error), "unsigned" (it answered, but
// the feed failed its signature check) or "malformed" (signed, but not a feed
// this app can read). Only "offline" is the user's connection.
export type FeedProblem = "offline" | "unsigned" | "malformed";

// The join dialog's answer: the preview, why there's none, or null (not checked).
// error: SHOWN — desktop.channel.joinOffline / .joinUnpublished, desktop.updateFeed.unsigned / .malformed (DevChannelDialog)
export type DevChannelAnswer = DevChannelPreview | { problem: FeedProblem | "unpublished" } | null;

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
  // Linux: the player applied the Games fix that turns the controller's volume
  // and microphone level up to full; while the app runs it sets them to full
  // again whenever the controller's sound card reappears. Set by Apply, cleared
  // by Undo (main process only, not a page setting).
  controllerVolumeFull: boolean;
  // Linux: the controller's sound profile follows its headset jack (stereo
  // with a headset in, the speaker's profile back when it's unplugged;
  // electron/main/games/headsetProfile.ts). On by default.
  headsetStereo: boolean;
  // The first switch was explained (the notice with Undo); later ones are quiet
  // (main process only, not a page setting).
  headsetStereoExplained: boolean;
  // Dev builds only (Developer card → Fake games): Games shows a made-up
  // library instead of scanning. A stable release ignores it (electron/main/devTools.ts).
  devFakeGames: boolean;
}

// Developer card → Fake games (dev builds only; electron/main/games/fake/).
// hdr: what the fake computer has for HDR (ready, the screen's HDR off, no gamescope).
export const FAKE_GAMES_HDR = ["ready", "hdr-off", "no-gamescope"] as const;
export type FakeGamesHdr = (typeof FAKE_GAMES_HDR)[number];
// A change from the card: the switch, the game shown as running (null = none), the HDR setup.
export interface DevFakeGamesChange {
  on?: boolean;
  running?: string | null;
  hdr?: FakeGamesHdr;
}
export interface DevFakeGamesState {
  on: boolean;
  status: { running: string | null; hdr: FakeGamesHdr; games: Array<{ key: string; title: string }> } | null;
}

// App self-update state, pushed from the main process (electron/main/updater.ts).
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date"; version: string }
  // dropsDevTools: this is a developer build and the update is a regular one (the banner says so; never installed automatically).
  | { phase: "available"; version: string; size: number; notesUrl?: string; dropsDevTools?: true }
  | { phase: "manual"; version: string; notesUrl?: string; detail: string }
  | { phase: "downloading"; version: string; got: number; total: number }
  | { phase: "installing"; version: string }
  | { phase: "ready"; version: string }
  // during "install": the user's Download and install (or an automatic one) failed, which the banner shows.
  // problem: why a check failed (the feed's own problem, see FeedProblem).
  // error: SHOWN — desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed by problem (CheckNow, SetupScreen)
  | { phase: "failed"; detail: string; during?: "install"; problem?: FeedProblem };

export interface LatestFirmware {
  version: string;
  notesUrl?: string;
  source: "bundled" | "online"; // bundled = shipped inside this app, works offline
  // Online only: the exact feed entry shown, so Install downloads that one.
  sha256?: string;
  channel?: UpdateChannel;
}

// The firmware the user confirmed, or why it wasn't downloaded: "changed" =
// the feed now offers something else (check again), "mismatch" = the file
// didn't match the entry shown.
// error: SHOWN — desktop.firmware.feedChanged (or desktop.firmware.hashMismatch; firmwareUpdate.ts throws it to the firmware banner)
export type FirmwareDownload = { ok: true; version: string; bytes: Uint8Array } | { ok: false; reason: "changed" | "mismatch" };

// Result of looking for firmware to offer. problem says why the feed gave no
// answer: "unpublished" (no release in the feed yet) or a FeedProblem.
export interface FirmwareLookup {
  latest: LatestFirmware | null;
  // "disabled": automatic checks are off and the user hasn't asked.
  // error: SHOWN — desktop.firmware.offline / .unsigned / .malformed (or desktop.firmware.unpublished; "disabled" is a choice, not an error)
  problem: "unpublished" | FeedProblem | "disabled" | null;
}

// Sony's official controller firmware (check only): the latest version per
// firmware line, or why there's none ("disabled": automatic checks are off
// and the user hasn't asked; "unavailable": offline or an unexpected answer).
export interface OfficialFirmwareLookup {
  latest: OfficialFirmware | null;
  // error: SHOWN — desktop.ctrlInfo.officialUnavailable after Refresh ("disabled" is a choice, not an error)
  problem: "disabled" | "unavailable" | null;
}

export interface GameBackup {
  id: string;
  created: string;
  changes: Msg[];
  files: string[];
  damaged?: string; // its manifest can't be read: the set's folder (no Undo)
}

export type ProtonProgress = { phase: "downloading"; got: number; total: number } | { phase: "verifying" } | { phase: "unpacking" } | { phase: "copying"; target: string };
// problem: the update feed itself failed (the page shows its own words for it; message is English, for the log).
// error: SHOWN — desktop.errors.main.protonNotPublished and the other keyed errors (shownText) on the Proton card; a feed problem shows desktop.updateFeed.offline / .unsigned / .malformed
export type ProtonInstallResult = { ok: true; name: string; installed: string[] } | { ok: false; message: string; problem?: FeedProblem };
// conflict: files a launcher changed after our write (undo would discard that, so it refuses).
// blockedBy: as in ApplyResult (not in the restart list, or not closed: `problem`).
// noController: the change set the controller's volume, and it isn't connected (nothing undone).
export type UndoResult =
  // audioRestartFailed: restored, but restarting the audio service (WirePlumber) failed.
  // volumeNotSaved: the old controller levels are back, but saving them as ALSA's saved state failed ("cancelled": the password prompt).
  | { ok: true; restored: string[]; reopenFailed?: LauncherId[]; audioRestartFailed?: string; volumeNotSaved?: string }
  // error: SHOWN — desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted)
  | { ok: false; blockedBy: LauncherId[]; problem?: CloseProblem }
  // error: SHOWN — desktop.games.undoConflict
  | { ok: false; conflict: string[] }
  // error: SHOWN — desktop.games.undoNoController
  | { ok: false; noController: true }
  // error: SHOWN — desktop.errors.main.alreadyUndone and the other keyed errors (shownText) in the Games page's error notice
  | { ok: false; error: string };

// Firmware being written to the board, and what waits for it to finish
// (electron/main/firmwareHold.ts).
export interface FirmwareHoldState {
  writing: boolean;
  restartQueued: boolean;
  quitQueued: boolean;
}

export interface DesktopApi {
  platform: string;
  // The CPU family (process.arch: "x64", "arm64", …): a game report says what it was tested on.
  arch?: string;
  reportStatus(status: DeviceStatus): void;
  // A PNG data URL drawn by the renderer (src/desktop/tray/trayIcon.ts).
  setTrayIcon(pngDataUrl: string): void;
  onTrayCommand(listener: (command: TrayCommand) => void): () => void;
  onShowError(listener: (key: MainErrorKey) => void): () => void;
  onShowNotice(listener: (key: MainNoticeKey) => void): () => void;
  // Linux: the app switched the controller to its stereo headset profile for
  // the first time (headsetProfile.ts); the page explains it, with Undo.
  onHeadsetSwitched(listener: () => void): () => void;
  // Undo that switch: false when there's nothing to undo any more (the
  // headset was unplugged, or the profile changed since).
  headsetUndo(): Promise<boolean>;
  // The live input's headset bit (null: no live input), used where the
  // kernel doesn't report the controller's jack.
  setHeadsetHint(headphones: boolean | null): void;
  getSettings(): Promise<DesktopSettings>;
  // The main process's files that were damaged at start (settings, game
  // library): what was kept and where the damaged copy is (RecoveredNotice).
  recoveredFiles(): Promise<Recovered[]>;
  setSetting<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): Promise<DesktopSettings>;
  // Linux: whether the app's udev rule is installed, and installing it (pkexec).
  usbAccessInstalled(): Promise<boolean>;
  // The programs that have the board open (Linux, read-only from /proc; other
  // systems: none can be named, an empty list). Asked when the board is busy.
  boardHolders(): Promise<BoardHolder[]>;
  // error: SHOWN — desktop.usbAccess.result.* (keyed text, shownText) under Set up USB access
  setupUsbAccess(): Promise<{ ok: boolean; message: string }>;
  // Windows: forget Windows' cached USB setup for the dongle's IDs (one UAC
  // prompt), so it sets up the WinUSB driver again on the next plug-in.
  // error: SHOWN — desktop.windowsUsb.result.* (keyed text, shownText) under the Windows USB repair
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
  // `asked`: the user pressed the dialog's check button (allowed with automatic checks off).
  devChannelPreview(asked: boolean): Promise<DevChannelAnswer>;
  restartToUpdate(): void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  // Firmware: what's published, and the verified UF2 bytes.
  // `asked`: the user pressed a check button (allowed with automatic checks off).
  latestFirmware(asked?: boolean): Promise<FirmwareLookup>;
  // Sony's latest DualSense / Edge firmware versions (fetched by the main
  // process; `asked` = the user pressed Refresh, allowed with automatic checks off).
  officialControllerFirmware(asked: boolean): Promise<OfficialFirmwareLookup>;
  // "Match desktop" theme: the desktop's colors, and changes to them.
  getDesktopPalette(): Promise<DesktopPalette | null>;
  onDesktopPalette(listener: (palette: DesktopPalette | null) => void): () => void;
  // The window was shown or hidden (tray, minimize). Chromium's own visibility
  // stays "visible" while hidden here (background throttling is off).
  onWindowVisible(listener: (visible: boolean) => void): () => void;
  // Exactly the firmware shown (`latest` from latestFirmware), verified.
  downloadFirmware(shown: LatestFirmware): Promise<FirmwareDownload>;
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
  gamesRunningLaunchers(): Promise<LauncherId[]>; // a fresh process check (the review asks when it opens)
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
  // Dev builds only: Developer card → Fake games (a release has no handler, so it rejects).
  devFakeGames?(change: DevFakeGamesChange): Promise<DevFakeGamesState>;
  // Share your OLED: the PNG or GIF the page made, saved where the user picks
  // in the system save dialog (the page never names a path), or a PNG put on
  // the clipboard. The main process checks the format and size (oledShare.ts).
  saveOledImage(image: { kind: "png" | "gif"; bytes: Uint8Array }): Promise<SaveOledResult>;
  copyOledImage(png: Uint8Array): Promise<void>;
}

// error: SHOWN — desktop.oledShare.saved; a cancel shows nothing; a failed write rejects (desktop.oledShare.errors.save)
export type SaveOledResult = { saved: true; name: string } | { saved: false };

// A program that has the board open: this app's other copy (the installed app,
// a dev copy), a browser (a tab with a WebUSB page), or another program by name.
export type BoardHolderKind = "app" | "browser" | "other";
export interface BoardHolder {
  pid: number;
  name: string;
  kind: BoardHolderKind;
}

export const IPC = {
  reportStatus: "desktop:report-status",
  setTrayIcon: "desktop:set-tray-icon",
  trayCommand: "desktop:tray-command",
  showError: "desktop:show-error",
  showNotice: "desktop:show-notice",
  headsetSwitched: "desktop:headset-switched",
  headsetUndo: "desktop:headset-undo",
  headsetHint: "desktop:headset-hint",
  getSettings: "desktop:get-settings",
  recoveredFiles: "desktop:recovered-files",
  setSetting: "desktop:set-setting",
  usbAccessInstalled: "desktop:usb-access-installed",
  boardHolders: "desktop:board-holders",
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
  desktopPalette: "desktop:desktop-palette",
  windowVisible: "desktop:window-visible",
  setupUsbAccess: "desktop:setup-usb-access",
  repairWindowsUsb: "desktop:repair-windows-usb",
  gamesScan: "desktop:games-scan",
  gamesApply: "desktop:games-apply",
  gamesUndo: "desktop:games-undo",
  gamesBackups: "desktop:games-backups",
  gamesRunningLaunchers: "desktop:games-running-launchers",
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
  devFakeGames: "desktop:dev-fake-games",
  saveOledImage: "desktop:save-oled-image",
  copyOledImage: "desktop:copy-oled-image",
} as const;

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop !== undefined;
}
