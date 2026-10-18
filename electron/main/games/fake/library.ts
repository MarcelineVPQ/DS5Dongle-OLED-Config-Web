// Developer card → Fake games: a made-up library for working on the Games UI
// without launchers, a board or a controller (dev builds only; fake/service.ts
// serves it instead of the real scan). Twenty-one games across Steam, Heroic (GOG,
// Epic, Amazon, sideloaded) and Lutris, chosen so every part of the Games
// pages has something to show: each DualSense support tier the app assigns,
// setup that is all set or needs attention (with fixes worded exactly like the
// real scanner's), HDR in every state, graphics modes, our Proton / an older
// GE-Proton / a runner that's gone, running and closed launchers.
//
// Pure state: a report is built from it the way games.ts builds one from the
// launchers' files, and Apply / Undo change only this in-memory state. No file
// here is ever read or written: the paths in fixes are only shown on the review.
import { availableActions } from "../actions";
import { byPick, gameStates, idHash, msg, supportMsg } from "../games";
import { dualSenseSupport, graphicsMode, knownHdr } from "../../../../src/desktop/games/knownGames";
import { API_NAME, modeInfo, withArg } from "../../../../src/desktop/games/gameArgs";
import { NO_HDR_SYSTEM, runsGamescope } from "../../../../src/desktop/games/hdrSetup";
import { PROTON_NAME } from "../../../../src/update/manifest";
import type { FakeGamesHdr, GameBackup, UndoResult } from "../../../../src/desktop/api";
import type {
  AppKind,
  ApplyResult,
  ArtKind,
  DualSenseSupport,
  Fix,
  FixKind,
  GameEntry,
  GameInfo,
  GamepadState,
  GamesReport,
  HdrState,
  HdrSystem,
  LauncherId,
  LauncherInfo,
  ModeInfo,
  Msg,
  ProtonChoice,
  RestartList,
  Store,
} from "../../../../src/desktop/games/types";

export const OUR_PROTON = "GE-Proton11-7-DualSense";
export const LATEST_PROTON = "GE-Proton11-10-DualSense";
export const OLD_GE = "GE-Proton9-27";
const PREFER_SDL = "PROTON_PREFER_SDL";

// Install hashes: the key prefix the real scan derives from an install root.
// Fixed and recognisable ("fa4e" = fake), so fake keys never match a real install.
export const FAKE_HASH = { steam: "fa4e5001", heroic: "fa4e5002", lutris: "fa4e5003" } as const;
type FakeLauncher = keyof typeof FAKE_HASH;

// What art a game has, at the sizes its store keeps:
//   steam  cover 600x900, hero 1920x620, header 460x215, logo, icon 32x32
//   small  cover 300x450 (GOG / Epic through Heroic), hero, logo, icon
//   cover  a cover only (Lutris)
//   none   nothing: the page's art fallback
export type ArtSet = "steam" | "small" | "cover" | "none";
export const ART_SIZES: Record<ArtSet, Partial<Record<ArtKind, [number, number]>>> = {
  steam: { cover: [600, 900], hero: [1920, 620], header: [460, 215], logo: [960, 360], icon: [32, 32] },
  small: { cover: [300, 450], hero: [1920, 620], logo: [960, 360], icon: [32, 32] },
  cover: { cover: [600, 900] },
  none: {},
};

export interface FakeGameDef {
  title: string;
  launcher: FakeLauncher;
  store: Store;
  id: string;
  runner: string | null; // null = the launcher's default
  runnerMissing?: boolean; // the configured runner is no longer installed
  steamInput?: "off" | "global" | "on";
  envFlags?: string[];
  gamepad?: GamepadState; // XInput-only games
  hdr?: HdrState; // HDR games (Linux)
  args?: string; // launch options / game arguments (graphics mode)
  kind?: AppKind;
  art: ArtSet;
  playHours: number;
  lastPlayedHours?: number; // hours ago; absent = never played
  sizeGb: number;
}

