import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups, UndoConflictError, writeFileAtomic } from "../../electron/main/games/backup";
import { applyFixes, idHash, newestLocalBuild, scan, stripSdlVars, type ScanDeps } from "../../electron/main/games/games";
import { checkArchiveEntries, checkUnpackedTree } from "../../electron/main/games/proton";
import { forcesProAudio, parseDualSenseCards } from "../../electron/main/games/system";
import { BackupIdSchema, FixIdsSchema } from "../../electron/main/ipc";
import { dualSenseSupport } from "../../src/desktop/games/knownGames";
import type { LauncherId } from "../../src/desktop/games/types";

const OURS = "GE-Proton11-7-DualSense";
const fixture = (name: string) => readFileSync(new URL(`../fixtures/games/${name}`, import.meta.url), "utf8");

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

// A home folder with one problem of each kind:
//   Steam:  FF7 Remake has Steam Input forced on; Avatar has PROTON_PREFER_SDL
//   Heroic: default is GE-Proton-latest; Battle.net points at a deleted Proton;
//           Control (XInput-only) sets PROTON_PREFER_SDL on purpose
//   Lutris: default is Proton - Experimental
function buildHome(home: string) {
  const steam = join(home, ".steam/debian-installation");
  write(join(steam, "config/config.vdf"), fixture("config.vdf"));
  write(join(steam, "userdata/1/config/localconfig.vdf"), fixture("localconfig.vdf"));
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  const acf = (id: string, name: string) => write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  acf("1462040", "FINAL FANTASY VII REMAKE INTERGRADE");
  acf("2840770", "Avatar: Frontiers of Pandora");
  acf("1091500", "Cyberpunk 2077");
  acf("1628350", "Steam Linux Runtime 3.0 (sniper)");
  write(join(steam, `compatibilitytools.d/${OURS}/proton`), "");
  write(join(steam, "steamapps/common/Proton - Experimental/proton"), ""); // Valve's build: Lutris can use it

  const heroic = join(home, ".config/heroic");
  const wine = (name: string) => ({ bin: join(heroic, "tools/proton", name, "proton"), name, type: "proton" });
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: { wineVersion: wine("GE-Proton-latest"), keep: 1 }, version: "v0" }, null, 2));
  write(join(heroic, `tools/proton/${OURS}/proton`), "");
  write(join(heroic, "tools/proton/GE-Proton-latest/proton"), "");
  write(join(heroic, "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "bnet", title: "Battle.net", is_installed: true, install: { platform: "windows" } }] }));
  write(
    join(heroic, "GamesConfig/bnet.json"),
    JSON.stringify({ bnet: { wineVersion: { bin: "/nowhere/GE-Proton10-34/bin/wine", name: "GE-Proton10-34", type: "wine" }, other: true }, version: "v0", explicit: true }, null, 2),
  );
  write(join(heroic, "gog_store/installed.json"), JSON.stringify({ installed: [{ appName: "2049187585", platform: "windows" }] }));
  write(join(heroic, "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "2049187585", title: "Control Ultimate Edition" }] }));
  write(
    join(heroic, "GamesConfig/2049187585.json"),
    JSON.stringify({ "2049187585": { wineVersion: wine(OURS), enviromentOptions: [{ key: "PROTON_PREFER_SDL", value: "1" }] }, version: "v0", explicit: true }, null, 2),
  );
  write(join(heroic, "store_cache/nile_library.json"), "{}");
  write(join(heroic, "store_cache/nile_install_info.json"), "{}");

  const lutris = join(home, ".local/share/lutris");
  write(join(lutris, "runners/wine.yml"), "wine:\n  version: Proton - Experimental\n");
  write(join(lutris, "runtime/umu/umu-run"), "");
  write(join(lutris, "games/tool-1.yml"), "game:\n  exe: tool.exe\nwine:\n  version: Proton - Experimental\n");
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('tool', 'Some Tool', 'wine', 1, 'tool-1')");
  db.close();
}

let home: string;
let backups: Backups;
const deps = (running: LauncherId[] = []): ScanDeps => ({ home, ourProton: OURS, latestProton: OURS, latestSize: 565186419, running: new Set(running), audioCards: [] });
const applyDeps = (runningNow: LauncherId[] = []) => ({ backups, runningLaunchers: () => new Set(runningNow), restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });
// Ids carry a hash of the install they belong to.
const steamId = () => `steam-${idHash(join(home, ".steam/debian-installation"))}`;
const heroicId = () => `heroic-${idHash(join(home, ".config/heroic"))}`;
const lutrisId = () => `lutris-${idHash(join(home, ".local/share/lutris"))}`;

function snapshot(): Map<string, string> {
  const files = [
    ".steam/debian-installation/config/config.vdf",
    ".steam/debian-installation/userdata/1/config/localconfig.vdf",
    ".config/heroic/config.json",
    ".config/heroic/GamesConfig/bnet.json",
    ".config/heroic/GamesConfig/2049187585.json",
    ".local/share/lutris/runners/wine.yml",
    ".local/share/lutris/games/tool-1.yml",
  ];
  return new Map(files.map((f) => [f, readFileSync(join(home, f), "utf8")]));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ds5-games-"));
  buildHome(home);
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("Games scan (read-only)", () => {
  it("finds exactly the expected problems and leaves deliberate settings alone", () => {
    const before = snapshot();
    const { report, plan } = scan(deps());
    expect([...plan.keys()].sort()).toEqual([`${heroicId()}:default`, `${heroicId()}:runner:bnet`, `${lutrisId()}:default`, `${steamId()}:env:2840770`, `${steamId()}:input:1462040`].sort());
    // Scanning never writes.
    expect(snapshot()).toEqual(before);
    // Runtimes are not games; Control (XInput-only) keeps its PROTON_PREFER_SDL.
    expect(report.games.map((g) => g.title)).not.toContain("Steam Linux Runtime 3.0 (sniper)");
    const control = report.games.find((g) => g.title === "Control Ultimate Edition")!;
    expect(control.envFlags).toEqual(["PROTON_PREFER_SDL"]);
    expect(control.fixes).toEqual([]);
    expect(report.games.find((g) => g.id === "bnet")!.runnerMissing).toBe(true);
  });

  it("produces only ids the IPC schema accepts", () => {
    const ids = [...scan(deps()).plan.keys()];
    expect(FixIdsSchema.safeParse(ids).success).toBe(true);
  });

  it("explains every change with a message key and lists the files it writes", () => {
    const { plan } = scan(deps());
    for (const { fix } of plan.values()) {
      expect(fix.label.key, fix.id).toMatch(/^label\./);
      expect(fix.why.key, fix.id).toMatch(/^why\./);
      expect(fix.files.length, fix.id).toBeGreaterThan(0);
    }
    expect(plan.get(`${steamId()}:env:2840770`)!.fix.why.params?.options).toBe("%command%");
  });
});

describe("Games apply / undo", () => {
  it("edits only the targeted values, and undo restores every file byte for byte", async () => {
    const before = snapshot();
    const fresh = scan(deps());
    const result = await applyFixes(fresh, [...fresh.plan.keys()], applyDeps());
    expect(result.blockedBy).toEqual([]);
    expect(result.applied.every((a) => a.ok)).toBe(true);

    const after = snapshot();
    expect(after.get(".steam/debian-installation/userdata/1/config/localconfig.vdf")).toContain('"1462040"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"');
    expect(after.get(".steam/debian-installation/userdata/1/config/localconfig.vdf")).toContain('"LaunchOptions"\t\t"%command%"');
    expect(JSON.parse(after.get(".config/heroic/config.json")!).defaultSettings).toMatchObject({ keep: 1, wineVersion: { name: OURS, type: "proton" } });
    expect(JSON.parse(after.get(".config/heroic/GamesConfig/bnet.json")!).bnet).toMatchObject({ other: true, wineVersion: { name: OURS } });
    expect(after.get(".local/share/lutris/runners/wine.yml")).toBe(`wine:\n  version: ${OURS}\n`);
    // Untouched: Steam's config.vdf (default already ours), Control, the Lutris game.
    for (const f of [".steam/debian-installation/config/config.vdf", ".config/heroic/GamesConfig/2049187585.json", ".local/share/lutris/games/tool-1.yml"]) expect(after.get(f), f).toBe(before.get(f));
    // Nothing left to fix.
    expect([...scan(deps()).plan.keys()]).toEqual([]);

    backups.restore(result.backupId!);
    expect(snapshot()).toEqual(before);
  });

  it("refuses to write while a launcher that owns a selected change is running", async () => {
    const before = snapshot();
    const fresh = scan(deps(["heroic"]));
    const result = await applyFixes(fresh, [`${heroicId()}:default`, `${lutrisId()}:default`], applyDeps());
    expect(result).toEqual({ applied: [], backupId: null, blockedBy: ["heroic"] });
    expect(snapshot()).toEqual(before);
  });

  it("checks again right before writing (a launcher started after the scan)", async () => {
    const before = snapshot();
    const result = await applyFixes(scan(deps()), [`${lutrisId()}:default`], applyDeps(["lutris"]));
    expect(result.blockedBy).toEqual(["lutris"]);
    expect(snapshot()).toEqual(before);
  });

  it("refuses to undo over changes made after the apply, and undoes a set only once", async () => {
    const fresh = scan(deps());
    const { backupId } = await applyFixes(fresh, [`${lutrisId()}:default`], applyDeps());
    const yml = join(home, ".local/share/lutris/runners/wine.yml");
    const ours = readFileSync(yml, "utf8");
    writeFileSync(yml, ours + "# Lutris saved something\n");
    expect(() => backups.restore(backupId!)).toThrow(UndoConflictError);
    expect(readFileSync(yml, "utf8")).toContain("Lutris saved something");
    writeFileSync(yml, ours);
    expect(backups.restore(backupId!).files).toEqual([yml]);
    expect(() => backups.restore(backupId!)).toThrow(/already undone/);
    expect(backups.list()[0].restored).toBe(true);
    expect(backups.owners(backupId!)).toEqual(["lutris"]);
  });

  it("reports ids that no longer apply instead of guessing", async () => {
    const stale = `${steamId()}:input:999`;
    const result = await applyFixes(scan(deps()), [stale], applyDeps());
    expect(result.applied).toEqual([{ id: stale, ok: false, message: { key: "result.stale" } }]);
    expect(result.backupId).toBeNull();
  });

  it("still lists and restores backups written in the older (English description) format", () => {
    const id = backups.run([{ key: "label.audioRule" }], [{ path: join(home, ".local/share/lutris/runners/wine.yml"), owner: "lutris" }], () => undefined);
    const manifestPath = join(home, "backups", id, "manifest.json");
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete m.changes;
    m.description = "Make X Lutris's default";
    for (const f of m.files) {
      delete f.owner;
      delete f.written;
    }
    writeFileSync(manifestPath, JSON.stringify(m));
    expect(backups.list()[0].changes).toEqual([{ key: "legacy", params: { text: "Make X Lutris's default" } }]);
    expect(backups.owners(id)).toEqual(["lutris"]);
    expect(() => backups.restore(id)).not.toThrow();
  });
});

describe("Games safety helpers", () => {
  it("IPC accepts only fix ids, never paths or values", () => {
    expect(FixIdsSchema.safeParse(["steam-0a1b2c3d:input:1462040", "heroic-0a1b2c3d:runner:1TqTFKnSRmefqbidkNZcxR", "lutris-0a1b2c3d:default", "system:audio-rule:0a1b2c3d"]).success).toBe(true);
    for (const bad of ["/home/user/.config/heroic/config.json", "steam-0a1b2c3d:input:../../x", "heroic-0a1b2c3d:runner:a/b", "steam-0a1b2c3d:default; rm -rf", "steam0:default", ""]) {
      expect(FixIdsSchema.safeParse([bad]).success, bad).toBe(false);
    }
    expect(FixIdsSchema.safeParse(Array(501).fill("lutris-0a1b2c3d:default")).success).toBe(false);
    expect(BackupIdSchema.safeParse("20261010T232532Z-91102c").success).toBe(true);
    expect(BackupIdSchema.safeParse("../../etc").success).toBe(false);
  });

  it("refuses archives that would write outside their one folder", () => {
    expect(checkArchiveEntries([`${OURS}/`, `${OURS}/proton`, `./${OURS}/files/bin/wine`], OURS)).toBeNull();
    expect(checkArchiveEntries([`${OURS}/../evil`], OURS)).toMatch(/Unsafe/);
    expect(checkArchiveEntries(["/etc/passwd"], OURS)).toMatch(/Unsafe/);
    expect(checkArchiveEntries(["other/proton"], OURS)).toMatch(/outside/);
    expect(checkArchiveEntries([], OURS)).toMatch(/empty/);
  });

  it("refuses unpacked builds with links pointing outside the build", () => {
    const root = join(home, "unpacked", OURS);
    mkdirSync(join(root, "files/lib"), { recursive: true });
    symlinkSync("lib", join(root, "files/lib64"));
    symlinkSync("../../proton", join(root, "files/lib/up"));
    expect(checkUnpackedTree(root)).toBeNull();
    symlinkSync("/etc/passwd", join(root, "files/abs"));
    expect(checkUnpackedTree(root)).toMatch(/outside/);
    rmSync(join(root, "files/abs"));
    symlinkSync("../../../escape", join(root, "files/lib/esc"));
    expect(checkUnpackedTree(root)).toMatch(/outside/);
  });

  it("writes through a symlinked config file instead of replacing the link", () => {
    const real = join(home, "dotfiles/wine.yml");
    write(real, "a\n");
    const link = join(home, "linked.yml");
    symlinkSync(real, link);
    writeFileAtomic(link, "b\n");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe("b\n");
  });

  it("strips only the SDL-forcing variables from launch options", () => {
    expect(stripSdlVars("PROTON_PREFER_SDL=1 PROTON_LOG=1 %command%")).toBe("PROTON_LOG=1 %command%");
    expect(stripSdlVars("PROTON_USE_SDL=1 %command% -skipintro")).toBe("%command% -skipintro");
    expect(stripSdlVars("PROTON_PREFER_SDL=1")).toBe("");
  });

  it("matches known DualSense games across store spellings", () => {
    expect(dualSenseSupport("Marvel’s Spider-Man Remastered")).toBe("triggers");
    expect(dualSenseSupport("The Last of Us™ Part I")).toBe("triggers");
    expect(dualSenseSupport("Ghost of Tsushima DIRECTOR'S CUT")).toBe("triggers");
    expect(dualSenseSupport("Control Ultimate Edition")).toBe("xinput");
    expect(dualSenseSupport("Abiotic Factor")).toBe("unknown");
  });

  it("picks the newest of our builds", () => {
    expect(newestLocalBuild(["GE-Proton11-7-DualSense", "GE-Proton11-10-DualSense", "GE-Proton-latest", "GE-Proton10-20260205-DS5"])).toBe("GE-Proton11-10-DualSense");
    expect(newestLocalBuild(["GE-Proton-latest"])).toBeNull();
  });

  it("reads the DualSense card's profile and spots pro-audio rules", () => {
    const pactl = `Card #1\n\tName: alsa_card.usb-Generic-00\n\tProfiles:\n\t\tHiFi: Default\n\tActive Profile: HiFi\nCard #2\n\tName: alsa_card.usb-Sony_Interactive_Entertainment_DualSense_Wireless_Controller_ABC-00\n\tProfiles:\n\t\toff: Off\n\t\tHiFi (Mic, Speaker): Default (sinks: 1)\n\t\tpro-audio: Pro Audio\n\tActive Profile: pro-audio\n`;
    expect(parseDualSenseCards(pactl)).toEqual([
      { name: "alsa_card.usb-Sony_Interactive_Entertainment_DualSense_Wireless_Controller_ABC-00", activeProfile: "pro-audio", hifiProfile: "HiFi (Mic, Speaker)" },
    ]);
    expect(forcesProAudio('matches = [{ device.name = "~alsa_card.usb-Sony_Interactive_Entertainment_DualSense.*" }]\nactions = { update-props = { device.profile = "pro-audio" } }')).toBe(true);
    expect(forcesProAudio('# device.profile = "pro-audio" for the DualSense (disabled)\n')).toBe(false);
  });
});

describe("SDL variable handling", () => {
  it("treats =0 and empty as off, everywhere", async () => {
    const { sdlVarsIn, sdlVarForcing } = await import("../../electron/main/games/games");
    expect(sdlVarsIn("PROTON_PREFER_SDL=0 %command%")).toEqual([]);
    expect(sdlVarsIn("PROTON_PREFER_SDL=1 PROTON_USE_SDL=1 %command%")).toEqual(["PROTON_PREFER_SDL", "PROTON_USE_SDL"]);
    expect(sdlVarForcing("PROTON_PREFER_SDL", "")).toBe(false);
  });

  it("keeps spacing inside other arguments", async () => {
    const { stripSdlVars } = await import("../../electron/main/games/games");
    expect(stripSdlVars('PROTON_PREFER_SDL=1 %command% --name "a  b"')).toBe('%command% --name "a  b"');
    expect(stripSdlVars("A=1 PROTON_PREFER_SDL=1 %command%")).toBe("A=1 %command%");
    expect(stripSdlVars("PROTON_PREFER_SDL=0 %command%")).toBe("PROTON_PREFER_SDL=0 %command%");
  });
});
