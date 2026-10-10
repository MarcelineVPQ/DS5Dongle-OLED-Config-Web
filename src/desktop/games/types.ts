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

export interface Fix {
  id: string; // stable within one scan; the renderer sends these back
  kind: FixKind;
  launcher: LauncherId | "system";
  label: string; // plain-language description of the exact change
  why: string; // plain-language reason, shown next to the change: nothing is applied unexplained
  files: string[]; // every file this fix writes (backed up first), shown on the review screen
  recommended: boolean; // pre-ticked; still nothing happens until the user reviews and presses Apply
}

export interface GameEntry {
  key: string; // `${launcher}:${store}:${id}`
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
  proAudioRules: string[]; // config files forcing pro-audio
  envWarnings: string[]; // e.g. "PROTON_PREFER_SDL set in ~/.profile"
  hidrawAccess: boolean | null;
  fixes: Fix[];
}

export interface GamesReport {
  ourProton: { name: string | null; latest: string | null; updateAvailable: boolean };
  launchers: LauncherInfo[];
  games: GameEntry[];
  system: SystemInfo;
  scannedAt: string;
}

export interface ApplyResult {
  applied: Array<{ id: string; ok: boolean; message?: string }>;
  backupId: string | null;
  blockedBy: LauncherId[]; // launchers that must be closed first
}