const ST = (title: string, id: string, rest: Partial<FakeGameDef>): FakeGameDef => ({
  title,
  launcher: "steam",
  store: "steam",
  id,
  runner: OUR_PROTON,
  steamInput: "off",
  art: "steam",
  playHours: 0,
  sizeGb: 40,
  ...rest,
});
const HE = (title: string, store: Store, id: string, rest: Partial<FakeGameDef>): FakeGameDef => ({
  title,
  launcher: "heroic",
  store,
  id,
  runner: OUR_PROTON,
  art: "small",
  playHours: 0,
  sizeGb: 30,
  ...rest,
});
const LU = (title: string, id: string, rest: Partial<FakeGameDef>): FakeGameDef => ({
  title,
  launcher: "lutris",
  store: "lutris",
  id,
  runner: OUR_PROTON,
  art: "cover",
  playHours: 0,
  sizeGb: 25,
  ...rest,
});

// Built in a call marked pure, so a release build (no Fake games) leaves the list out.
export const FAKE_GAMES: readonly FakeGameDef[] = /* @__PURE__ */ (() => [
  // Steam
  ST("Cyberpunk 2077", "1091500", { hdr: "set", playHours: 132, lastPlayedHours: 2, sizeGb: 92 }),
  ST("The Last of Us Part I", "1888930", { runner: OLD_GE, hdr: "needed", playHours: 41, lastPlayedHours: 26, sizeGb: 79 }),
  ST("Marvel's Spider-Man Remastered", "1817070", { steamInput: "on", hdr: "update", envFlags: ["PROTON_ENABLE_HDR"], playHours: 18, lastPlayedHours: 75, sizeGb: 75 }),
  ST("Hogwarts Legacy", "990080", { hdr: "set", playHours: 64, lastPlayedHours: 52, sizeGb: 85 }),
  ST("Baldur's Gate 3", "1086940", { playHours: 210, lastPlayedHours: 120, sizeGb: 150 }),
  ST("Ghostrunner", "1139900", { gamepad: "needed", args: "", playHours: 9, lastPlayedHours: 400, sizeGb: 24 }),
  ST("Control", "870780", { gamepad: "set", envFlags: [PREFER_SDL], playHours: 22, sizeGb: 42 }),
  ST("Portal 2", "620", { runner: null, steamInput: "global", art: "none", playHours: 14, lastPlayedHours: 2000, sizeGb: 12 }),
  ST("Death Stranding", "1190460", { envFlags: [PREFER_SDL], hdr: "needed", playHours: 55, lastPlayedHours: 300, sizeGb: 64 }),
  ST("Neon Debris Demo", "3100420", { runner: null, kind: "demo", playHours: 1, sizeGb: 2 }),
  // Marcy's real case (2026-10-17): her own gamescope line, Steam Input on Steam's default: the game saw no controller.
  ST("Assetto Corsa Rally", "3917090", {
    steamInput: "global",
    args: "ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%",
    playHours: 4,
    lastPlayedHours: 1,
    sizeGb: 45,
  }),
  // Heroic: GOG, Epic, Amazon, sideloaded
  HE("The Witcher 3: Wild Hunt", "gog", "1207664663", { playHours: 80, lastPlayedHours: 210, sizeGb: 50 }),
  HE("Ghost of Tsushima", "epic", "Cowbell", { hdr: "set", playHours: 37, lastPlayedHours: 170, sizeGb: 75 }),
  HE("Avatar: Frontiers of Pandora", "amazon", "amzn1.adg.product.5f3c9a2e", { runner: "GE-Proton8-25", runnerMissing: true, hdr: "needed", playHours: 6, sizeGb: 90 }),
  HE("Star Wars Jedi: Survivor", "epic", "Pheasant", { runner: OLD_GE, hdr: "needed", playHours: 12, sizeGb: 140 }),
  HE("Sifu", "epic", "Mango", { playHours: 15, lastPlayedHours: 330, sizeGb: 20 }),
  HE("Hollow Wanderer", "sideload", "hollow-wanderer", { runner: "wine-ge-8-26", art: "cover", playHours: 3, sizeGb: 4 }),
  // Lutris
  LU("Metro Exodus", "metro-exodus", { runner: OLD_GE, playHours: 28, sizeGb: 80 }),
  LU("Dakar Desert Rally", "dakar-desert-rally", { runner: "lutris-GE-Proton8-26", runnerMissing: true, playHours: 2, sizeGb: 40 }),
  LU("Indiana Jones and the Great Circle", "indiana-jones-great-circle", { hdr: "set", playHours: 19, lastPlayedHours: 30, sizeGb: 120 }),
  LU("Maneater", "maneater", { playHours: 11, lastPlayedHours: 900, sizeGb: 18 }),
])();

