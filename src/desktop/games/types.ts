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
  | "audio-volume" // Linux: the controller's hardware volume and mic gain (ALSA) to full
  | "standard-gamepad" // XInput-only game: PROTON_PREFER_SDL=1 (and a Proton that honours it)
  | "hdr-on" // HDR game: run it inside gamescope with HDR (and move it to our Proton); also replaces the old PROTON_ENABLE_WAYLAND/HDR variant
  | "graphics-mode"; // start the game in DirectX 12 / Vulkan with its own game argument (knownGames.ts MODES)

// Graphics modes a game argument can start a game in, and what a mode unlocks.
export type GraphicsApi = "dx12" | "vulkan";
export type Unlock = "rayTracing" | "frameGen";

// A game that needs another graphics mode for a feature (all platforms):
//   set      its arguments start it in that mode
//   needed   a fix adds the flag
//   own      the player's own arguments pick another mode (e.g. -dx11): left alone
export interface ModeInfo {
  state: "set" | "needed" | "own";
  api: GraphicsApi;
  flag: string;
  unlocks: Unlock;
  own?: string; // the player's own mode flag ("own")
}

// An XInput-only game (our list, or the player marked "controller not
// detected"): is the controller passed to it as a standard gamepad?
//   set          PROTON_PREFER_SDL=1, with a Proton that honours it
//   needed       a standard-gamepad fix is offered
//   steam-input  Steam Input isn't off for it: Steam already gives it an Xbox pad
//   no-build     its Proton ignores the option and no build that honours it is installed
export type GamepadState = "set" | "needed" | "steam-input" | "no-build";

// An HDR game (our list, or the player ticked "Supports HDR"): does it run
// inside gamescope with HDR (`gamescope --backend wayland --hdr-enabled …`)?
//   set      a gamescope line with --hdr-enabled is there (ours or written by hand)
//   needed   a "Turn on HDR" fix is offered
//   update   it still has the old PROTON_ENABLE_WAYLAND / PROTON_ENABLE_HDR
//            variant (black screen): a fix moves it to gamescope, or only
//            removes the old variant while this computer can't run it yet
//   missing  this computer doesn't meet the requirements yet (the checklist says which)
export type HdrState = "set" | "needed" | "update" | "missing";

// The desktop, as far as HDR is concerned:
//   kde            KDE Plasma (Wayland), read with kscreen-doctor
//   gnome          GNOME (Wayland), read from Mutter's DisplayConfig (GNOME 48+)
//   other-desktop  no read-only check for this desktop: HDR isn't offered
//   x11            not a Wayland session
//   failed         the screen check didn't answer
//   unchecked      not checked (Windows)
export type HdrDesktop = "kde" | "gnome" | "other-desktop" | "x11" | "failed" | "unchecked";

// A connected, enabled screen and its current mode (portrait screens swapped).
export interface HdrScreen {
  name: string; // connector, e.g. DP-5
  hdr: boolean; // the desktop runs it in HDR right now
  width: number;
  height: number;
  refresh: number;
}

// What this computer has for HDR in games (read-only check, Linux).
export interface HdrSystem {
  check: HdrDesktop;
  screens: HdrScreen[];
  gamescope: {
    path: string | null; // on PATH, null = not installed
    version: string | null; // from `gamescope --version`, null = unknown
    min: string; // the oldest that works on this desktop
    layer: boolean; // its WSI Vulkan layer is installed
    flatpak: boolean; // the Flatpak extension (for Flatpak launchers) is installed
  };
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
  mode?: ModeInfo; // games that need another graphics mode for a feature
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
  hdr: HdrSystem;
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
  // error: SHOWN — desktop.library.setupFailed (and each change's message in the Done list)
  applied: Array<{ id: string; ok: boolean; message?: Msg }>;
  backupId: string | null;
  // Running launchers that own a selected change: not in the request's
  // `restart` list (the page explains and asks again), or not closed (`problem`).
  // error: SHOWN — desktop.games.launcherStarted (useRestartText names the launcher)
  blockedBy: LauncherId[];
  // error: SHOWN — desktop.games.restartGameRunning (or restartTimeout / restartFailed)
  problem?: CloseProblem;
  reopenFailed?: LauncherId[]; // closed for the change, but couldn't be started again
}

// Apply or undo, with the running launchers the page told the user it will
// close and reopen (Steam, Heroic and Lutris rewrite their settings on quit).
export type RestartList = Array<"steam" | "heroic" | "lutris">;

// A scanned game's artwork, served by the main process (ds5-art://, see
// electron/main/games/artRequest.ts), downscaled to the width it is shown
// at: `shown` is that width in CSS pixels, times the screen's pixel ratio,
// rounded up to one of ART_WIDTHS (the main process accepts only those and
// never scales up). Without `shown`, or wider than the largest, the file as
// it is. Decoded art costs width x height x 4 bytes in the page and the GPU,
// so a 600x900 cover shown 150 px wide is 2 MB for nothing.
export const ART_WIDTHS = [64, 128, 192, 256, 320, 384, 512, 640, 768, 1024, 1280, 1600, 1920, 2560, 3840] as const;
export type ArtWidth = (typeof ART_WIDTHS)[number];

export function artWidth(shown: number, ratio = 1): ArtWidth | null {
  const px = Math.ceil(shown * (ratio > 0 ? ratio : 1));
  // loop: NOT-WORTH — N = 15 widths, once per art URL
  return ART_WIDTHS.find((w) => w >= px) ?? null;
}

export function artUrl(key: string, kind: ArtKind, shown?: number, ratio = globalThis.devicePixelRatio ?? 1): string {
  const base = `ds5-art://art/${encodeURIComponent(key)}/${kind}`;
  const w = shown && shown > 0 ? artWidth(shown, ratio) : null;
  return w ? `${base}?w=${w}` : base;
}

// How wide each place shows art, in CSS pixels (desktop.css). The wide
// headers stretch with the window, so they ask for the screen's width.
const screenWidth = (): number => Math.max(globalThis.screen?.availWidth ?? 0, globalThis.innerWidth ?? 0) || 1920;
export const ART_SHOWN = {
  rowIcon: () => 20, // .lib-row img: 20 x 20
  tile: () => 256, // .lib-grid columns: minmax(124px, 1fr), so under 2 x 124 + gap
  logo: () => 360, // .gp-logo: at most 360 px wide (Continue playing: 320)
  tallCover: () => 300, // .gp-hero.tall: the cover at the header's height (up to 450 px tall)
  continueSide: () => screenWidth() / 3, // Continue playing's side tiles: at most a third of the page
  wide: screenWidth, // .gp-hero: the window's width (cover-sized)
} as const;

// Every fix in a report: what the Games page lists and Home counts as recommended changes.
export function allFixes(r: GamesReport): Fix[] {
  // loop: HOT-PATH-OK — N = games (hundreds) + 3 launchers; memoized per scan report
  return [...r.launchers.flatMap((l) => l.fixes), ...r.system.fixes, ...r.games.flatMap((g) => g.fixes)];
}
