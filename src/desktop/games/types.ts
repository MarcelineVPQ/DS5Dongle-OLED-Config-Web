// Games page data model, shared by the main process (scanner/fixer) and the
// renderer (display). The renderer only ever sends back fix ids.
//
// Consent model: a scan only reads. Every change is a Fix with a plain-language
// label and reason; the user ticks fixes, sees a review of every file to be
// written, and confirms. Closing a launcher and downloading Proton are separate
// explicit confirmations. Every write is backed up and can be undone.

export type LauncherId = "steam" | "heroic" | "lutris" | "gog" | "epic"; // gog / epic: GOG Galaxy and the Epic Games Launcher on Windows
export type Store = "steam" | "epic" | "gog" | "amazon" | "sideload" | "lutris";
export type DualSenseSupport = "triggers" | "haptics" | "xinput" | "unknown";

export type FixKind =
  | "set-default" // make our Proton the launcher's default
  | "set-runner" // point this game at our Proton
  | "steam-input-off" // per-game Steam Input off (Steam)
  | "remove-env" // drop PROTON_PREFER_SDL from the game's env / launch options
  | "audio-hifi" // disable a pro-audio rule for the DualSense
  | "standard-gamepad" // XInput-only game: PROTON_PREFER_SDL=1 (and a Proton that honours it)
  | "hdr-on"; // HDR game, HDR screen: PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 (and a Proton that honours them)

// An XInput-only game (our list, or the player marked "controller not
// detected"): is the controller passed to it as a standard gamepad?
//   set          PROTON_PREFER_SDL=1, with a Proton that honours it
//   needed       a standard-gamepad fix is offered
//   steam-input  Steam Input isn't off for it: Steam already gives it an Xbox pad
//   no-build     its Proton ignores the option and no build that honours it is installed
export type GamepadState = "set" | "needed" | "steam-input" | "no-build";

// An HDR game (our list, or the player ticked "Supports HDR"): does it run
// with HDR (a native Wayland window, PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1)?
//   set          both options set, with a Proton that honours them
//   needed       a "Turn on HDR" fix is offered
//   no-screen    no screen has HDR on right now (or it can't be checked): not offered
//   no-build     its Proton ignores the options and none that honours them is installed
//   pick-runner  Steam: the game follows Steam's default Proton, which ignores them;
//                the player picks a Proton for it (it may be a native Linux game)
export type HdrState = "set" | "needed" | "no-screen" | "no-build" | "pick-runner";

// The desktop's HDR screens right now (read-only check, Linux):
//   kde            KDE Plasma (Wayland), read with kscreen-doctor; `outputs` = screens with HDR on
//   other-desktop  no read-only check for this desktop: HDR isn't offered
//   x11            not a Wayland session: Proton can't run games as Wayland windows
//   failed         kscreen-doctor didn't answer
//   unchecked      not checked (Windows)
export interface HdrScreens {
  check: "kde" | "other-desktop" | "x11" | "failed" | "unchecked";
  outputs: string[];
}

// A translatable message: the renderer looks up `desktop.games.msg.<key>`
// and fills in params (a param can itself be a message, e.g. "no default").
export interface Msg {
  key: string;
  params?: Record<string, string | Msg>;
}

export interface Fix {
  id: string; // derived from the target (install root / file path), so it resolves to the same target in a later scan
  kind: FixKind;
  launcher: LauncherId | "system";
  label: Msg; // plain-language description of the exact change
  why: Msg; // plain-language reason, shown next to the change: nothing is applied unexplained
  files: string[]; // every file this fix writes (backed up first), shown on the review screen
  recommended: boolean; // pre-ticked; still nothing happens until the user reviews and presses Apply
}

export interface GameEntry {
  key: string; // `<launcher>-<install hash>:<store>:<id>`, unique per install
  launcher: LauncherId;
  store: Store;
  id: string;
  title: string;
  runner: string | null; // runner / compat tool name, null = launcher default
  runnerMissing: boolean; // configured runner no longer exists on disk
  usesOurProton: boolean;
  steamInput?: "off" | "global" | "on"; // Steam only
  envFlags: string[]; // e.g. ["PROTON_PREFER_SDL"]
  support: DualSenseSupport;
  gamepad?: GamepadState; // XInput-only games (Linux) only
  hdr?: HdrState; // HDR games (Linux) only
  fixes: Fix[];
  // What the launcher says it is (Steam's own categories); absent = a game.
  kind?: AppKind;
}

export const APP_KINDS = ["game", "demo", "dlc", "music", "tool", "application", "video"] as const;
export type AppKind = (typeof APP_KINDS)[number];

// Local artwork a game has (the files stay in the main process; the page
// loads them through ds5-art://<game key>/<kind>).
export type ArtKind = "hero" | "logo" | "cover" | "header" | "icon";

// What the launchers keep on disk about a game (Games library page).
// Game page actions (electron/main/games/actions.ts builds what they open).
export const GAME_ACTIONS = ["play", "properties", "steamInput", "libraryPage", "installFolder", "prefixFolder"] as const;
export type GameAction = (typeof GAME_ACTIONS)[number];

export interface GameInfo {
  installDir?: string;
  sizeBytes?: number;
  playtimeMin?: number;
  lastPlayed?: number; // unix seconds
  lastUpdated?: number; // unix seconds
  buildId?: string; // Steam: changes with every game update
  art: ArtKind[];
  actions?: GameAction[]; // filled in by the games service
}

export interface LauncherInfo {
  id: LauncherId;
  found: boolean;
  flatpak: boolean;
  running: boolean;
  protonInstalled: boolean; // our build is visible to this launcher
  defaultRunner: string | null;
  defaultIsOurs: boolean;
  fixes: Fix[];
}

export interface SystemInfo {
  audioProfile: string | null; // DualSense card's active profile, null if not present
  proAudio: boolean; // that profile breaks GE-Proton 11 haptics/triggers
  proAudioRules: string[]; // config files forcing pro-audio
  envWarnings: Array<{ variable: string; file: string | null }>; // file null = this session's environment
  hidrawAccess: boolean | null;
  hdr: HdrScreens;
  fixes: Fix[];
}

export interface GamesReport {
  ourProton: { name: string | null; latest: string | null; latestSize: number | null; updateAvailable: boolean };
  launchers: LauncherInfo[];
  games: GameEntry[];
  system: SystemInfo;
  scannedAt: string;
}

// Why a running launcher wasn't closed for a change (nothing was written).
export type CloseProblem = "game-running" | "timeout" | "failed";

export interface ApplyResult {
  applied: Array<{ id: string; ok: boolean; message?: Msg }>;
  backupId: string | null;
  // Running launchers that own a selected change: not in the request's
  // `restart` list (the page explains and asks again), or not closed (`problem`).
  blockedBy: LauncherId[];
  problem?: CloseProblem;
  reopenFailed?: LauncherId[]; // closed for the change, but couldn't be started again
}

// Apply or undo, with the running launchers the page told the user it will
// close and reopen (Steam, Heroic and Lutris rewrite their settings on quit).
export type RestartList = Array<"steam" | "heroic" | "lutris">;

// A scanned game's artwork, served by the main process (ds5-art://, see
// electron/main/games/artRequest.ts).
export const artUrl = (key: string, kind: ArtKind) => `ds5-art://art/${encodeURIComponent(key)}/${kind}`;