export const fakeKey = (d: Pick<FakeGameDef, "launcher" | "store" | "id">): string => `${d.launcher}-${FAKE_HASH[d.launcher]}:${d.store}:${d.id}`;
export const isFakeKey = (key: string): boolean => /^(steam|heroic|lutris)-fa4e500[123]:/.test(key);

// ---- The changeable state ----
interface GameState {
  def: FakeGameDef;
  runner: string | null;
  runnerMissing: boolean;
  steamInput?: "off" | "global" | "on";
  envFlags: string[];
  gamepad?: GamepadState;
  hdr?: HdrState;
  args: string;
}
interface LauncherState {
  defaultRunner: string | null;
  flatpak: boolean;
}
export type FakeHdr = FakeGamesHdr;

export interface FakeState {
  games: Map<string, GameState>;
  launchers: Record<FakeLauncher, LauncherState>;
  volumeLow: boolean;
  ourProton: string;
  hdr: FakeHdr;
  running: Set<LauncherId>; // launchers shown as running
  backups: Array<GameBackup & { undo: Snapshot; owners: FakeLauncher[] }>;
}
interface Snapshot {
  games: Array<[string, GameState]>;
  launchers: FakeState["launchers"];
  volumeLow: boolean;
}

export function newFakeState(): FakeState {
  return {
    // loop: NOT-WORTH — 20 fake games, once when Fake games turns on
    games: new Map(
      FAKE_GAMES.map((d) => [
        fakeKey(d),
        { def: d, runner: d.runner, runnerMissing: !!d.runnerMissing, steamInput: d.steamInput, envFlags: [...(d.envFlags ?? [])], gamepad: d.gamepad, hdr: d.hdr, args: d.args ?? "" },
      ]),
    ),
    launchers: { steam: { defaultRunner: OLD_GE, flatpak: false }, heroic: { defaultRunner: OUR_PROTON, flatpak: true }, lutris: { defaultRunner: OUR_PROTON, flatpak: false } },
    volumeLow: true,
    ourProton: OUR_PROTON,
    hdr: "ready",
    running: new Set(["steam"]),
    backups: [],
  };
}

const snapshot = (s: FakeState): Snapshot => structuredClone({ games: [...s.games], launchers: s.launchers, volumeLow: s.volumeLow });

// ---- The report, as games.ts would build it ----
const native = (s: DualSenseSupport) => s === "triggers" || s === "haptics";
const LAUNCHER_FILES: Record<FakeLauncher, (id: string) => { runner: string; options: string }> = {
  steam: () => ({ runner: "~/.local/share/Steam/config/config.vdf", options: "~/.local/share/Steam/userdata/10000001/config/localconfig.vdf" }),
  heroic: (id) => ({ runner: `~/.var/app/com.heroicgameslauncher.hgl/config/heroic/GamesConfig/${id}.json`, options: `~/.var/app/com.heroicgameslauncher.hgl/config/heroic/GamesConfig/${id}.json` }),
  lutris: (id) => ({ runner: `~/.local/share/lutris/games/${id}-1760000000.yml`, options: `~/.local/share/lutris/games/${id}-1760000000.yml` }),
};
const DEFAULT_FILES: Record<FakeLauncher, string> = {
  steam: "~/.local/share/Steam/config/config.vdf",
  heroic: "~/.var/app/com.heroicgameslauncher.hgl/config/heroic/config.json",
  lutris: "~/.local/share/lutris/runners/wine.yml",
};
const LAUNCHER_LABEL: Record<FakeLauncher, string> = { steam: "Steam", heroic: "Heroic", lutris: "Lutris" };
// The builds each launcher offers in the game page's Proton version picker
// (besides our own): `name` is what the game's setting holds, `label` what the
// launcher shows (Steam maps Valve's own Protons by an internal name).
const FAKE_BUILDS: Record<FakeLauncher, Array<{ name: string; label: string }>> = {
  steam: [
    { name: OLD_GE, label: OLD_GE },
    { name: "proton_9", label: "Proton 9.0" },
    { name: "proton_experimental", label: "Proton - Experimental" },
  ],
  heroic: [
    { name: OLD_GE, label: OLD_GE },
    { name: "wine-ge-8-26", label: "wine-ge-8-26" },
  ],
  lutris: [
    { name: OLD_GE, label: OLD_GE },
    { name: "wine-ge-8-26", label: "wine-ge-8-26" },
    { name: "Proton - Experimental", label: "Proton - Experimental" },
  ],
};
const pickId = (prefix: string, gameId: string, build: string) => `${prefix}:proton:${gameId}:${idHash(build)}`;

