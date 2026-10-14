// Games → Home's inputs, faked: a library of 30 games across Steam, Heroic
// and Lutris (or Steam, GOG Galaxy and Epic on Windows) with play history,
// five controller profiles, and this computer's scan, healthy or with
// something waiting (a recommended change and an HDR ✗ with an HDR game in
// the library). Used by the Home tests and, for screenshots, by a throwaway
// harness page (artwork there is generated, never a real library's).
import type { Fix, GameEntry, GameInfo, GamesReport, LauncherInfo } from "../../src/desktop/games/types";
import type { LibraryFile } from "../../src/desktop/games/library";
import type { GameBackup } from "../../src/desktop/api";
import { fakeDesktop, HDR_NO_LAYER, HDR_READY, OUR_PROTON } from "./gamePage";

export type HomeCase = "healthy" | "attention" | "windows";

const TITLES: Array<[string, GameEntry["launcher"], GameEntry["store"], GameEntry["support"]]> = [
  ["Astro Bot Rescue Run", "steam", "steam", "triggers"],
  ["Cyberpunk 2077", "heroic", "gog", "triggers"],
  ["Ghostrunner", "steam", "steam", "xinput"],
  ["Returnal", "steam", "steam", "triggers"],
  ["Ratchet & Clank: Rift Apart", "steam", "steam", "triggers"],
  ["Death Stranding", "steam", "steam", "haptics"],
  ["Control", "heroic", "epic", "xinput"],
  ["The Last of Us Part I", "steam", "steam", "triggers"],
  ["Hades II", "steam", "steam", "unknown"],
  ["Hollow Knight", "lutris", "gog", "unknown"],
  ["Alan Wake 2", "heroic", "epic", "unknown"],
  ["Spider-Man 2", "steam", "steam", "triggers"],
  ["Elden Ring", "steam", "steam", "unknown"],
  ["Metro Exodus", "steam", "steam", "triggers"],
  ["Portal 2", "steam", "steam", "unknown"],
  ["The Witcher 3", "heroic", "gog", "unknown"],
  ["Forza Horizon 5", "steam", "steam", "haptics"],
  ["Celeste", "lutris", "sideload", "unknown"],
  ["Deathloop", "steam", "steam", "triggers"],
  ["Indiana Jones and the Great Circle", "steam", "steam", "haptics"],
  ["Stellar Blade", "steam", "steam", "triggers"],
  ["Hogwarts Legacy", "heroic", "epic", "triggers"],
  ["Doom Eternal", "steam", "steam", "unknown"],
  ["Sifu", "heroic", "epic", "unknown"],
  ["Tunic", "steam", "steam", "unknown"],
  ["Ghostrunner 2", "steam", "steam", "xinput"],
  ["Black Myth: Wukong", "steam", "steam", "haptics"],
  ["Outer Wilds", "steam", "steam", "unknown"],
  ["Disco Elysium", "heroic", "gog", "unknown"],
  ["Ori and the Will of the Wisps", "steam", "steam", "unknown"],
];
// Played most recently first (index into TITLES), and the ones with a profile.
const RECENT = [1, 0, 2, 3, 19, 5, 4, 6];
const PROFILES = [0, 1, 3, 5, 11];
const NO_ART = [17, 27]; // the art fallback (title on the panel)
const HDR_GAME = 19; // Indiana Jones: an HDR game on our list
const NOW = 1_760_300_000;

const keyOf = (i: number, launcher: GameEntry["launcher"], store: GameEntry["store"]) => `${launcher}-0000abcd:${store}:${1000 + i}`;

// The Windows launchers: Steam stays Steam, Heroic's GOG/Epic games are GOG Galaxy / Epic Games there.
const winLauncher = (l: GameEntry["launcher"], store: GameEntry["store"]): GameEntry["launcher"] => (l === "steam" ? "steam" : store === "gog" ? "gog" : "epic");

export function homeGames(kase: HomeCase): GameEntry[] {
  const win = kase === "windows";
  return TITLES.map(([title, launcher0, store0, support], i) => {
    const launcher = win ? winLauncher(launcher0, store0) : launcher0;
    const store = win && store0 === "sideload" ? "gog" : store0;
    return {
      key: keyOf(i, launcher, store),
      launcher,
      store,
      id: String(1000 + i),
      title,
      runner: win ? null : OUR_PROTON,
      runnerMissing: false,
      usesOurProton: !win,
      envFlags: [],
      support,
      fixes: [],
      ...(i === HDR_GAME && !win ? { hdr: kase === "attention" ? ("missing" as const) : ("set" as const) } : {}),
    };
  });
}

