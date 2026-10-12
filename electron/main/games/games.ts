// Games page engine: scan every launcher (read-only), describe each possible
// change as a Fix (what, why, which files), and apply only the fixes the user
// confirmed. Fix ids are deterministic (`steam0:input:1091500`), so apply()
// re-scans and resolves ids against fresh state: the renderer can never name a
// file, a value, or a stale plan.
import { createHash } from "node:crypto";
import { errorText } from "../../../src/errorText";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { dualSenseSupport } from "../../../src/desktop/games/knownGames";
import { compareProtonNames, PROTON_NAME } from "../../../src/update/manifest";
import type { ApplyResult, DualSenseSupport, Fix, FixKind, GameEntry, GamesReport, LauncherId, LauncherInfo, Msg, SystemInfo } from "../../../src/desktop/games/types";
import { Backups, writeFileAtomic, type Owner } from "./backup";
import { findHeroicInstalls, heroicDefaultWine, heroicTools, listHeroicGames, type HeroicInstall, type WineVersion } from "./heroic";
import { findLutrisInstalls, listLutrisGames, lutrisDefaultRunner, lutrisWineBuilds, type LutrisInstall } from "./lutris";
import { hasBuild } from "./proton";
import { steamAppTypes } from "./appinfo";
import { storeKey, type WindowsStores } from "./windowsStores";
import { compatMapping, findSteamInstalls, installedTools, launchOptions, listSteamGames, readVdfFile, setCompatTool, steamInputState, valveProtons, type SteamInstall } from "./steam";
import { findGlobalSdlVars, findProAudioRules, hidrawAccess, isProAudio, sdlVarForcing, SDL_FORCING_VARS, type AudioCard } from "./system";

export { sdlVarForcing };
import { ensureNode, getString, parseVdf, serializeVdf, setKey, type VdfNode } from "./vdf";

// One file edit. Several fixes may edit the same file; apply() loads each file
// once, runs every selected mutation, and writes it once.
type Edit =
  | { file: string; format: "vdf"; mutate: (doc: VdfNode) => void }
  | { file: string; format: "json"; mutate: (doc: Record<string, unknown>) => void }
  | { file: string; format: "yaml"; mutate: (doc: ReturnType<typeof parseDocument>) => void }
  | { file: string; format: "disable"; mutate?: undefined }; // rename to <file>.disabled

type PostAction = { kind: "restart-wireplumber" } | { kind: "set-profile"; card: string; profile: string };

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
  windowsStores?: WindowsStores; // Windows: GOG Galaxy and Epic (Linux has them through Heroic)
}

export interface Scan {
  report: GamesReport;
  plan: Map<string, Planned>;
}

const SDL_ASSIGN = new RegExp(`(^|\\s)(${SDL_FORCING_VARS.join("|")})=(\\S*)`, "g");
export const sdlVarsIn = (opts: string) => [...new Set([...opts.matchAll(SDL_ASSIGN)].filter((m) => sdlVarForcing(m[2], m[3])).map((m) => m[2]))];
// Remove the forcing assignments only; everything else (spacing inside quotes included) stays.
// Each forcing assignment goes together with the one space before it.
export const stripSdlVars = (opts: string) => opts.replace(SDL_ASSIGN, (whole, _lead: string, key: string, value: string) => (sdlVarForcing(key, value) ? "" : whole)).trim();

const nativeSupport = (s: DualSenseSupport) => s === "triggers" || s === "haptics";

// Fix ids are built from what they point at (an install root, a file path),
// never a list position, so an id from the review screen can only resolve to
// the same target in the fresh scan that apply() runs.
export const idHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