export function hdrSystemOf(hdr: FakeHdr): HdrSystem {
  const screen = { name: "DP-1", hdr: hdr !== "hdr-off", width: 3840, height: 2160, refresh: 144 };
  return {
    ...NO_HDR_SYSTEM,
    check: "kde",
    screens: [screen, { name: "HDMI-A-1", hdr: false, width: 1920, height: 1080, refresh: 60 }],
    gamescope:
      hdr === "no-gamescope"
        ? { path: null, version: null, min: "3.15.0", layer: false, flatpak: false }
        : { path: "/usr/bin/gamescope", version: "3.16.20", min: "3.15.0", layer: true, flatpak: true },
  };
}

export interface ReportOptions {
  linux: boolean; // HDR and Proton are Linux things (the real scan leaves them out elsewhere)
  now: Date;
}

export function fakeReport(s: FakeState, opts: ReportOptions): GamesReport {
  const hdrReady = s.hdr === "ready";
  const games: GameEntry[] = [];
  // loop: NOT-WORTH — 20 fake games, once per (fake) scan
  for (const [key, g] of s.games) games.push(entryOf(key, g, s, opts.linux, hdrReady));
  // loop: NOT-WORTH — 3 fake launchers, once per (fake) scan
  const launchers: LauncherInfo[] = (Object.keys(FAKE_HASH) as FakeLauncher[]).map((id) => {
    const l = s.launchers[id];
    const ours = l.defaultRunner !== null && PROTON_NAME.test(l.defaultRunner);
    const fixes: Fix[] =
      opts.linux && !ours
        ? [
            {
              id: `${id}-${FAKE_HASH[id]}:default`,
              kind: "set-default",
              launcher: id,
              label: msg(`label.default${LAUNCHER_LABEL[id]}`, { proton: s.ourProton }),
              why: msg(`why.default${LAUNCHER_LABEL[id]}`, { current: l.defaultRunner ?? msg("fallback.none") }),
              files: [DEFAULT_FILES[id]],
              recommended: true,
            },
          ]
        : [];
    return { id, found: true, flatpak: l.flatpak, running: s.running.has(id), protonInstalled: true, defaultRunner: l.defaultRunner, defaultIsOurs: ours, fixes };
  });
  const systemFixes: Fix[] =
    opts.linux && s.volumeLow
      ? [{ id: "system:audio-volume:fa4e5004", kind: "audio-volume", launcher: "system", label: msg("label.audioVolume"), why: msg("why.audioVolume"), files: [], recommended: true }]
      : [];
  return {
    ourProton: { name: s.ourProton, latest: LATEST_PROTON, latestSize: 512 * 1024 * 1024, updateAvailable: s.ourProton !== LATEST_PROTON },
    launchers,
    games,
    system: {
      audioProfile: "output:analog-stereo+input:mono-fallback",
      proAudio: false,
      proAudioRules: [],
      envWarnings: [],
      hidrawAccess: true,
      hdr: opts.linux ? hdrSystemOf(s.hdr) : NO_HDR_SYSTEM,
      fixes: systemFixes,
    },
    scannedAt: opts.now.toISOString(),
  };
}

