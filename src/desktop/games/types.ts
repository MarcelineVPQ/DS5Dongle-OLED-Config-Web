// Games page data model, shared by the main process (scanner/fixer) and the
// renderer (display). The renderer only ever sends back fix ids.
//
// Consent model: a scan only reads. Every change is a Fix with a plain-language
// label and reason; the user ticks fixes, sees a review of every file to be
// written, and confirms. Closing a launcher and downloading Proton are separate
// explicit confirmations. Every write is backed up and can be undone.

export type LauncherId = "steam" | "heroic" | "lutris";
export type Store = "steam" | "epic" | "gog" | "amazon" | "sideload" | "lutris";
export type DualSenseSupport = "triggers" | "haptics" | "xinput" | "unknown";

export type FixKind =
  | "set-default" // make our Proton the launcher's default
  | "set-runner" // point this game at our Proton
  | "steam-input-off" // per-game Steam Input off (Steam)
  | "remove-env" // drop PROTON_PREFER_SDL from the game's env / launch options
  | "audio-hifi"; // disable a pro-audio rule for the DualSense

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
  fixes: Fix[];
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
  fixes: Fix[];
}

export interface GamesReport {
  ourProton: { name: string | null; latest: string | null; latestSize: number | null; updateAvailable: boolean };
  launchers: LauncherInfo[];
  games: GameEntry[];
  system: SystemInfo;
  scannedAt: string;
}

export interface ApplyResult {
  applied: Array<{ id: string; ok: boolean; message?: Msg }>;
  backupId: string | null;
  blockedBy: LauncherId[]; // launchers that must be closed first
}
