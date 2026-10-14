// Games page engine: scan every launcher (read-only), describe each possible
// change as a Fix (what, why, which files), and apply only the fixes the user
// confirmed. Fix ids are deterministic (`steam0:input:1091500`), so apply()
// re-scans and resolves ids against fresh state: the renderer can never name a
// file, a value, or a stale plan.
import { createHash } from "node:crypto";
import { errorText } from "../../../src/errorText";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";
import { dualSenseSupport, graphicsMode, knownHdr, type GraphicsMode } from "../../../src/desktop/games/knownGames";
import { API_NAME, modeInfo, withArg } from "../../../src/desktop/games/gameArgs";
import {
  HEROIC_GAMESCOPE_OPTIONS,
  LUTRIS_GAMESCOPE_FLAGS,
  hasGamescopeHdr,
  hasOldHdrVars,
  hdrReady,
  hdrScreen,
  NO_HDR_SYSTEM,
  OLD_HDR_VARS,
  stripOldHdrVars,
  withGamescopeHdr,
  type Size,
} from "../../../src/desktop/games/hdrSetup";
import { compareProtonNames, PROTON_NAME } from "../../../src/update/manifest";
import type {
  ApplyResult,
  DualSenseSupport,
  Fix,
  FixKind,
  GameEntry,
  GamepadState,
  GamesReport,
  HdrState,
  HdrSystem,
  LauncherId,
  LauncherInfo,
  ModeInfo,
  Msg,
  RestartList,
  SystemInfo,
} from "../../../src/desktop/games/types";
import { Backups, writeFileAtomic, type Owner } from "./backup";
import { findHeroicInstalls, heroicDefaultWine, heroicTools, listHeroicGames, type HeroicInstall, type WineVersion } from "./heroic";
import { findLutrisInstalls, listLutrisGames, lutrisDefaultRunner, lutrisWineBuilds, type LutrisInstall } from "./lutris";
import { buildHonoursPreferSdl, hasBuild, preferSdlBuild } from "./proton";
import { withLaunchersClosed, type LauncherControl } from "./processes";
import { steamAppTypes } from "./appinfo";
import { storeKey, type WindowsStores } from "./windowsStores";
import { compatMapping, findSteamInstalls, installedTools, launchOptions, listSteamGames, readVdfFile, setCompatTool, steamInputState, valveProtons, type SteamInstall } from "./steam";
import { findGlobalSdlVars, findProAudioRules, hidrawAccess, isProAudio, lowMixerControls, sdlVarForcing, SDL_FORCING_VARS, type AudioCard, type DualSenseMixer, type MixerChange } from "./system";

export { sdlVarForcing };
import { ensureNode, getString, parseVdf, serializeVdf, setKey, type VdfNode } from "./vdf";

// One file edit. Several fixes may edit the same file; apply() loads each file
// once, runs every selected mutation, and writes it once.
type Edit =
  | { file: string; format: "vdf"; mutate: (doc: VdfNode) => void }
  | { file: string; format: "json"; mutate: (doc: Record<string, unknown>) => void }
  | { file: string; format: "yaml"; mutate: (doc: ReturnType<typeof parseDocument>) => void }
  | { file: string; format: "disable"; mutate?: undefined }; // rename to <file>.disabled

type PostAction = { kind: "restart-wireplumber" } | { kind: "set-profile"; card: string; profile: string } | { kind: "set-mixer"; key: string; changes: MixerChange[] };

interface Planned {
  fix: Fix;
  edits: Edit[];
  post?: PostAction;
}

export interface ScanDeps {
  home: string;
  ourProton: string | null; // newest of our builds installed in any launcher
  latestProton: string | null; // newest published (manifest), null if unknown
  latestSize: number | null; // its download size in bytes
  running: Set<LauncherId>;
  audioCards: AudioCard[];
  mixers?: DualSenseMixer[]; // Linux: the controller's ALSA volume controls (system.ts)
  windowsStores?: WindowsStores; // Windows: GOG Galaxy and Epic (Linux has them through Heroic)
  notDetected?: Set<string>; // game keys the player marked "controller not detected"
  hdrMarked?: Set<string>; // game keys the player marked "Supports HDR"
  hdr?: HdrSystem; // what this computer has for HDR right now (hdr.ts)
}

export interface Scan {
  report: GamesReport;
  plan: Map<string, Planned>;
}

const SDL_ASSIGN = new RegExp(`(^|\\s)(${SDL_FORCING_VARS.join("|")})=(\\S*)`, "g");
// loop: HOT-PATH-OK — env assignments in one launch-options line
export const sdlVarsIn = (opts: string) => [...new Set([...opts.matchAll(SDL_ASSIGN)].filter((m) => sdlVarForcing(m[2], m[3])).map((m) => m[2]))];
// Remove the forcing assignments only; everything else (spacing inside quotes included) stays.
// Each forcing assignment goes together with the one space before it.
export const stripSdlVars = (opts: string) => opts.replace(SDL_ASSIGN, (whole, _lead: string, key: string, value: string) => (sdlVarForcing(key, value) ? "" : whole)).trim();

const nativeSupport = (s: DualSenseSupport) => s === "triggers" || s === "haptics";

// ---- Standard gamepad (XInput) for XInput-only games ----
// Our DualSense Proton passes the controller through as itself, so a game that
// only knows XInput sees no controller; PROTON_PREFER_SDL=1 (per game) makes
// Proton hand it over as a standard gamepad instead.
export const PREFER_SDL = "PROTON_PREFER_SDL";

export const hasPreferSdl = (opts: string) => sdlVarsIn(opts).includes(PREFER_SDL);

// Steam launch options with `vars`=1 in front of %command%; the player's own
// options (and other variables) stay as they are, an earlier value of these
// variables is replaced (game arguments without %command% go after it).
export function withEnvVars(opts: string, vars: readonly string[]): string {
  // loop: NOT-WORTH — 1-2 variables, only when a fix is built
  const rest = vars.reduce((o, v) => o.replace(new RegExp(`(^|\\s)${v}=\\S*`, "g"), ""), opts).trim();
  // loop: NOT-WORTH — 1-2 variables, only when a fix is built
  const set = vars.map((v) => `${v}=1`).join(" ");
  if (!rest) return `${set} %command%`;
  return rest.includes("%command%") ? `${set} ${rest}` : `${set} %command% ${rest}`;
}
export const withPreferSdl = (opts: string) => withEnvVars(opts, [PREFER_SDL]);