function entryOf(key: string, g: GameState, s: FakeState, linux: boolean, hdrReady: boolean): GameEntry {
  const d = g.def;
  const support = dualSenseSupport(d.title);
  const effective = g.runner ?? s.launchers[d.launcher].defaultRunner;
  const usesOurProton = !!effective && PROTON_NAME.test(effective) && !g.runnerMissing;
  const prefix = `${d.launcher}-${FAKE_HASH[d.launcher]}`;
  const files = LAUNCHER_FILES[d.launcher](d.id);
  const fixes: Fix[] = [];
  const fix = (id: string, kind: FixKind, label: Msg, why: Msg, file: string) => fixes.push({ id: `${prefix}:${id}`, kind, launcher: d.launcher, label, why, files: [file], recommended: true });
  const L = LAUNCHER_LABEL[d.launcher];
  if (linux && (g.runnerMissing || (native(support) && !usesOurProton && effective !== null)))
    fix(
      `runner:${d.id}`,
      "set-runner",
      msg("label.runner", { game: d.title, proton: s.ourProton }),
      g.runnerMissing ? msg("why.runnerMissing", { game: d.title, current: g.runner ?? "" }) : msg("why.runner", { support: supportMsg(support), current: effective ?? msg("fallback.steamProton") }),
      files.runner,
    );
  if (d.launcher === "steam" && native(support) && g.steamInput === "on")
    fix(`input:${d.id}`, "steam-input-off", msg("label.steamInput", { game: d.title }), msg("why.steamInput", { support: supportMsg(support) }), files.options);
  // Inside gamescope Steam can't hand its controller to the game (games.ts offerInputOff).
  else if (linux && d.launcher === "steam" && !native(support) && g.steamInput !== "off" && runsGamescope(g.args))
    fix(`input:${d.id}`, "steam-input-off", msg("label.steamInput", { game: d.title }), msg("why.steamInputGamescope", { game: d.title }), files.options);
  if (native(support) && g.envFlags.includes(PREFER_SDL))
    fix(
      `env:${d.id}`,
      "remove-env",
      msg(`label.env${d.launcher === "steam" ? "Steam" : "Heroic"}`, { vars: PREFER_SDL, game: d.title }),
      d.launcher === "steam" ? msg("why.envSteam", { vars: PREFER_SDL, options: msg("fallback.empty") }) : msg("why.envHeroic", { vars: PREFER_SDL }),
      files.options,
    );
  const gamepad = support === "xinput" && linux ? g.gamepad : undefined;
  if (gamepad === "needed") fix(`xinput:${d.id}`, "standard-gamepad", msg("label.gamepad", { game: d.title }), msg("why.gamepad", { game: d.title, runner: "" }), files.options);
  let hdr = linux && knownHdr(d.title) ? g.hdr : undefined;
  if (hdr === "needed" && !hdrReady) hdr = "missing";
  const screen = { screen: "DP-1", mode: "3840×2160" };
  const hdrWhy = msg(`why.hdr${L}`, {
    game: d.title,
    ...screen,
    options: "gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%",
    runner: usesOurProton ? "" : msg("why.hdrRunner", { proton: s.ourProton }),
    // Steam's text has an {{input}} part too (games.ts hdrInputOff): Steam Input goes off with gamescope.
    ...(d.launcher === "steam" ? { input: g.steamInput === "on" || (g.steamInput === "global" && !native(support)) ? msg("why.hdrInputOff") : "" } : {}),
  });
  if (hdr === "needed") fix(`hdr:${d.id}`, "hdr-on", msg("label.hdr", { game: d.title }), hdrWhy, files.options);
  if (hdr === "update")
    fix(
      `hdr:${d.id}`,
      "hdr-on",
      msg(hdrReady ? "label.hdrUpdate" : "label.hdrRemoveOld", { game: d.title }),
      msg("why.hdrOld", { game: d.title, next: hdrReady ? hdrWhy : msg("why.hdrOldOnly") }),
      files.options,
    );
  // The Proton version picker: our build and the launcher's others, each but the current with its fix.
  // loop: NOT-WORTH — ≤ 4 builds per fake game, once per (fake) scan
  const protons: ProtonChoice[] | undefined = linux
    ? [{ name: s.ourProton, label: s.ourProton }, ...FAKE_BUILDS[d.launcher].filter((b) => b.name !== s.ourProton)]
        .map((b) => {
          const base = { name: b.label, recommended: b.name === s.ourProton };
          if (!g.runnerMissing && b.name === effective) return { ...base, current: true };
          // loop: NOT-WORTH — ≤ 3 fake builds of one launcher
          const current = effective ? (FAKE_BUILDS[d.launcher].find((x) => x.name === effective)?.label ?? effective) : msg(`fallback.${d.launcher === "steam" ? "steamProton" : "none"}`);
          const note = d.launcher === "steam" && g.runner === null ? msg("why.protonPickDefault", { game: d.title }) : "";
          const fix: Fix = {
            id: pickId(prefix, d.id, b.name),
            kind: "set-proton",
            launcher: d.launcher,
            label: msg("label.runner", { game: d.title, proton: b.label }),
            why: msg("why.protonPick", { game: d.title, proton: b.label, current, note }),
            files: [files.runner],
            recommended: false,
          };
          return { ...base, current: false, fix };
        })
        // loop: NOT-WORTH — ≤ 4 builds per fake game
        .sort(byPick)
    : undefined;
  const gm = graphicsMode(d.title, d.store);
  const mode: ModeInfo | undefined = gm ? modeInfo(gm, g.args) : undefined;
  if (gm && mode?.state === "needed") {
    const params = { game: d.title, api: API_NAME[gm.api], feature: msg(`unlock.${gm.unlocks}`), flag: gm.flag };
    fix(
      `mode:${d.id}`,
      "graphics-mode",
      msg("label.mode", params),
      msg(`why.mode${L}`, { ...params, args: withArg(g.args, gm.flag), proton: linux && gm.api === "dx12" ? msg("why.modeVkd3d") : "" }),
      files.options,
    );
  }
  return {
    key,
    launcher: d.launcher,
    store: d.store,
    id: d.id,
    title: d.title,
    runner: linux ? g.runner : null,
    runnerMissing: linux && g.runnerMissing,
    usesOurProton: linux && usesOurProton,
    ...(d.launcher === "steam" ? { steamInput: g.steamInput } : {}),
    envFlags: g.envFlags,
    support,
    ...gameStates(gamepad, hdr, mode, protons),
    fixes,
    ...(d.kind ? { kind: d.kind } : {}),
  };
}

