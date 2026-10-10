// Games page engine: scan every launcher (read-only), describe each possible
// change as a Fix (what, why, which files), and apply only the fixes the user
// confirmed. Fix ids are deterministic (`steam0:input:1091500`), so apply()
// re-scans and resolves ids against fresh state: the renderer can never name a
// file, a value, or a stale plan.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { dualSenseSupport } from "../../../src/desktop/games/knownGames";
import type { ApplyResult, DualSenseSupport, Fix, FixKind, GameEntry, GamesReport, LauncherId, LauncherInfo, SystemInfo } from "../../../src/desktop/games/types";
import { Backups, writeFileAtomic } from "./backup";
import { findHeroicInstalls, heroicDefaultWine, heroicTools, listHeroicGames, type HeroicInstall, type WineVersion } from "./heroic";
import { findLutrisInstalls, listLutrisGames, lutrisDefaultRunner, lutrisWineBuilds, type LutrisInstall } from "./lutris";
import { hasBuild } from "./proton";
import {
  compatMapping,
  findSteamInstalls,
  installedTools,
  launchOptions,
  listSteamGames,
  readVdfFile,
  steamInputState,
  STEAM_TOOL_PRIORITY_DEFAULT,
  STEAM_TOOL_PRIORITY_GAME,
  type SteamInstall,
} from "./steam";
import { findGlobalSdlVars, findProAudioRules, hidrawAccess, isProAudio, SDL_FORCING_VARS, type AudioCard } from "./system";
import { ensureNode, getNode, getString, parseVdf, serializeVdf, setKey, type VdfNode } from "./vdf";

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
  ourProton: string | null; // folder name of our build (from the manifest, else newest installed)
  latestProton: string | null;
  running: Set<LauncherId>;
  audioCards: AudioCard[];
}

export interface Scan {
  report: GamesReport;
  plan: Map<string, Planned>;
}