export function homeDetails(games: GameEntry[]): Record<string, GameInfo> {
  return Object.fromEntries(
    games.map((g, i) => {
      const r = RECENT.indexOf(i);
      return [
        g.key,
        {
          art: NO_ART.includes(i) ? [] : ["hero", "logo", "cover", "header", "icon"],
          playtimeMin: r >= 0 ? (RECENT.length - r) * 431 : i * 17,
          lastPlayed: r >= 0 ? NOW - r * 86_400 * 2 : undefined,
          actions: ["play", "installFolder"],
        } satisfies GameInfo,
      ];
    }),
  );
}

export function homeLibrary(games: GameEntry[]): LibraryFile {
  return {
    version: 1,
    games: Object.fromEntries(PROFILES.map((i) => [games[i].key, { title: games[i].title, profile: { settings: { format: 2, hapticsGain: 4 }, updated: 1_760_000_000_000 } }])),
  } as unknown as LibraryFile;
}

// A launcher-wide recommended change (Linux): our Proton as Steam's default.
export const STEAM_DEFAULT_FIX: Fix = {
  id: "steam-0000abcd:default",
  kind: "set-default",
  launcher: "steam",
  label: { key: "label.defaultSteam", params: { proton: OUR_PROTON } },
  why: { key: "why.defaultSteam", params: { current: "Proton 9.0" } },
  files: ["~/.local/share/Steam/config/config.vdf"],
  recommended: true,
};

const launcher = (id: LauncherInfo["id"], over: Partial<LauncherInfo> = {}): LauncherInfo => ({
  id,
  found: true,
  flatpak: false,
  running: false,
  protonInstalled: true,
  defaultRunner: OUR_PROTON,
  defaultIsOurs: true,
  fixes: [],
  ...over,
});

export function homeReport(kase: HomeCase): GamesReport {
  const games = homeGames(kase);
  const win = kase === "windows";
  const attention = kase === "attention";
  return {
    ourProton: win ? { name: null, latest: null, latestSize: null, updateAvailable: false } : { name: OUR_PROTON, latest: OUR_PROTON, latestSize: null, updateAvailable: false },
    launchers: win
      ? [
          launcher("steam", { protonInstalled: false, defaultRunner: null, defaultIsOurs: false }),
          launcher("gog", { protonInstalled: false, defaultRunner: null, defaultIsOurs: false }),
          launcher("epic", { protonInstalled: false, defaultRunner: null, defaultIsOurs: false }),
        ]
      : [launcher("steam", attention ? { running: true, defaultRunner: "proton_9", defaultIsOurs: false, fixes: [STEAM_DEFAULT_FIX] } : {}), launcher("heroic"), launcher("lutris")],
    games,
    system: {
      audioProfile: win ? null : "output:analog-stereo+input:mono-fallback",
      proAudio: false,
      proAudioRules: [],
      envWarnings: [],
      hidrawAccess: win ? null : true,
      hdr: win
        ? { check: "unchecked", screens: [], gamescope: { path: null, version: null, min: "3.15.0", layer: false, flatpak: false } }
        : attention
          ? withScreen(HDR_NO_LAYER)
          : withScreen(HDR_READY),
      fixes: [],
    },
    scannedAt: "2026-10-13T00:00:00Z",
  };
}

const withScreen = (h: typeof HDR_READY): typeof HDR_READY => ({ ...h, screens: [{ ...h.screens[0], name: "DP-5" }] });

// One earlier change, so Change history has an entry to undo.
export const HOME_BACKUP: GameBackup = {
  id: "b1",
  created: "2026-10-12T19:30:00Z",
  changes: [{ key: "label.defaultHeroic", params: { proton: OUR_PROTON } }],
  files: ["~/.config/heroic/config.json"],
};

// window.desktop for Home: the scan, the details and the history answered
// (each call recorded), the rest as for the game page.
export function homeDesktop(kase: HomeCase, calls: string[] = [], report: GamesReport = homeReport(kase)): Record<string, unknown> {
  const base = fakeDesktop(kase === "windows" ? "win32" : "linux", calls) as Record<string, unknown>;
  const known: Record<string, unknown> = {
    gamesScan: () => (calls.push("gamesScan"), Promise.resolve(report)),
    gamesDetails: () => Promise.resolve(homeDetails(report.games)),
    gamesBackups: () => Promise.resolve([HOME_BACKUP]),
    gamesRunningLaunchers: () => Promise.resolve(report.launchers.filter((l) => l.running).map((l) => l.id)),
    gameAction: (a: { gameKey: string; action: string }) => (calls.push(`gameAction ${a.action} ${a.gameKey}`), Promise.resolve(true)),
    installProton: () => (calls.push("installProton"), Promise.resolve({ ok: true, name: OUR_PROTON, installed: [] })),
    gamesUndo: (a: { backupId: string }) => (calls.push(`gamesUndo ${a.backupId}`), Promise.resolve({ ok: true })),
  };
  return new Proxy(known, { get: (t, p: string) => (p in t ? t[p] : base[p]) });
}