// ---- Details (GameLibrary's play time, art, actions) ----
export function fakeDetails(s: FakeState, nowMs: number): Record<string, GameInfo> {
  const now = Math.floor(nowMs / 1000);
  return Object.fromEntries(
    // loop: NOT-WORTH — 20 fake games, once per details request
    [...s.games].map(([key, { def: d }]) => {
      const info: GameInfo = {
        installDir: `~/Games/${d.title}`,
        sizeBytes: Math.round(d.sizeGb * 1024 ** 3),
        playtimeMin: Math.round(d.playHours * 60),
        ...(d.lastPlayedHours !== undefined ? { lastPlayed: now - Math.round(d.lastPlayedHours * 3600) } : {}),
        lastUpdated: now - 14 * 86400,
        ...(d.launcher === "steam" ? { buildId: "19000001" } : {}),
        art: Object.keys(ART_SIZES[d.art]) as ArtKind[],
      };
      info.actions = availableActions(d, { installDir: true, prefixDir: d.launcher !== "steam", lutrisSlug: d.launcher === "lutris" ? d.id : undefined });
      return [key, info];
    }),
  );
}

// ---- Apply and Undo, on the state only ----
const STALE: Msg = msg("result.stale");
const backupId = (now: Date, n: number) => `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z-${(0xfa4e00 + n).toString(16).slice(-6)}`;

// The launchers a set of changes belongs to that are running and weren't
// named in `restart` (the page asks to close and reopen them first).
function blocked(s: FakeState, owners: FakeLauncher[], restart: RestartList): LauncherId[] {
  // loop: NOT-WORTH — ≤ 3 launchers
  return [...new Set(owners)].filter((l) => s.running.has(l) && !restart.includes(l));
}