// Windows: Steam runs Windows games natively, so PROTON_PREFER_SDL does
// nothing there. Earlier versions could still add it; what they put in front
// of the options is taken out again (and "%command%" alone, which they made
// from empty options, becomes empty again). Anything else stays.
const OUR_PREFER_SDL = `${PREFER_SDL}=1 `;
export const hasOurPreferSdl = (opts: string) => opts.startsWith(OUR_PREFER_SDL);
export function withoutOurPreferSdl(opts: string): string {
  if (!hasOurPreferSdl(opts)) return opts;
  const rest = opts.slice(OUR_PREFER_SDL.length).trim();
  return rest === "%command%" ? "" : rest;
}

// One Steam game's launch options, changed from what's in the file when it's
// written (several fixes may change them in one go: each keeps the others').
const editLaunchOptions = (file: string, appid: string, change: (opts: string) => string): Edit => ({
  file,
  format: "vdf",
  mutate: (doc) => {
    const node = ensureNode(doc, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps", appid);
    setKey(node, "LaunchOptions", change(getString(node, "LaunchOptions") ?? ""));
  },
});

// One Lutris game's arguments (game.args), changed from what's in the file when it's written.
const editLutrisArgs = (file: string, change: (args: string) => string): Edit => ({
  file,
  format: "yaml",
  mutate: (doc) => {
    const args = doc.getIn(["game", "args"]);
    doc.setIn(["game", "args"], change(typeof args === "string" ? args : ""));
  },
});

// ---- HDR for HDR games (src/desktop/games/hdrSetup.ts) ----
// The game runs inside gamescope with HDR on; the fix also moves it to our
// DualSense Proton (HDR plus triggers and haptics), and removes the old
// PROTON_ENABLE_WAYLAND / PROTON_ENABLE_HDR variant (black screen) wherever
// it's found.
//   gamescope  a gamescope line with HDR is there (ours or by hand)
//   old        the old variant is there
//   ready      this computer meets the requirements (hdrReady)
// "update" without `ready` only removes the old variant.
export function hdrPlan(o: { gamescope: boolean; old: boolean; ready: boolean }): { state: HdrState; gamescope: boolean; strip: boolean } {
  if (o.gamescope && !o.old) return { state: "set", gamescope: false, strip: false };
  if (o.old) return { state: "update", gamescope: o.ready && !o.gamescope, strip: true };
  if (!o.ready) return { state: "missing", gamescope: false, strip: false };
  return { state: "needed", gamescope: true, strip: false };
}

const enabled = (value: unknown) => value !== undefined && value !== null && value !== false && !["", "0", "false"].includes(String(value).replace(/^(["'])(.*)\1$/, "$2"));
// loop: NOT-WORTH — fixed list of old HDR variables
const hasOldEnv = (env: Record<string, unknown>) => OLD_HDR_VARS.some((v) => enabled(env[v]));

// Heroic: its own gamescope settings at the screen's mode, our flags in
// additionalOptions (it has no switch for the backend or HDR). Heroic only
// starts gamescope with upscaling or the limiter on, and only passes
// -w/-h/-W/-H/-f with upscaling on; no upscaleMethod = no filter.
export const heroicHasGamescopeHdr = (gs: Record<string, unknown> | null) =>
  !!gs && (gs.enableUpscaling === true || gs.enableLimiter === true) && /(^|\s)--hdr-enabled(\s|$)/.test(String(gs.additionalOptions ?? ""));
export function heroicGamescope(gs: Record<string, unknown> | null, s: Size): Record<string, unknown> {
  const extra = String(gs?.additionalOptions ?? "")
    .replace(/(^|\s)--backend(?:\s+|=)\S+/g, " ")
    .split(/\s+/)
    .filter((o) => o && !HEROIC_GAMESCOPE_OPTIONS.includes(o));
  const size = { width: String(s.width), height: String(s.height) };
  return {
    ...gs,
    enableUpscaling: true,
    windowType: "fullscreen",
    gameWidth: size.width,
    gameHeight: size.height,
    upscaleWidth: size.width,
    upscaleHeight: size.height,
    additionalOptions: [...HEROIC_GAMESCOPE_OPTIONS, ...extra].join(" "),
  };
}

// Lutris (0.5.17+): its own gamescope options, HDR switch included (which
// also sets DXVK_HDR=1); the Wayland backend goes in its custom flags.
export const lutrisHasGamescopeHdr = (system: Record<string, unknown>) => enabled(system.gamescope) && enabled(system.gamescope_hdr);
export function lutrisGamescope(system: Record<string, unknown>, s: Size): Record<string, unknown> {
  const flags = String(system.gamescope_flags ?? "")
    .replace(/(^|\s)--backend(?:\s+|=)\S+/g, " ")
    .trim();
  return {
    gamescope: true,
    gamescope_hdr: true,
    gamescope_force_grab_cursor: true,
    gamescope_output_res: `${s.width}x${s.height}`,
    gamescope_game_res: `${s.width}x${s.height}`,
    gamescope_window_mode: "-f",
    gamescope_flags: [LUTRIS_GAMESCOPE_FLAGS, flags].filter(Boolean).join(" "),
  };
}
// What a game wanting a standard gamepad needs: the option (addEnv) and/or a
// Proton that honours it (switchTo). `steamInputOff` only for Steam games.
export function gamepadPlan(o: { envSet: boolean; honours: boolean; target: string | null; steamInputOff?: boolean }): { state: GamepadState; addEnv: boolean; switchTo: string | null } {
  if (o.steamInputOff === false) return { state: "steam-input", addEnv: false, switchTo: null };
  if (!o.honours && !o.target) return { state: "no-build", addEnv: false, switchTo: null };
  if (o.envSet && o.honours) return { state: "set", addEnv: false, switchTo: null };
  return { state: "needed", addEnv: !o.envSet, switchTo: o.honours ? null : o.target };
}

// A game entry's optional states (only set for the games they apply to).
const gameStates = (gamepad: GamepadState | undefined, hdr: HdrState | undefined, mode?: ModeInfo) => ({ ...(gamepad ? { gamepad } : {}), ...(hdr ? { hdr } : {}), ...(mode ? { mode } : {}) });

// Fix ids are built from what they point at (an install root, a file path),
// never a list position, so an id from the review screen can only resolve to
// the same target in the fresh scan that apply() runs.
export const idHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

// Message helpers (texts live in the locale files under desktop.games.msg).
const msg = (key: string, params?: Msg["params"]): Msg => (params ? { key, params } : { key });
const supportMsg = (support: DualSenseSupport): Msg => msg(support === "triggers" ? "support.triggers" : "support.haptics");
const orMsg = (value: string | null | undefined, fallbackKey: string): string | Msg => value ?? msg(fallbackKey);
// The standard-gamepad fix's sentence about moving the game to another Proton ("" when it doesn't).
const runnerSwitch = (current: string, to: string | null): string | Msg => (to ? msg("why.gamepadRunner", { current, proton: to }) : "");
// The HDR fix's sentence about our Proton: it moves the game there, or says where to get it.
const hdrRunnerSwitch = (to: string | null, oursThere: boolean): string | Msg => (to ? msg("why.hdrRunner", { proton: to }) : oursThere ? "" : msg("why.hdrNoProton"));

// ---- Graphics mode (knownGames.ts MODES) ----
// The game's own flag added to its arguments (gameArgs.ts, the one writer):
// works the same on every platform. Under Proton (Linux) DirectX 12 runs
// through vkd3d-proton, which builds shaders on the first starts.
const modeTexts = (game: string, mode: GraphicsMode, whyKey: string, line: string): { label: Msg; why: Msg } => {
  const params = { game, api: API_NAME[mode.api], feature: msg(`unlock.${mode.unlocks}`), flag: mode.flag };
  const proton = process.platform === "linux" && mode.api === "dx12" ? msg("why.modeVkd3d") : "";
  return { label: msg("label.mode", params), why: msg(whyKey, { ...params, args: withArg(line, mode.flag), proton }) };
};

// Newest of our DualSense builds installed in any launcher.
export function newestLocalBuild(names: string[]): string | null {
  return names.filter((n) => PROTON_NAME.test(n)).sort((a, b) => compareProtonNames(b, a))[0] ?? null;
}

export function scan(deps: ScanDeps): Scan {
  const plan = new Map<string, Planned>();
  const games: GameEntry[] = [];
  const launchers: LauncherInfo[] = [];
  const ours = deps.ourProton;
  const add = (p: Planned) => plan.set(p.fix.id, p);
  const hdrSys: HdrSystem = deps.hdr ?? NO_HDR_SYSTEM;
  const hdrScr = hdrScreen(hdrSys);
  // HDR through gamescope is Linux-only (Windows games do HDR themselves):
  // nothing is judged, offered or shown elsewhere.
  const isHdrGame = (title: string, key: string) => process.platform === "linux" && (knownHdr(title) || !!deps.hdrMarked?.has(key));
  // The Proton an HDR game moves to: the one the standard-gamepad fix moves it
  // to if that's one of ours (both write the same), else our newest.
  const hdrTo = (gamepadTo: string | null) => (gamepadTo && PROTON_NAME.test(gamepadTo) ? gamepadTo : ours);
  const hdrScreenParams = () => ({ screen: hdrScr?.name ?? "", mode: hdrScr ? `${hdrScr.width}×${hdrScr.height}` : "" });
  // The fix's label and reason: the old variant removed (and gamescope, when ready).
  const hdrTexts = (state: HdrState, gamescope: boolean, game: string, why: Msg): { label: Msg; why: Msg } =>
    state === "update"
      ? { label: msg(gamescope ? "label.hdrUpdate" : "label.hdrRemoveOld", { game }), why: msg("why.hdrOld", { game, next: gamescope ? why : msg("why.hdrOldOnly") }) }
      : { label: msg("label.hdr", { game }), why };
  const fix = (id: string, kind: FixKind, launcher: Fix["launcher"], label: Msg, why: Msg, recommended: boolean, edits: Edit[], post?: PostAction): Fix => {
    // loop: NOT-WORTH — edits of one fix
    const f: Fix = { id, kind, launcher, label, why, files: [...new Set(edits.flatMap((e) => (e.format === "disable" ? [e.file, `${e.file}.disabled`] : [e.file])))], recommended };
    add({ fix: f, edits, post });
    return f;
  };
  // A game's graphics mode from its arguments line, and the fix that adds the
  // flag when it's needed (`edit` writes the line through withArg).
  const modeFor = (
    gm: GraphicsMode | null,
    line: string,
    game: string,
    id: string,
    launcher: LauncherId,
    whyKey: string,
    edit: (change: (line: string) => string) => Edit,
    out: Fix[],
  ): ModeInfo | undefined => {
    if (!gm) return undefined;
    const mode = modeInfo(gm, line);
    if (mode.state === "needed") {
      const texts = modeTexts(game, gm, whyKey, line);
      out.push(fix(id, "graphics-mode", launcher, texts.label, texts.why, true, [edit((l) => withArg(l, gm.flag))]));
    }
    return mode;
  };

  // ---- Steam ----
  const steamInstalls = findSteamInstalls(deps.home);
  // loop: NOT-WORTH — Steam installs found
  steamInstalls.forEach((install) => scanSteam(install, `steam-${idHash(install.root)}`));
  function scanSteam(install: SteamInstall, prefix: string) {
    const config = readVdfFile(install.configPath);
    const local = install.localConfigPath ? readVdfFile(install.localConfigPath) : null;
    const mapping = compatMapping(config);
    const defaultRunner = mapping ? (getString(mapping, "0", "name") ?? null) : null;
    const tools = installedTools(install);
    const protonInstalled = !!ours && tools.includes(ours);
    const lfixes: Fix[] = [];
    if (config && ours && protonInstalled && defaultRunner !== ours) {
      lfixes.push(
        fix(`${prefix}:default`, "set-default", "steam", msg("label.defaultSteam", { proton: ours }), msg("why.defaultSteam", { current: orMsg(defaultRunner, "fallback.steamProton") }), true, [
          { file: install.configPath, format: "vdf", mutate: (doc) => setCompatTool(doc, "0", ours) },
        ]),
      );
    }
    launchers.push({
      id: "steam",
      found: true,
      flatpak: install.flatpak,
      running: deps.running.has("steam"),
      protonInstalled,
      defaultRunner,
      defaultIsOurs: !!ours && defaultRunner === ours,
      fixes: lfixes,
    });

    const steamGames = listSteamGames(install);
    const kinds = steamAppTypes(
      install.root,
      // loop: HOT-PATH-OK — app ids for the appinfo lookup, one array
      steamGames.map((g) => g.appid),
    );
    // loop: BATCH — per game 3 linear getString lookups in localconfig apps (1000s of keys)
    for (const g of steamGames) {
      const kind = kinds.get(g.appid);
      // Soundtracks, videos and software don't run as games: no controller
      // support to show and no game fixes to suggest.
      const playable = !kind || kind === "game" || kind === "demo";
      const support = playable ? dualSenseSupport(g.name) : "unknown";
      const override = mapping ? (getString(mapping, g.appid, "name") ?? null) : null;
      const effective = override ?? defaultRunner;
      const input = steamInputState(local, g.appid);
      const opts = launchOptions(local, g.appid);
      const envFlags = sdlVarsIn(opts);
      const key = `${prefix}:steam:${g.appid}`;
      const gfixes: Fix[] = [];
      let gamepad: GamepadState | undefined;
      let gamepadTo: string | null = null;
      // Steam Input off for the game: Steam leaves the controller to Proton.
      // Otherwise Steam already gives an XInput game an Xbox pad. Proton only:
      // on Windows the game sees the controller the way Windows gives it.
      const windows = process.platform === "win32";
      if (!windows && playable && !nativeSupport(support) && (support === "xinput" || deps.notDetected?.has(key)) && local && install.localConfigPath && config) {
        const runner = override ?? defaultRunner;
        const p = gamepadPlan({
          envSet: hasPreferSdl(opts),
          honours: !runner || buildHonoursPreferSdl(runner, [install.toolsDir]),
          target: preferSdlBuild(tools, [install.toolsDir], runner),
          steamInputOff: input === "off",
        });
        gamepad = p.state;
        gamepadTo = p.switchTo;
        if (p.state === "needed") {
          const localPath = install.localConfigPath;
          const edits: Edit[] = [];
          if (p.addEnv) edits.push(editLaunchOptions(localPath, g.appid, withPreferSdl));
          // A per-game entry, also when the game follows the default: the
          // option only matters under Proton, so this is a Windows game.
          if (p.switchTo) edits.push({ file: install.configPath, format: "vdf", mutate: (doc) => setCompatTool(doc, g.appid, p.switchTo!) });
          gfixes.push(
            fix(
              `${prefix}:xinput:${g.appid}`,
              "standard-gamepad",
              "steam",
              msg("label.gamepad", { game: g.name }),
              msg("why.gamepadSteam", { game: g.name, options: p.addEnv ? withPreferSdl(opts) : opts, runner: runnerSwitch(runner ?? "", p.switchTo) }),
              true,
              edits,
            ),
          );
        }
      }
      if (windows && !nativeSupport(support) && local && install.localConfigPath && hasOurPreferSdl(opts)) {
        gfixes.push(
          fix(
            `${prefix}:env:${g.appid}`,
            "remove-env",
            "steam",
            msg("label.envSteam", { vars: PREFER_SDL, game: g.name }),
            msg("why.preferSdlWindows", { vars: PREFER_SDL, options: withoutOurPreferSdl(opts) || msg("fallback.empty") }),
            true,
            [editLaunchOptions(install.localConfigPath, g.appid, withoutOurPreferSdl)],
          ),
        );
      }
      if (nativeSupport(support)) {
        // Only games already set to a specific compatibility tool: those certainly run
        // through Proton. Forcing Proton on a game without one could switch a native
        // Linux build (e.g. Metro Exodus) to the Windows version and re-download it;
        // the default ("0") never applies to native games, so it covers the rest.
        if (ours && protonInstalled && config && override !== null && override !== ours) {
          gfixes.push(
            fix(
              `${prefix}:runner:${g.appid}`,
              "set-runner",
              "steam",
              msg("label.runner", { game: g.name, proton: ours }),
              msg("why.runner", { support: supportMsg(support), current: orMsg(effective, "fallback.steamProton") }),
              true,
              [{ file: install.configPath, format: "vdf", mutate: (doc) => setCompatTool(doc, g.appid, ours) }],
            ),
          );
        }
        // Only a per-game "forced on" is a problem: on "default", games with native
        // DualSense support already opt out of Steam Input (verified with Avatar,
        // Spider-Man, Uncharted, The Last of Us, all flag-free on "default").
        if (local && input === "on" && install.localConfigPath) {
          gfixes.push(
            fix(`${prefix}:input:${g.appid}`, "steam-input-off", "steam", msg("label.steamInput", { game: g.name }), msg("why.steamInput", { support: supportMsg(support) }), true, [
              { file: install.localConfigPath, format: "vdf", mutate: (doc) => setKey(ensureNode(doc, "UserLocalConfigStore", "apps", g.appid), "UseSteamControllerConfig", "0") },
            ]),
          );
        }
        if (local && envFlags.length && install.localConfigPath) {
          gfixes.push(
            fix(
              `${prefix}:env:${g.appid}`,
              "remove-env",
              "steam",
              msg("label.envSteam", { vars: envFlags.join(", "), game: g.name }),
              msg("why.envSteam", { vars: envFlags.join(", "), options: stripSdlVars(opts) || msg("fallback.empty") }),
              true,
              [editLaunchOptions(install.localConfigPath, g.appid, stripSdlVars)],
            ),
          );
        }
      }
      // HDR through gamescope. A game that follows Steam's default is only
      // moved to our Proton when it's on our list (all Windows-only): a
      // per-game Proton would switch a native Linux game to its Windows version.
      let hdr: HdrState | undefined;
      if (playable && isHdrGame(g.name, key) && local && install.localConfigPath && config) {
        const runner = override ?? defaultRunner;
        const p = hdrPlan({ gamescope: hasGamescopeHdr(opts), old: hasOldHdrVars(opts), ready: hdrReady(hdrSys, install.flatpak) && !!hdrScr });
        hdr = p.state;
        if (p.state === "needed" || p.state === "update") {
          const to = hdrTo(gamepadTo);
          const switchTo = p.gamescope && to && protonInstalled && runner !== to && (override !== null || knownHdr(g.name)) ? to : null;
          const change = (o: string) => (p.gamescope ? withGamescopeHdr(o, hdrScr!) : stripOldHdrVars(o));
          const edits: Edit[] = [editLaunchOptions(install.localConfigPath, g.appid, change)];
          if (switchTo) edits.push({ file: install.configPath, format: "vdf", mutate: (doc) => setCompatTool(doc, g.appid, switchTo) });
          const texts = hdrTexts(
            p.state,
            p.gamescope,
            g.name,
            msg("why.hdrSteam", { game: g.name, ...hdrScreenParams(), options: change(opts) || msg("fallback.empty"), runner: hdrRunnerSwitch(switchTo, protonInstalled) }),
          );
          gfixes.push(fix(`${prefix}:hdr:${g.appid}`, "hdr-on", "steam", texts.label, texts.why, true, edits));
        }
      }
      const localPath = install.localConfigPath;
      const mode =
        playable && local && localPath
          ? modeFor(graphicsMode(g.name, "steam"), opts, g.name, `${prefix}:mode:${g.appid}`, "steam", "why.modeSteam", (change) => editLaunchOptions(localPath, g.appid, change), gfixes)
          : undefined;
      games.push({
        key,
        launcher: "steam",
        store: "steam",
        id: g.appid,
        title: g.name,
        runner: effective,
        runnerMissing: false,
        usesOurProton: !!ours && effective === ours,
        steamInput: input,
        envFlags,
        support,
        ...gameStates(gamepad, hdr, mode),
        fixes: playable ? gfixes : [],
        ...(kind && kind !== "game" ? { kind } : {}),
      });
    }
  }

  // ---- Heroic ----
  // loop: NOT-WORTH — Heroic installs found
  findHeroicInstalls(deps.home).forEach((install) => scanHeroic(install, `heroic-${idHash(install.root)}`));
  function scanHeroic(install: HeroicInstall, prefix: string) {
    const tools = heroicTools(install);
    const protonInstalled = !!ours && tools.includes(ours);
    const ourWine: WineVersion | null = ours && protonInstalled ? { bin: join(install.toolsDir, ours, "proton"), name: ours, type: "proton" } : null;
    const def = heroicDefaultWine(install);
    const defaultIsOurs = !!ours && def?.name === ours && existsSync(def.bin);
    const lfixes: Fix[] = [];
    if (ourWine && !defaultIsOurs) {
      lfixes.push(
        fix(`${prefix}:default`, "set-default", "heroic", msg("label.defaultHeroic", { proton: ourWine.name }), msg("why.defaultHeroic", { current: orMsg(def?.name, "fallback.none") }), true, [
          { file: install.configPath, format: "json", mutate: (doc) => (((doc.defaultSettings ??= {}) as Record<string, unknown>).wineVersion = { ...ourWine }) },
        ]),
      );
    }
    launchers.push({ id: "heroic", found: true, flatpak: install.flatpak, running: deps.running.has("heroic"), protonInstalled, defaultRunner: def?.name ?? null, defaultIsOurs, fixes: lfixes });

    // loop: BATCH — per game reads the runner's version file again (buildHonoursPreferSdl)
    for (const g of listHeroicGames(install)) {
      const support = dualSenseSupport(g.title);
      const runnerMissing = !!g.wineVersion && !existsSync(g.wineVersion.bin);
      const effective = g.wineVersion?.name ?? def?.name ?? null;
      // loop: HOT-PATH-OK — env entries of one game
      const envFlags = [...new Set(g.env.filter((e) => sdlVarForcing(e.key, e.value)).map((e) => e.key))];
      const hasConfig = existsSync(g.configPath);
      const gfixes: Fix[] = [];
      // An edit of this game's settings object in its GamesConfig file.
      const editGame = (change: (cfg: Record<string, unknown>) => void): Edit => ({ file: g.configPath, format: "json", mutate: (doc) => change((doc[g.appName] ??= {}) as Record<string, unknown>) });
      const setOurs = editGame((cfg) => (cfg.wineVersion = { ...ourWine }));
      const key = `${prefix}:${g.store}:${g.appName}`;
      const runnerFix = !!ourWine && hasConfig && (runnerMissing || (nativeSupport(support) && !!g.wineVersion && g.wineVersion.name !== ours));
      // Standard gamepad: judged on the runner the game will have (ours, if the fix above is taken).
      let gamepad: GamepadState | undefined;
      let gamepadFix: Fix | null = null;
      let gamepadSwitches = false;
      let gamepadTo: string | null = null;
      if (!nativeSupport(support) && (support === "xinput" || deps.notDetected?.has(key)) && hasConfig) {
        const runner = runnerFix ? ourWine : (g.wineVersion ?? def);
        const p = gamepadPlan({
          // loop: HOT-PATH-OK — env entries of one game
          envSet: g.env.some((e) => e.key === PREFER_SDL && sdlVarForcing(e.key, e.value)),
          honours: !runner || buildHonoursPreferSdl(runner.name, [install.toolsDir, dirname(dirname(runner.bin))]),
          target: preferSdlBuild(tools, [install.toolsDir, ...(runner ? [dirname(dirname(runner.bin))] : [])], runner?.name),
        });
        gamepad = p.state;
        if (p.state === "needed") {
          const switchTo = p.switchTo;
          gamepadSwitches = !!switchTo;
          gamepadTo = switchTo;
          gamepadFix = fix(
            `${prefix}:xinput:${g.appName}`,
            "standard-gamepad",
            "heroic",
            msg("label.gamepad", { game: g.title }),
            msg("why.gamepad", { game: g.title, runner: runnerSwitch(runner?.name ?? "", switchTo) }),
            true,
            [
              editGame((cfg) => {
                if (p.addEnv) {
                  const list = Array.isArray(cfg.enviromentOptions) ? (cfg.enviromentOptions as Array<{ key?: unknown }>).filter((e) => String(e.key) !== PREFER_SDL) : [];
                  cfg.enviromentOptions = [...list, { key: PREFER_SDL, value: "1" }];
                }
                if (switchTo) cfg.wineVersion = { bin: join(install.toolsDir, switchTo, "proton"), name: switchTo, type: "proton" };
              }),
            ],
          );
        }
      }
      // The standard-gamepad fix's own runner switch replaces the set-runner fix.
      if (runnerFix && !gamepadSwitches) {
        gfixes.push(
          fix(
            `${prefix}:runner:${g.appName}`,
            "set-runner",
            "heroic",
            msg("label.runner", { game: g.title, proton: ourWine.name }),
            runnerMissing ? msg("why.runnerMissing", { game: g.title, current: g.wineVersion!.name }) : msg("why.runner", { support: supportMsg(support), current: orMsg(effective, "fallback.none") }),
            true,
            [setOurs],
          ),
        );
      }
      if (gamepadFix) gfixes.push(gamepadFix);
      // HDR through Heroic's own gamescope settings; its Wine-Wayland and HDR
      // switches (the old variant) are turned off.
      let hdr: HdrState | undefined;
      if (isHdrGame(g.title, key) && hasConfig) {
        const runner = g.wineVersion ?? def;
        // loop: NOT-WORTH — env entries, HDR games only
        const old = g.wineWayland || g.hdr || hasOldEnv(Object.fromEntries(g.env.map((e) => [e.key, e.value])));
        const p = hdrPlan({ gamescope: heroicHasGamescopeHdr(g.gamescope), old, ready: hdrReady(hdrSys, install.flatpak) && !!hdrScr });
        hdr = p.state;
        if (p.state === "needed" || p.state === "update") {
          const to = p.gamescope && ourWine ? hdrTo(gamepadTo) : null;
          const switchTo = to && (runnerMissing || runner?.name !== to) ? to : null;
          const texts = hdrTexts(p.state, p.gamescope, g.title, msg("why.hdrHeroic", { game: g.title, ...hdrScreenParams(), runner: hdrRunnerSwitch(switchTo, !!ourWine) }));
          gfixes.push(
            fix(`${prefix}:hdr:${g.appName}`, "hdr-on", "heroic", texts.label, texts.why, true, [
              editGame((cfg) => {
                if (cfg.enableWineWayland === true) cfg.enableWineWayland = false;
                if (cfg.enableHDR === true) cfg.enableHDR = false;
                if (Array.isArray(cfg.enviromentOptions))
                  cfg.enviromentOptions = (cfg.enviromentOptions as Array<{ key?: unknown }>).filter((e) => !(OLD_HDR_VARS as readonly string[]).includes(String(e.key)));
                if (p.gamescope) {
                  cfg.gamescope = heroicGamescope(cfg.gamescope && typeof cfg.gamescope === "object" ? (cfg.gamescope as Record<string, unknown>) : null, hdrScr!);
                  const list = Array.isArray(cfg.enviromentOptions) ? (cfg.enviromentOptions as Array<{ key?: unknown }>).filter((e) => String(e.key) !== "ENABLE_GAMESCOPE_WSI") : [];
                  cfg.enviromentOptions = [...list, { key: "ENABLE_GAMESCOPE_WSI", value: "1" }];
                }
                if (switchTo) cfg.wineVersion = { bin: join(install.toolsDir, switchTo, "proton"), name: switchTo, type: "proton" };
              }),
            ]),
          );
        }
      }
      const mode = hasConfig
        ? modeFor(
            graphicsMode(g.title, g.store),
            g.args,
            g.title,
            `${prefix}:mode:${g.appName}`,
            "heroic",
            "why.modeHeroic",
            (change) => editGame((cfg) => (cfg.launcherArgs = change(typeof cfg.launcherArgs === "string" ? cfg.launcherArgs : ""))),
            gfixes,
          )
        : undefined;
      if (nativeSupport(support) && envFlags.length && hasConfig) {
        gfixes.push(
          fix(`${prefix}:env:${g.appName}`, "remove-env", "heroic", msg("label.envHeroic", { vars: envFlags.join(", "), game: g.title }), msg("why.envHeroic", { vars: envFlags.join(", ") }), true, [
            editGame((cfg) => {
              if (Array.isArray(cfg.enviromentOptions))
                cfg.enviromentOptions = (cfg.enviromentOptions as Array<{ key?: unknown; value?: unknown }>).filter((e) => !sdlVarForcing(String(e.key), String(e.value ?? "")));
            }),
          ]),
        );
      }
      games.push({
        key,
        launcher: "heroic",
        store: g.store,
        id: g.appName,
        title: g.title,
        runner: effective,
        runnerMissing,
        usesOurProton: !!ours && effective === ours && !runnerMissing,
        envFlags,
        support,
        ...gameStates(gamepad, hdr, mode),
        fixes: gfixes,
      });
    }
  }

  // ---- Lutris ----
  // loop: NOT-WORTH — Steam installs, a readdir each
  const steamToolNames = steamInstalls.flatMap((s) => [...installedTools(s), ...valveProtons(s)]);
  // loop: NOT-WORTH — Lutris installs found
  findLutrisInstalls(deps.home).forEach((install) => scanLutris(install, `lutris-${idHash(install.dataDir)}`));
  function scanLutris(install: LutrisInstall, prefix: string) {
    // Native Lutris also lists Steam's compatibility tools; the Flatpak only sees its own dir.
    const visible = new Set([...lutrisWineBuilds(install), ...(install.flatpak ? [] : steamToolNames), "system"]);
    const protonInstalled = !!ours && install.umu && visible.has(ours);
    const def = lutrisDefaultRunner(install);
    const lfixes: Fix[] = [];
    const setVersion = (file: string, version = ours): Edit => ({ file, format: "yaml", mutate: (doc) => doc.setIn(["wine", "version"], version) });
    // Where Lutris finds Proton builds (for their version files).
    // loop: NOT-WORTH — Steam installs
    const buildDirs = [install.wineDir, ...(install.flatpak ? [] : steamInstalls.map((s) => s.toolsDir))];
    if (protonInstalled && def !== ours) {
      lfixes.push(
        fix(`${prefix}:default`, "set-default", "lutris", msg("label.defaultLutris", { proton: ours }), msg("why.defaultLutris", { current: orMsg(def, "fallback.lutrisDefault") }), true, [
          setVersion(install.runnerWineYml),
        ]),
      );
    }
    launchers.push({
      id: "lutris",
      found: true,
      flatpak: install.flatpak,
      running: deps.running.has("lutris"),
      protonInstalled,
      defaultRunner: def,
      defaultIsOurs: !!ours && def === ours,
      fixes: lfixes,
    });

    // loop: BATCH — per game reads the runner's version file again (buildHonoursPreferSdl)
    for (const g of listLutrisGames(install)) {
      const support = dualSenseSupport(g.name);
      const runnerMissing = !!g.runner && !visible.has(g.runner) && !hasBuild(install.wineDir, g.runner);
      const effective = g.runner ?? def;
      const key = `${prefix}:lutris:${g.configId}`;
      const gfixes: Fix[] = [];
      const runnerFix = protonInstalled && (runnerMissing || (nativeSupport(support) && effective !== ours));
      let gamepad: GamepadState | undefined;
      let gamepadSwitches = false;
      let gamepadFix: Fix | null = null;
      let gamepadTo: string | null = null;
      if (!nativeSupport(support) && (support === "xinput" || deps.notDetected?.has(key))) {
        const runner = runnerFix ? ours : effective;
        const p = gamepadPlan({
          // loop: HOT-PATH-OK — env entries of one game
          envSet: Object.entries(g.env).some(([k, v]) => k === PREFER_SDL && sdlVarForcing(k, v)),
          honours: !runner || buildHonoursPreferSdl(runner, buildDirs),
          // Lutris runs Proton builds through umu.
          target: install.umu ? preferSdlBuild([...visible], buildDirs, runner) : null,
        });
        gamepad = p.state;
        if (p.state === "needed") {
          gamepadSwitches = !!p.switchTo;
          gamepadTo = p.switchTo;
          const edits: Edit[] = [];
          if (p.addEnv) edits.push({ file: g.configPath, format: "yaml", mutate: (doc) => doc.setIn(["system", "env", PREFER_SDL], "1") });
          if (p.switchTo) edits.push(setVersion(g.configPath, p.switchTo));
          gamepadFix = fix(
            `${prefix}:xinput:${g.configId}`,
            "standard-gamepad",
            "lutris",
            msg("label.gamepad", { game: g.name }),
            msg("why.gamepad", { game: g.name, runner: runnerSwitch(runner ?? "", p.switchTo) }),
            true,
            edits,
          );
        }
      }
      if (runnerFix && !gamepadSwitches) {
        gfixes.push(
          fix(
            `${prefix}:runner:${g.configId}`,
            "set-runner",
            "lutris",
            msg("label.runner", { game: g.name, proton: ours }),
            runnerMissing ? msg("why.runnerMissing", { game: g.name, current: g.runner! }) : msg("why.runner", { support: supportMsg(support), current: orMsg(effective, "fallback.lutrisDefault") }),
            true,
            [setVersion(g.configPath)],
          ),
        );
      }
      if (gamepadFix) gfixes.push(gamepadFix);
      // HDR through Lutris's own gamescope options (0.5.17+); the old
      // variables are removed from system.env.
      let hdr: HdrState | undefined;
      if (isHdrGame(g.name, key)) {
        const p = hdrPlan({ gamescope: lutrisHasGamescopeHdr(g.system), old: hasOldEnv(g.env), ready: hdrReady(hdrSys, install.flatpak) && !!hdrScr });
        hdr = p.state;
        if (p.state === "needed" || p.state === "update") {
          const to = p.gamescope && protonInstalled ? hdrTo(gamepadTo) : null;
          const switchTo = to && (runnerMissing || effective !== to) ? to : null;
          const edits: Edit[] = [
            {
              file: g.configPath,
              format: "yaml",
              mutate: (doc) => {
                for (const v of OLD_HDR_VARS) if (doc.hasIn(["system", "env", v])) doc.deleteIn(["system", "env", v]);
                if (p.gamescope) {
                  for (const [k, v] of Object.entries(lutrisGamescope(g.system, hdrScr!))) doc.setIn(["system", k], v);
                  doc.setIn(["system", "env", "ENABLE_GAMESCOPE_WSI"], "1");
                }
              },
            },
          ];
          if (switchTo) edits.push(setVersion(g.configPath, switchTo));
          const texts = hdrTexts(p.state, p.gamescope, g.name, msg("why.hdrLutris", { game: g.name, ...hdrScreenParams(), runner: hdrRunnerSwitch(switchTo, protonInstalled) }));
          gfixes.push(fix(`${prefix}:hdr:${g.configId}`, "hdr-on", "lutris", texts.label, texts.why, true, edits));
        }
      }
      const mode = modeFor(graphicsMode(g.name, "lutris"), g.args, g.name, `${prefix}:mode:${g.configId}`, "lutris", "why.modeLutris", (change) => editLutrisArgs(g.configPath, change), gfixes);
      games.push({
        key,
        launcher: "lutris",
        store: "lutris",
        id: g.slug,
        title: g.name,
        runner: effective,
        runnerMissing,
        usesOurProton: !!ours && effective === ours,
        envFlags: [],
        support,
        ...gameStates(gamepad, hdr, mode),
        fixes: gfixes,
      });
    }
  }

  // ---- GOG Galaxy and Epic (Windows) ----
  // loop: NOT-WORTH — two stores, Windows only
  for (const id of ["gog", "epic"] as const) {
    const store = deps.windowsStores?.[id];
    if (!store) continue;
    launchers.push({ id, found: store.found, flatpak: false, running: false, protonInstalled: false, defaultRunner: null, defaultIsOurs: false, fixes: [] });
    // loop: HOT-PATH-OK — plain object per store game, no I/O
    for (const g of store.games) {
      games.push({
        key: storeKey(g),
        launcher: id,
        store: id,
        id: g.id,
        title: g.title,
        runner: null,
        runnerMissing: false,
        usesOurProton: false,
        envFlags: [],
        support: g.kind ? "unknown" : dualSenseSupport(g.title),
        fixes: [],
        ...(g.kind ? { kind: g.kind } : {}),
      });
    }
  }

  // ---- System ----
  const rules = findProAudioRules(deps.home);
  const sfixes: Fix[] = [];
  // loop: NOT-WORTH — PipeWire rule files found
  rules
    .filter((r) => r.editable)
    .forEach((r) =>
      sfixes.push(
        fix(
          `system:audio-rule:${idHash(r.path)}`,
          "audio-hifi",
          "system",
          msg("label.audioRule"),
          msg("why.audioRule", { file: r.path.replace(deps.home, "~") }),
          true,
          [{ file: r.path, format: "disable" }],
          {
            kind: "restart-wireplumber",
          },
        ),
      ),
    );
  // loop: NOT-WORTH — DualSense audio cards
  for (const card of deps.audioCards) {
    if (isProAudio(card.activeProfile) && card.hifiProfile && rules.length === 0) {
      sfixes.push(
        fix(
          `system:audio-profile:${idHash(card.name)}`,
          "audio-hifi",
          "system",
          msg("label.audioProfile", { profile: card.hifiProfile }),
          msg("why.audioProfile", { profile: card.activeProfile }),
          true,
          [],
          {
            kind: "set-profile",
            card: card.name,
            profile: card.hifiProfile,
          },
        ),
      );
    }
  }
  // The controller's hardware volume and mic gain, left low by the boot ALSA
  // restore (PipeWire never sets them for the DualSense).
  // loop: NOT-WORTH — connected DualSense sound cards, 0-2; once per scan
  for (const m of deps.mixers ?? []) {
    const changes = lowMixerControls(m.controls);
    if (!changes.length) continue;
    sfixes.push(fix(`system:audio-volume:${idHash(m.key)}`, "audio-volume", "system", msg("label.audioVolume"), msg("why.audioVolume"), true, [], { kind: "set-mixer", key: m.key, changes }));
  }
  const system: SystemInfo = {
    audioProfile: deps.audioCards[0]?.activeProfile ?? null,
    // loop: NOT-WORTH — DualSense audio cards
    proAudio: deps.audioCards.some((c) => isProAudio(c.activeProfile)),
    // loop: NOT-WORTH — PipeWire rule files found
    proAudioRules: rules.map((r) => r.path.replace(deps.home, "~")),
    envWarnings: findGlobalSdlVars(deps.home),
    hidrawAccess: hidrawAccess(),
    hdr: hdrSys,
    fixes: sfixes,
  };

  return {
    report: {
      ourProton: {
        name: ours,
        latest: deps.latestProton,
        latestSize: deps.latestSize,
        // Only a strictly newer published build counts; an older one is never offered.
        updateAvailable: !!deps.latestProton && (!ours || compareProtonNames(deps.latestProton, ours) > 0),
      },
      launchers,
      games,
      system,
      scannedAt: new Date().toISOString(),
    },
    plan,
  };
}

export interface ApplyDeps {
  backups: Backups;
  // Closes and reopens launchers around the write (processes.ts). Checked
  // again immediately before writing: a launcher started after the scan
  // would overwrite the changes when it quits.
  launchers: LauncherControl;
  restartWirePlumber: () => Promise<void>;
  setCardProfile: (card: string, profile: string) => Promise<void>;
  setMixer?: (key: string, changes: MixerChange[]) => Promise<void>; // Linux: the controller's ALSA controls (system.ts setDualSenseMixer)
}

// Running launchers that own one of these changes: `allowed` (the ones the
// page said it will close and reopen) and the rest, which block.
// error: SHOWN — desktop.games.restartGameRunning (useRestartText names the launcher: restartGameRunning / restartTimeout / restartFailed / launcherStarted; Apply and Undo on Home and the game page)
export function launchersToRestart(owners: Iterable<string>, running: Set<LauncherId>, allowed: RestartList): { restart: LauncherId[]; blockedBy: LauncherId[] } {
  const busy = [...new Set(owners)].filter((l): l is LauncherId => l !== "system" && running.has(l as LauncherId));
  return { restart: busy.filter((l) => (allowed as string[]).includes(l)), blockedBy: busy.filter((l) => !(allowed as string[]).includes(l)) };
}

export async function applyFixes(fresh: Scan, fixIds: string[], allowed: RestartList, deps: ApplyDeps): Promise<ApplyResult> {
  const selected = fixIds.map((id) => fresh.plan.get(id));
  const unknown = fixIds.filter((_, i) => !selected[i]);
  const chosen = selected.filter((p): p is Planned => !!p);

  const running = new Set([...fresh.report.launchers.filter((l) => l.running).map((l) => l.id), ...(await deps.launchers.running())]);
  const { restart, blockedBy } = launchersToRestart(
    chosen.map((p) => p.fix.launcher),
    running,
    allowed,
  );
  if (blockedBy.length) return { applied: [], backupId: null, blockedBy };
  // Once more with the named launchers closed: one that owns a change and
  // started meanwhile blocks the write (the page names it, then asks again).
  const run = await withLaunchersClosed(restart, deps.launchers, async () => {
    const late = await startedSince(
      chosen.map((p) => p.fix.launcher),
      deps.launchers,
    );
    return late.length ? { applied: [], backupId: null, blockedBy: late } : writeChosen(chosen, unknown, deps);
  });
  if (!run.ok) return { applied: [], backupId: null, blockedBy: restart, problem: run.problem };
  return run.reopenFailed.length ? { ...run.value, reopenFailed: run.reopenFailed } : run.value;
}

// Owners of a change running right before the write (the ones named were closed by then).
export async function startedSince(owners: Iterable<string>, launchers: LauncherControl): Promise<LauncherId[]> {
  return launchersToRestart(owners, await launchers.running(), []).blockedBy;
}

async function writeChosen(chosen: Planned[], unknown: string[], deps: ApplyDeps): Promise<ApplyResult> {
  // Group edits by file (each file is read and written once), keeping its owner.
  const byFile = new Map<string, { owner: Owner; edits: Edit[] }>();
  for (const p of chosen) {
    // loop: NOT-WORTH — edits of the chosen fixes, in memory
    for (const e of p.edits) {
      const entry = byFile.get(e.file) ?? { owner: p.fix.launcher, edits: [] };
      entry.edits.push(e);
      byFile.set(e.file, entry);
    }
  }
  // loop: NOT-WORTH — edited files, in memory
  const files = [...byFile].flatMap(([file, { owner, edits }]) => (edits.some((e) => e.format === "disable") ? [file, `${file}.disabled`] : [file]).map((path) => ({ path, owner })));

  // Post actions run once each, whatever number of fixes asked for them.
  const posts = new Map<string, PostAction>();
  for (const p of chosen) if (p.post) posts.set(JSON.stringify(p.post), p.post);
  const restartsAudio = [...posts.values()].some((p) => p.kind === "restart-wireplumber");
  // The old mixer values go into the change set, so Undo can put them back.
  const mixer = [...posts.values()].flatMap((p) => (p.kind === "set-mixer" ? [{ key: p.key, changes: p.changes }] : []));

  const applied: ApplyResult["applied"] = unknown.map((id) => ({ id, ok: false, message: msg("result.stale") }));
  let backupId: string | null = null;
  if (byFile.size || mixer.length) {
    backupId = deps.backups.run(
      chosen.map((p) => p.fix.label),
      files,
      () => {
        for (const [file, { edits }] of byFile) writeEdits(file, edits);
      },
      restartsAudio ? ["restart-wireplumber"] : [],
      mixer,
    );
  }
  const postErrors = new Map<string, Msg>();
  // loop: SERIAL-REQUIRED — process order: WirePlumber restart and profile switch must not overlap
  for (const [key, post] of posts) {
    try {
      if (post.kind === "restart-wireplumber") await deps.restartWirePlumber();
      else if (post.kind === "set-mixer") {
        if (!deps.setMixer) throw new Error("No mixer access.");
        await deps.setMixer(post.key, post.changes);
      } else await deps.setCardProfile(post.card, post.profile);
    } catch (cause) {
      // error: SHOWN — desktop.games.msg.result.restartFailed (or volumeFailed / profileFailed, on the change's row in the Done list)
      const failed = post.kind === "restart-wireplumber" ? "result.restartFailed" : post.kind === "set-mixer" ? "result.volumeFailed" : "result.profileFailed";
      postErrors.set(key, msg(failed, { error: errorText(cause) }));
    }
  }
  for (const p of chosen) {
    const message = p.post ? postErrors.get(JSON.stringify(p.post)) : undefined;
    // A failed profile switch means nothing changed; a failed restart still saved the file.
    applied.push({ id: p.fix.id, ok: !(message && p.edits.length === 0), message });
  }
  return { applied, backupId, blockedBy: [] };
}

function writeEdits(file: string, edits: Edit[]): void {
  const format = edits[0].format;
  if (edits.some((e) => e.format !== format)) throw new Error(`Mixed edit formats for ${file}`);
  if (format === "disable") {
    writeFileAtomic(`${file}.disabled`, readFileSync(file));
    unlinkSync(file);
    return;
  }
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (format === "vdf") {
    const doc = parseVdf(text);
    for (const e of edits) (e as Extract<Edit, { format: "vdf" }>).mutate(doc);
    writeFileAtomic(file, serializeVdf(doc));
  } else if (format === "json") {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`);
    const doc = parsed as Record<string, unknown>;
    for (const e of edits) (e as Extract<Edit, { format: "json" }>).mutate(doc);
    writeFileAtomic(file, JSON.stringify(doc, null, 2));
  } else {
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error(`${file}: ${doc.errors[0].message}`);
    for (const e of edits) (e as Extract<Edit, { format: "yaml" }>).mutate(doc);
    writeFileAtomic(file, String(doc));
  }
}