const SDL_ASSIGN = new RegExp(`(^|\\s)(${SDL_FORCING_VARS.join("|")})=\\S*`, "g");
export const stripSdlVars = (s: string) =>
  s
    .replace(SDL_ASSIGN, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const nativeSupport = (s: DualSenseSupport) => s === "triggers" || s === "haptics";

function supportWhy(support: DualSenseSupport): string {
  return support === "triggers" ? "This game supports the DualSense's adaptive triggers and haptics." : "This game supports DualSense haptics.";
}

// Newest of our DualSense builds visible anywhere (used when the manifest is unreachable).
export function newestLocalBuild(names: string[]): string | null {
  const ours = names.filter((n) => /^GE-Proton[\w.-]*DualSense$/.test(n));
  return ours.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null;
}

export function scan(deps: ScanDeps): Scan {
  const plan = new Map<string, Planned>();
  const games: GameEntry[] = [];
  const launchers: LauncherInfo[] = [];
  const ours = deps.ourProton;
  const add = (p: Planned) => plan.set(p.fix.id, p);
  const fix = (id: string, kind: FixKind, launcher: Fix["launcher"], label: string, why: string, recommended: boolean, edits: Edit[], post?: PostAction): Fix => {
    const f: Fix = { id, kind, launcher, label, why, files: [...new Set(edits.flatMap((e) => (e.format === "disable" ? [e.file, `${e.file}.disabled`] : [e.file])))], recommended };
    add({ fix: f, edits, post });
    return f;
  };

  // ---- Steam ----
  findSteamInstalls(deps.home).forEach((install, i) => scanSteam(install, `steam${i}`));
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
        fix(
          `${prefix}:default`,
          "set-default",
          "steam",
          `Make ${ours} Steam's default for Windows games`,
          `Steam currently runs Windows games with ${defaultRunner ?? "its own Proton"}. Our build is what makes adaptive triggers and haptics work through the dongle. Games you've set to a specific Proton keep their own setting.`,
          true,
          [
            {
              file: install.configPath,
              format: "vdf",
              mutate: (doc) => {
                const entry = ensureNode(doc, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping", "0");
                setKey(entry, "name", ours);
                if (getString(entry, "config") === undefined) setKey(entry, "config", "");
                if (getString(entry, "priority") === undefined) setKey(entry, "priority", STEAM_TOOL_PRIORITY_DEFAULT);
              },
            },
          ],
        ),
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

    for (const g of listSteamGames(install)) {
      const support = dualSenseSupport(g.name);
      const override = mapping ? (getString(mapping, g.appid, "name") ?? null) : null;
      const effective = override ?? defaultRunner;
      const input = steamInputState(local, g.appid);
      const opts = launchOptions(local, g.appid);
      const envFlags = SDL_FORCING_VARS.filter((v) => new RegExp(`(^|\\s)${v}=`).test(opts));
      const gfixes: Fix[] = [];
      if (nativeSupport(support)) {
        if (ours && protonInstalled && config && effective !== ours && (override !== null || defaultRunner !== ours)) {
          gfixes.push(
            fix(
              `${prefix}:runner:${g.appid}`,
              "set-runner",
              "steam",
              `Run ${g.name} with ${ours}`,
              `${supportWhy(support)} It currently runs with ${effective ?? "Steam's default Proton"}, which doesn't pass the controller's native features through.`,
              true,
              [
                {
                  file: install.configPath,
                  format: "vdf",
                  mutate: (doc) => {
                    const entry = ensureNode(doc, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping", g.appid);
                    setKey(entry, "name", ours);
                    if (getString(entry, "config") === undefined) setKey(entry, "config", "");
                    if (getString(entry, "priority") === undefined) setKey(entry, "priority", STEAM_TOOL_PRIORITY_GAME);
                  },
                },
              ],
            ),
          );
        }
        // Only a per-game "forced on" is a problem: on "default", games with native
        // DualSense support already opt out of Steam Input (verified with Avatar,
        // Spider-Man, Uncharted, The Last of Us, all flag-free on "default").
        if (local && input === "on" && install.localConfigPath) {
          gfixes.push(
            fix(
              `${prefix}:input:${g.appid}`,
              "steam-input-off",
              "steam",
              `Turn Steam Input off for ${g.name}`,
              `${supportWhy(support)} Steam Input is switched on for this game, so Steam translates the controller into a generic gamepad and the game never sees the DualSense. This is the same as Properties → Controller → "Disable Steam Input" in Steam.`,
              true,
              [{ file: install.localConfigPath, format: "vdf", mutate: (doc) => setKey(ensureNode(doc, "UserLocalConfigStore", "apps", g.appid), "UseSteamControllerConfig", "0") }],
            ),
          );
        }
        if (local && envFlags.length && install.localConfigPath) {
          gfixes.push(
            fix(
              `${prefix}:env:${g.appid}`,
              "remove-env",
              "steam",
              `Remove ${envFlags.join(", ")} from ${g.name}'s launch options`,
              `${envFlags.join(", ")} makes Proton present the controller as an Xbox pad, which turns off adaptive triggers. Launch options become: ${stripSdlVars(opts) || "(empty)"}`,
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
        fixes: gfixes,
      });
    }
  }

  // ---- Heroic ----
  findHeroicInstalls(deps.home).forEach((install, i) => scanHeroic(install, `heroic${i}`));
  function scanHeroic(install: HeroicInstall, prefix: string) {
    const tools = heroicTools(install);
    const protonInstalled = !!ours && tools.includes(ours);
    const ourWine: WineVersion | null = ours && protonInstalled ? { bin: join(install.toolsDir, ours, "proton"), name: ours, type: "proton" } : null;
    const def = heroicDefaultWine(install);
    const defaultIsOurs = !!ours && def?.name === ours && existsSync(def.bin);
    const lfixes: Fix[] = [];
    if (ourWine && !defaultIsOurs) {
      lfixes.push(
        fix(
          `${prefix}:default`,
          "set-default",
          "heroic",
          `Make ${ours} Heroic's default Wine/Proton`,
          `Heroic currently gives new Epic, GOG and Amazon installs ${def?.name ?? "no default"}. This only affects games you install from now on; installed games keep their own setting, and this page checks those one by one.`,
          true,
          [{ file: install.configPath, format: "json", mutate: (doc) => (((doc.defaultSettings ??= {}) as Record<string, unknown>).wineVersion = { ...ourWine }) }],
        ),
      );
    }
    launchers.push({ id: "heroic", found: true, flatpak: install.flatpak, running: deps.running.has("heroic"), protonInstalled, defaultRunner: def?.name ?? null, defaultIsOurs, fixes: lfixes });

    for (const g of listHeroicGames(install)) {
      const support = dualSenseSupport(g.title);
      const runnerMissing = !!g.wineVersion && !existsSync(g.wineVersion.bin);
      const effective = g.wineVersion?.name ?? def?.name ?? null;
      const envFlags = g.env.filter((e) => SDL_FORCING_VARS.includes(e.key) && e.value !== "0" && e.value !== "").map((e) => e.key);
      const hasConfig = existsSync(g.configPath);
      const gfixes: Fix[] = [];
      const setOurs: Edit = { file: g.configPath, format: "json", mutate: (doc) => (((doc[g.appName] ??= {}) as Record<string, unknown>).wineVersion = { ...ourWine }) };
      if (ourWine && hasConfig && (runnerMissing || (nativeSupport(support) && g.wineVersion && g.wineVersion.name !== ours))) {
        gfixes.push(
          fix(
            `${prefix}:runner:${g.appName}`,
            "set-runner",
            "heroic",
            `Run ${g.title} with ${ours}`,
            runnerMissing
              ? `${g.title} is set to ${g.wineVersion!.name}, which is no longer installed (${g.wineVersion!.bin} is missing), so the game can't start.`
              : `${supportWhy(support)} It currently runs with ${effective}, which doesn't pass the controller's native features through.`,
            true,
            [setOurs],
          ),
        );
      }
      if (nativeSupport(support) && envFlags.length && hasConfig) {
        gfixes.push(
          fix(
            `${prefix}:env:${g.appName}`,
            "remove-env",
            "heroic",
            `Remove ${envFlags.join(", ")} from ${g.title}'s environment variables`,
            `${envFlags.join(", ")} makes Proton present the controller as an Xbox pad, which turns off adaptive triggers.`,
            true,
            [
              {
                file: g.configPath,
                format: "json",
                mutate: (doc) => {
                  const cfg = (doc[g.appName] ??= {}) as Record<string, unknown>;
                  if (Array.isArray(cfg.enviromentOptions)) cfg.enviromentOptions = (cfg.enviromentOptions as Array<{ key?: string }>).filter((e) => !SDL_FORCING_VARS.includes(String(e.key)));
                },
              },
            ],
          ),
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
  const steamToolNames = findSteamInstalls(deps.home).flatMap((s) => [...installedTools(s), ...steamCommonProtons(s)]);
  findLutrisInstalls(deps.home).forEach((install, i) => scanLutris(install, `lutris${i}`));
  function scanLutris(install: LutrisInstall, prefix: string) {
    // Native Lutris also lists Steam's compatibility tools; the Flatpak only sees its own dir.
    const visible = new Set([...lutrisWineBuilds(install), ...(install.flatpak ? [] : steamToolNames), "system"]);
    const protonInstalled = !!ours && install.umu && visible.has(ours);
    const def = lutrisDefaultRunner(install);
    const lfixes: Fix[] = [];
    const setVersion = (file: string): Edit => ({ file, format: "yaml", mutate: (doc) => doc.setIn(["wine", "version"], ours) });
    if (protonInstalled && def !== ours) {
      lfixes.push(
        fix(
          `${prefix}:default`,
          "set-default",
          "lutris",
          `Make ${ours} Lutris's default Wine version`,
          `Lutris currently uses ${def ?? "its built-in default"} for Wine games. Games with their own Wine version keep it.`,
          true,
          [setVersion(install.runnerWineYml)],
        ),
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
            `${prefix}:runner:${g.slug}`,
            "set-runner",
            "lutris",
            `Run ${g.name} with ${ours}`,
            runnerMissing
              ? `${g.name} is set to ${g.runner}, which Lutris can't find any more, so the game can't start.`
              : `${supportWhy(support)} It currently runs with ${effective ?? "Lutris's default"}.`,
            true,
            [setVersion(g.configPath)],
          ),
        );
      }
      games.push({
        key: `${prefix}:lutris:${g.slug}`,
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

  // ---- System ----
  const rules = findProAudioRules(deps.home);
  const sfixes: Fix[] = [];
  rules
    .filter((r) => r.editable)
    .forEach((r, i) =>
      sfixes.push(
        fix(
          `system:audio-rule:${i}`,
          "audio-hifi",
          "system",
          `Turn off the audio rule that forces the controller onto "pro-audio"`,
          `${r.path.replace(deps.home, "~")} switches the DualSense's audio card to the pro-audio profile, which makes GE-Proton 11 send zero-force triggers and no haptics. The file is renamed to .disabled (not deleted) and the audio service (WirePlumber) restarts, so sound drops for a second.`,
          true,
          [{ file: r.path, format: "disable" }],
          { kind: "restart-wireplumber" },
        ),
      ),
    );
  for (const card of deps.audioCards) {
    if (isProAudio(card.activeProfile) && card.hifiProfile && rules.length === 0) {
      sfixes.push(
        fix(
          `system:audio-profile:${card.name}`,
          "audio-hifi",
          "system",
          `Switch the controller's audio to the "${card.hifiProfile}" profile`,
          `The DualSense's audio card is on "${card.activeProfile}", which makes GE-Proton 11 send zero-force triggers and no haptics. No files change; it's the same as picking the profile in your sound settings.`,
          true,
          [],
          { kind: "set-profile", card: card.name, profile: card.hifiProfile },
        ),
      );
    }
  }
  const system: SystemInfo = {
    audioProfile: deps.audioCards[0]?.activeProfile ?? null,
    proAudioRules: rules.map((r) => r.path.replace(deps.home, "~")),
    envWarnings: findGlobalSdlVars(deps.home),
    hidrawAccess: hidrawAccess(),
    fixes: sfixes,
  };

  return {
    report: {
      ourProton: { name: ours, latest: deps.latestProton, updateAvailable: !!deps.latestProton && deps.latestProton !== ours },
      launchers,
      games,
      system,
      scannedAt: new Date().toISOString(),
    },
    plan,
  };
}

function steamCommonProtons(install: SteamInstall): string[] {
  // Valve's Proton builds live in steamapps/common/<name>/proton.
  const lf = readVdfFile(join(install.root, "steamapps/libraryfolders.vdf"));
  const libs = new Set([install.root]);
  for (const [, e] of getNode(lf ?? [], "libraryfolders") ?? []) if (typeof e !== "string" && getString(e, "path")) libs.add(getString(e, "path")!);
  const out: string[] = [];
  for (const lib of libs) {
    for (const name of ["Proton - Experimental", "Proton Hotfix", "Proton 11.0", "Proton 10.0", "Proton 9.0 (Beta)", "Proton 9.0", "Proton 8.0"]) {
      if (hasBuild(join(lib, "steamapps/common"), name)) out.push(name);
    }
  }
  return out;
}

export interface ApplyDeps {
  backups: Backups;
  restartWirePlumber: () => Promise<void>;
  setCardProfile: (card: string, profile: string) => Promise<void>;
}

export async function applyFixes(fresh: Scan, fixIds: string[], deps: ApplyDeps): Promise<ApplyResult> {
  const selected = fixIds.map((id) => fresh.plan.get(id));
  const unknown = fixIds.filter((_, i) => !selected[i]);
  const chosen = selected.filter((p): p is Planned => !!p);

  const running = new Set(fresh.report.launchers.filter((l) => l.running).map((l) => l.id));
  const blockedBy = [...new Set(chosen.map((p) => p.fix.launcher).filter((l): l is LauncherId => l !== "system" && running.has(l)))];
  if (blockedBy.length) return { applied: [], backupId: null, blockedBy };

  // Group edits by file, preserving selection order.
  const byFile = new Map<string, Edit[]>();
  for (const p of chosen) for (const e of p.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  const files = [...byFile.keys()].flatMap((f) => (byFile.get(f)!.some((e) => e.format === "disable") ? [f, `${f}.disabled`] : [f]));

  const applied: ApplyResult["applied"] = unknown.map((id) => ({ id, ok: false, message: "This change no longer applies (the setup changed since the last scan)." }));
  let backupId: string | null = null;
  if (byFile.size) {
    const description = chosen.map((p) => p.fix.label).join("; ");
    backupId = deps.backups.run(description, files, () => {
      for (const [file, edits] of byFile) writeEdits(file, edits);
    });
  }
  for (const p of chosen) {
    let ok = true;
    let message: string | undefined;
    if (p.post) {
      try {
        if (p.post.kind === "restart-wireplumber") await deps.restartWirePlumber();
        else await deps.setCardProfile(p.post.card, p.post.profile);
      } catch (cause) {
        ok = !p.edits.length ? false : ok;
        message = `Saved, but ${p.post.kind === "restart-wireplumber" ? "restarting the audio service" : "switching the profile"} failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
    }
    applied.push({ id: p.fix.id, ok, message });
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