export function fakeApply(s: FakeState, fixIds: string[], restart: RestartList, opts: ReportOptions): ApplyResult {
  const report = fakeReport(s, opts);
  // The picker's choices (≤ 4 per game), resolved like any fix; the build each one sets.
  // loop: NOT-WORTH — the fake games' choices (≤ ~80), once per apply
  const picks = report.games.flatMap((g) => (g.protons ?? []).flatMap((c) => (c.fix ? [c.fix] : [])));
  // loop: NOT-WORTH — the fixes of one fake report (≤ ~30) and the picker's (≤ ~80)
  const all = new Map([...report.launchers.flatMap((l) => l.fixes), ...report.system.fixes, ...report.games.flatMap((g) => g.fixes), ...picks].map((f) => [f.id, f]));
  // loop: NOT-WORTH — the chosen fixes (≤ ~30)
  const known = fixIds.filter((id) => all.has(id));
  // loop: NOT-WORTH — the chosen fixes (≤ ~30)
  const owners = known.map((id) => all.get(id)!.launcher).filter((l): l is FakeLauncher => l !== "system");
  const blockedBy = blocked(s, owners, restart);
  if (blockedBy.length) return { applied: [], backupId: null, blockedBy };
  const before = snapshot(s);
  // loop: NOT-WORTH — the chosen fixes (≤ ~30)
  for (const id of known) change(s, all.get(id)!);
  // loop: NOT-WORTH — the chosen fixes (≤ ~30)
  const applied = [...known.map((id) => ({ id, ok: true })), ...fixIds.filter((id) => !all.has(id)).map((id) => ({ id, ok: false, message: STALE }))];
  if (!known.length) return { applied, backupId: null, blockedBy: [] };
  const id = backupId(opts.now, s.backups.length);
  s.backups.unshift({
    id,
    created: opts.now.toISOString(),
    // loop: NOT-WORTH — the chosen fixes (≤ ~30)
    changes: known.map((k) => all.get(k)!.label),
    // loop: NOT-WORTH — the chosen fixes (≤ ~30)
    files: [...new Set(known.flatMap((k) => all.get(k)!.files))],
    undo: before,
    owners: [...new Set(owners)],
  });
  return { applied, backupId: id, blockedBy: [] };
}

function change(s: FakeState, f: Fix): void {
  if (f.kind === "audio-volume") {
    s.volumeLow = false;
    return;
  }
  if (f.kind === "set-default") {
    s.launchers[f.launcher as FakeLauncher].defaultRunner = s.ourProton;
    return;
  }
  const key = f.id.slice(0, f.id.indexOf(":"));
  const rest = f.id.slice(f.id.indexOf(":", key.length + 1) + 1);
  // A picker's id ends in the build's hash: `<prefix>:proton:<game id>:<hash>`.
  const id = f.kind === "set-proton" ? rest.slice(0, rest.lastIndexOf(":")) : rest;
  // loop: NOT-WORTH — 20 fake games, once per applied fix
  const g = [...s.games.values()].find((x) => `${x.def.launcher}-${FAKE_HASH[x.def.launcher]}` === key && x.def.id === id);
  if (!g) return;
  if (f.kind === "set-runner" || f.kind === "hdr-on") {
    g.runner = s.ourProton;
    g.runnerMissing = false;
  }
  if (f.kind === "set-proton") {
    // loop: NOT-WORTH — ≤ 4 builds of one launcher
    const build = [s.ourProton, ...FAKE_BUILDS[g.def.launcher].map((b) => b.name)].find((n) => f.id === pickId(key, g.def.id, n));
    if (build) {
      g.runner = build;
      g.runnerMissing = false;
    }
  }
  if (f.kind === "steam-input-off") g.steamInput = "off";
  if (f.kind === "remove-env") g.envFlags = g.envFlags.filter((v) => v !== PREFER_SDL);
  if (f.kind === "standard-gamepad") g.gamepad = "set";
  if (f.kind === "hdr-on") {
    g.hdr = "set";
    g.envFlags = g.envFlags.filter((v) => v !== "PROTON_ENABLE_HDR" && v !== "PROTON_ENABLE_WAYLAND");
  }
  if (f.kind === "graphics-mode") {
    const gm = graphicsMode(g.def.title, g.def.store);
    if (gm) g.args = withArg(g.args, gm.flag);
  }
}

export function fakeUndo(s: FakeState, id: string, restart: RestartList): UndoResult {
  // loop: NOT-WORTH — the fake change history (a few entries)
  const at = s.backups.findIndex((b) => b.id === id);
  if (at < 0) return { ok: false, error: "This change isn't in the fake history (Fake games was turned off and on since)." };
  const b = s.backups[at];
  const blockedBy = blocked(s, b.owners, restart);
  if (blockedBy.length) return { ok: false, blockedBy };
  const back = structuredClone(b.undo);
  s.games = new Map(back.games);
  s.launchers = back.launchers;
  s.volumeLow = back.volumeLow;
  // Undo puts back the state from before this change, and with it every later one.
  s.backups.splice(0, at + 1);
  return { ok: true, restored: b.files };
}

export const fakeBackups = (s: FakeState): GameBackup[] =>
  // loop: NOT-WORTH — the fake change history (a few entries)
  s.backups.map(({ id, created, changes, files }) => ({ id, created, changes, files }));