// Message helpers (texts live in the locale files under desktop.games.msg).
const msg = (key: string, params?: Msg["params"]): Msg => (params ? { key, params } : { key });
const supportMsg = (support: DualSenseSupport): Msg => msg(support === "triggers" ? "support.triggers" : "support.haptics");
const orMsg = (value: string | null | undefined, fallbackKey: string): string | Msg => value ?? msg(fallbackKey);

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
  const fix = (id: string, kind: FixKind, launcher: Fix["launcher"], label: Msg, why: Msg, recommended: boolean, edits: Edit[], post?: PostAction): Fix => {
    const f: Fix = { id, kind, launcher, label, why, files: [...new Set(edits.flatMap((e) => (e.format === "disable" ? [e.file, `${e.file}.disabled`] : [e.file])))], recommended };
    add({ fix: f, edits, post });
    return f;
  };

  // ---- Steam ----
  const steamInstalls = findSteamInstalls(deps.home);
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
      steamGames.map((g) => g.appid),
    );
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
      const gfixes: Fix[] = [];
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
              [
                {
                  file: install.localConfigPath,
                  format: "vdf",
                  mutate: (doc) => setKey(ensureNode(doc, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps", g.appid), "LaunchOptions", stripSdlVars(opts)),
                },
              ],
            ),
          );
        }
      }
      games.push({
        key: `${prefix}:steam:${g.appid}`,
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
        fixes: playable ? gfixes : [],
        ...(kind && kind !== "game" ? { kind } : {}),
      });
    }
  }

  // ---- Heroic ----
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

    for (const g of listHeroicGames(install)) {
      const support = dualSenseSupport(g.title);
      const runnerMissing = !!g.wineVersion && !existsSync(g.wineVersion.bin);
      const effective = g.wineVersion?.name ?? def?.name ?? null;
      const envFlags = [...new Set(g.env.filter((e) => sdlVarForcing(e.key, e.value)).map((e) => e.key))];
      const hasConfig = existsSync(g.configPath);
      const gfixes: Fix[] = [];
      const setOurs: Edit = { file: g.configPath, format: "json", mutate: (doc) => (((doc[g.appName] ??= {}) as Record<string, unknown>).wineVersion = { ...ourWine }) };
      if (ourWine && hasConfig && (runnerMissing || (nativeSupport(support) && g.wineVersion && g.wineVersion.name !== ours))) {
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
      if (nativeSupport(support) && envFlags.length && hasConfig) {
        gfixes.push(
          fix(`${prefix}:env:${g.appName}`, "remove-env", "heroic", msg("label.envHeroic", { vars: envFlags.join(", "), game: g.title }), msg("why.envHeroic", { vars: envFlags.join(", ") }), true, [
            {
              file: g.configPath,
              format: "json",
              mutate: (doc) => {
                const cfg = (doc[g.appName] ??= {}) as Record<string, unknown>;
                if (Array.isArray(cfg.enviromentOptions))
                  cfg.enviromentOptions = (cfg.enviromentOptions as Array<{ key?: unknown; value?: unknown }>).filter((e) => !sdlVarForcing(String(e.key), String(e.value ?? "")));
              },
            },
          ]),
        );
      }
      games.push({
        key: `${prefix}:${g.store}:${g.appName}`,
        launcher: "heroic",
        store: g.store,
        id: g.appName,
        title: g.title,
        runner: effective,
        runnerMissing,
        usesOurProton: !!ours && effective === ours && !runnerMissing,
        envFlags,
        support,
        fixes: gfixes,
      });
    }
  }

  // ---- Lutris ----
  const steamToolNames = steamInstalls.flatMap((s) => [...installedTools(s), ...valveProtons(s)]);
  findLutrisInstalls(deps.home).forEach((install) => scanLutris(install, `lutris-${idHash(install.dataDir)}`));
  function scanLutris(install: LutrisInstall, prefix: string) {
    // Native Lutris also lists Steam's compatibility tools; the Flatpak only sees its own dir.
    const visible = new Set([...lutrisWineBuilds(install), ...(install.flatpak ? [] : steamToolNames), "system"]);
    const protonInstalled = !!ours && install.umu && visible.has(ours);
    const def = lutrisDefaultRunner(install);
    const lfixes: Fix[] = [];
    const setVersion = (file: string): Edit => ({ file, format: "yaml", mutate: (doc) => doc.setIn(["wine", "version"], ours) });
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

    for (const g of listLutrisGames(install)) {
      const support = dualSenseSupport(g.name);
      const runnerMissing = !!g.runner && !visible.has(g.runner) && !hasBuild(install.wineDir, g.runner);
      const effective = g.runner ?? def;
      const gfixes: Fix[] = [];
      if (protonInstalled && (runnerMissing || (nativeSupport(support) && effective !== ours))) {
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
      games.push({
        key: `${prefix}:lutris:${g.configId}`,
        launcher: "lutris",
        store: "lutris",
        id: g.slug,
        title: g.name,
        runner: effective,
        runnerMissing,
        usesOurProton: !!ours && effective === ours,
        envFlags: [],
        support,
        fixes: gfixes,
      });
    }
  }

  // ---- GOG Galaxy and Epic (Windows) ----
  for (const id of ["gog", "epic"] as const) {
    const store = deps.windowsStores?.[id];
    if (!store) continue;
    launchers.push({ id, found: store.found, flatpak: false, running: false, protonInstalled: false, defaultRunner: null, defaultIsOurs: false, fixes: [] });
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
  const system: SystemInfo = {
    audioProfile: deps.audioCards[0]?.activeProfile ?? null,
    proAudio: deps.audioCards.some((c) => isProAudio(c.activeProfile)),
    proAudioRules: rules.map((r) => r.path.replace(deps.home, "~")),
    envWarnings: findGlobalSdlVars(deps.home),
    hidrawAccess: hidrawAccess(),
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
  // Checked again immediately before writing: a launcher started after the scan
  // would overwrite the changes when it quits.
  runningLaunchers: () => Set<LauncherId>;
  restartWirePlumber: () => Promise<void>;
  setCardProfile: (card: string, profile: string) => Promise<void>;
}

export async function applyFixes(fresh: Scan, fixIds: string[], deps: ApplyDeps): Promise<ApplyResult> {
  const selected = fixIds.map((id) => fresh.plan.get(id));
  const unknown = fixIds.filter((_, i) => !selected[i]);
  const chosen = selected.filter((p): p is Planned => !!p);

  const needs = new Set(chosen.map((p) => p.fix.launcher).filter((l): l is LauncherId => l !== "system"));
  const running = new Set([...fresh.report.launchers.filter((l) => l.running).map((l) => l.id), ...deps.runningLaunchers()]);
  const blockedBy = [...needs].filter((l) => running.has(l));
  if (blockedBy.length) return { applied: [], backupId: null, blockedBy };

  // Group edits by file (each file is read and written once), keeping its owner.
  const byFile = new Map<string, { owner: Owner; edits: Edit[] }>();
  for (const p of chosen) {
    for (const e of p.edits) {
      const entry = byFile.get(e.file) ?? { owner: p.fix.launcher, edits: [] };
      entry.edits.push(e);
      byFile.set(e.file, entry);
    }
  }
  const files = [...byFile].flatMap(([file, { owner, edits }]) => (edits.some((e) => e.format === "disable") ? [file, `${file}.disabled`] : [file]).map((path) => ({ path, owner })));

  // Post actions run once each, whatever number of fixes asked for them.
  const posts = new Map<string, PostAction>();
  for (const p of chosen) if (p.post) posts.set(JSON.stringify(p.post), p.post);
  const restartsAudio = [...posts.values()].some((p) => p.kind === "restart-wireplumber");

  const applied: ApplyResult["applied"] = unknown.map((id) => ({ id, ok: false, message: msg("result.stale") }));
  let backupId: string | null = null;
  if (byFile.size) {
    backupId = deps.backups.run(
      chosen.map((p) => p.fix.label),
      files,
      () => {
        for (const [file, { edits }] of byFile) writeEdits(file, edits);
      },
      restartsAudio ? ["restart-wireplumber"] : [],
    );
  }
  const postErrors = new Map<string, Msg>();
  for (const [key, post] of posts) {
    try {
      if (post.kind === "restart-wireplumber") await deps.restartWirePlumber();
      else await deps.setCardProfile(post.card, post.profile);
    } catch (cause) {
      postErrors.set(key, msg(post.kind === "restart-wireplumber" ? "result.restartFailed" : "result.profileFailed", { error: errorText(cause) }));
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
