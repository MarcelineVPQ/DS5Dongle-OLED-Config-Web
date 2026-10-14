// A game page's inputs, faked: Ghostrunner (an XInput-only game that wants
// DirectX 12 for Ray Tracing, marked Supports HDR) on Steam, fully set up or
// with setup waiting, plus this computer's HDR and a scan report. Used by the
// game page tests and, for screenshots, by a throwaway harness page.
import { DEFAULT_CONFIG } from "../../src/protocol/config";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import type { Fix, GameEntry, GameInfo, GamesReport, HdrSystem } from "../../src/desktop/games/types";
import type { GameRecord } from "../../src/desktop/games/library";

export const OUR_PROTON = "GE-Proton11-7.2-DualSense";
const KEY = "steam-0000abcd:steam:1997030";

export const HDR_READY: HdrSystem = {
  check: "kde",
  screens: [{ name: "DP-1", hdr: true, width: 3840, height: 2160, refresh: 144 }],
  gamescope: { path: "/usr/bin/gamescope", version: "3.16.14", min: "3.15.0", layer: true, flatpak: false },
};
// gamescope installed without its HDR Vulkan layer: the checklist has a ✗.
export const HDR_NO_LAYER: HdrSystem = { ...HDR_READY, gamescope: { ...HDR_READY.gamescope, layer: false } };

const modeFix: Fix = {
  id: `${KEY}:mode`,
  kind: "graphics-mode",
  launcher: "steam",
  label: { key: "label.mode", params: { game: "Ghostrunner", api: "DirectX 12", feature: { key: "unlock.rayTracing" }, flag: "-dx12" } },
  why: {
    key: "why.modeSteam",
    params: { game: "Ghostrunner", api: "DirectX 12", feature: { key: "unlock.rayTracing" }, flag: "-dx12", args: "%command% -dx12", proton: { key: "why.modeVkd3d" } },
  },
  files: ["~/.local/share/Steam/userdata/1/config/localconfig.vdf"],
  recommended: true,
};

// Everything done: no fixes, standard gamepad set, DirectX 12 set, HDR set.
export function ghostrunner(over: Partial<GameEntry> = {}): GameEntry {
  return {
    key: KEY,
    launcher: "steam",
    store: "steam",
    id: "1997030",
    title: "Ghostrunner",
    runner: OUR_PROTON,
    runnerMissing: false,
    usesOurProton: true,
    steamInput: "off",
    envFlags: ["PROTON_PREFER_SDL"],
    support: "xinput",
    gamepad: "set",
    hdr: "set",
    mode: { state: "set", api: "dx12", flag: "-dx12", unlocks: "rayTracing" },
    fixes: [],
    ...over,
  };
}

// Setup waiting: DirectX 12 still to add, HDR missing its layer.
export const ghostrunnerNeedsSetup = () => ghostrunner({ hdr: "missing", mode: { state: "needed", api: "dx12", flag: "-dx12", unlocks: "rayTracing" }, fixes: [modeFix] });

export const GHOSTRUNNER_INFO: GameInfo = {
  installDir: "/home/player/.local/share/Steam/steamapps/common/Ghostrunner",
  sizeBytes: 23_400_000_000,
  playtimeMin: 852,
  lastPlayed: 1_760_200_000,
  lastUpdated: 1_759_000_000,
  buildId: "1000",
  art: [],
  actions: ["play", "properties", "steamInput", "libraryPage", "installFolder", "prefixFolder"],
};

export const GHOSTRUNNER_RECORD: GameRecord = {
  title: "Ghostrunner",
  profile: { settings: { format: 2, hapticsGain: 4, speakerVolume: -6 }, updated: 1_760_000_000_000 },
  mine: { rating: 4, tags: ["haptics-work", "weak-vibration"], hdr: true, notes: "Ray Tracing needs -dx12." },
} as GameRecord;

export function gamesReport(game: GameEntry, hdr: HdrSystem = HDR_READY): GamesReport {
  return {
    ourProton: { name: OUR_PROTON, latest: OUR_PROTON, latestSize: null, updateAvailable: false },
    launchers: [{ id: "steam", found: true, flatpak: false, running: false, protonInstalled: true, defaultRunner: OUR_PROTON, defaultIsOurs: true, fixes: [] }],
    games: [game],
    system: { audioProfile: "output:analog-stereo+input:mono-fallback", proAudio: false, proAudioRules: [], envWarnings: [], hidrawAccess: true, hdr, fixes: [] },
    scannedAt: "2026-10-13T00:00:00Z",
  };
}

// A connected board with the default settings (no client calls are made by the page).
export const fakeBridge = (): UseDs5BridgeResult =>
  ({ config: DEFAULT_CONFIG, draft: DEFAULT_CONFIG, isConnected: true, client: { splitHaptics: false }, identity: null, issues: [] }) as unknown as UseDs5BridgeResult;

// window.desktop for the game page: its calls answered, anything else a
// no-op (listeners return an unsubscribe, the rest resolve to {}).
export function fakeDesktop(platform: "linux" | "win32", calls: string[] = []): Record<string, unknown> {
  const library = { version: 1, games: {} };
  const known: Record<string, unknown> = {
    platform,
    appVersion: "1.0.0",
    gameArtColor: () => Promise.resolve(null),
    gamesRunningLaunchers: () => Promise.resolve([]),
    gamesApply: () => Promise.resolve({ applied: [], backupId: null, blockedBy: [] }),
    gameAction: () => Promise.resolve(true),
    librarySetProfile: () => Promise.resolve(library),
    libraryDeleteProfile: () => Promise.resolve(library),
    librarySetMine: (u: unknown) => (calls.push(`librarySetMine ${JSON.stringify(u)}`), Promise.resolve(library)),
  };
  return new Proxy(known, { get: (t, p: string) => (p in t ? t[p] : p.startsWith("on") ? () => () => undefined : () => Promise.resolve({})) });
}
