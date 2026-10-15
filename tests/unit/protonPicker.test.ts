// The game page's Proton version picker (Linux): every build each launcher
// can run a game with, listed from a made-up home folder (never the real
// launchers' files), our build recommended and first, the current one marked;
// a pick is a "set-proton" fix applied through the one fix engine (backup,
// a running launcher said first, Undo byte for byte).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, idHash, scan, type ScanDeps } from "../../electron/main/games/games";
import { valveToolName } from "../../electron/main/games/steam";
import { FixIdsSchema } from "../../electron/main/ipc";
import type { LauncherControl } from "../../electron/main/games/processes";
import { allFixes, type GameEntry, type LauncherId } from "../../src/desktop/games/types";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7-DualSense";
const OLD = "GE-Proton9-27";

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

let home: string;
let backups: Backups;
const steamRoot = () => join(home, ".local/share/Steam");
const heroicRoot = () => join(home, ".config/heroic");
const lutrisData = () => join(home, ".local/share/lutris");

// Steam: our build (its compatibilitytool.vdf names it), an older GE, Valve's
//   9.0, Experimental and 6.3, and a runtime that isn't a Proton. Cyberpunk
//   is set to ours; Portal 2 follows the default (GE 9-27).
// Heroic: our build and the older GE (tools/proton), a Wine build (tools/wine);
//   The Witcher 3 on the older GE.
// Lutris: our build and a Wine build in runners/wine, umu there; Maneater on
//   the Wine build.
function buildHome() {
  const steam = steamRoot();
  write(
    join(steam, "config/config.vdf"),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n\t\t\t\t\t"0"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${OLD}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"75"\n\t\t\t\t\t}\n\t\t\t\t\t"1091500"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${OURS}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"250"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "userdata/1/config/localconfig.vdf"), `"UserLocalConfigStore"\n{\n}\n`);
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  const acf = (id: string, name: string) => write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  acf("1091500", "Cyberpunk 2077");
  acf("620", "Portal 2");
  write(join(steam, `compatibilitytools.d/${OURS}/proton`), "");
  write(
    join(steam, `compatibilitytools.d/${OURS}/compatibilitytool.vdf`),
    `"compatibilitytools"\n{\n\t"compat_tools"\n\t{\n\t\t"${OURS}"\n\t\t{\n\t\t\t"install_path"\t"."\n\t\t\t"display_name"\t"${OURS}"\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, `compatibilitytools.d/${OLD}/proton`), "");
  for (const v of ["Proton 9.0", "Proton - Experimental", "Proton 6.3"]) write(join(steam, `steamapps/common/${v}/proton`), "");
  write(join(steam, "steamapps/common/Proton BattlEye Runtime/README"), "");

  const heroic = heroicRoot();
  const proton = (name: string) => ({ bin: join(heroic, "tools/proton", name, "proton"), name, type: "proton" });
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: { wineVersion: proton(OURS) }, version: "v0" }, null, 2));
  write(join(heroic, `tools/proton/${OURS}/proton`), "");
  write(join(heroic, `tools/proton/${OLD}/proton`), "");
  write(join(heroic, "tools/wine/wine-ge-8-26/bin/wine"), "");
  write(join(heroic, "gog_store/installed.json"), JSON.stringify({ installed: [{ appName: "1207664663", platform: "windows" }] }));
  write(join(heroic, "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "1207664663", title: "The Witcher 3: Wild Hunt" }] }));
  write(join(heroic, "GamesConfig/1207664663.json"), JSON.stringify({ "1207664663": { wineVersion: proton(OLD), other: true }, version: "v0", explicit: true }, null, 2));

  const lutris = lutrisData();
  write(join(lutris, "runners/wine.yml"), `wine:\n  version: ${OURS}\n`);
  write(join(lutris, "runtime/umu/umu-run"), "");
  write(join(lutris, `runners/wine/${OURS}/proton`), "");
  write(join(lutris, "runners/wine/wine-ge-8-26/bin/wine"), "");
  write(join(lutris, "games/maneater-1.yml"), "game:\n  exe: maneater.exe\nwine:\n  version: wine-ge-8-26\n");
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('maneater', 'Maneater', 'wine', 1, 'maneater-1')");
  db.close();
}

const deps = (running: LauncherId[] = []): ScanDeps => ({ home, ourProton: OURS, latestProton: OURS, latestSize: null, running: new Set(running), audioCards: [] });
const control = (runningNow: LauncherId[]): LauncherControl => ({
  running: () => new Set(runningNow),
  gameRunning: () => false,
  plan: () => null,
  close: async () => "failed",
  reopen: async () => false,
});
const applyDeps = (runningNow: LauncherId[] = []) => ({ backups, launchers: control(runningNow), restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });
const game = (title: string, report = scan(deps()).report): GameEntry => report.games.find((g) => g.title === title)!;
// What the picker shows: "name" with its marks.
const shown = (g: GameEntry) => g.protons!.map((c) => `${c.name}${c.recommended ? " +rec" : ""}${c.current ? " +cur" : ""}`);
const choice = (g: GameEntry, name: string) => g.protons!.find((c) => c.name === name)!.fix!;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-picker-")));
  buildHome();
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("Valve's own Protons by their internal names", () => {
  it("maps the folders Steam installs, and offers nothing it can't name", () => {
    expect(valveToolName("Proton - Experimental")).toBe("proton_experimental");
    expect(valveToolName("Proton Hotfix")).toBe("proton_hotfix");
    expect(valveToolName("Proton 10.0")).toBe("proton_10");
    expect(valveToolName("Proton 9.0 (Beta)")).toBe("proton_9");
    expect(valveToolName("Proton 7.0")).toBe("proton_7");
    expect(valveToolName("Proton 6.3")).toBe("proton_63");
    expect(valveToolName("Proton 5.13")).toBe("proton_513");
    expect(valveToolName("Proton 5.0")).toBe("proton_5");
    expect(valveToolName("Proton EasyAntiCheat Runtime")).toBeNull();
  });
});

describe("the builds each launcher offers (read-only)", () => {
  it("Steam: compatibilitytools.d and Valve's Protons, ours first and recommended, the current one marked", () => {
    const before = readFileSync(join(steamRoot(), "config/config.vdf"), "utf8");
    const cp = game("Cyberpunk 2077");
    expect(shown(cp)).toEqual([`${OURS} +rec +cur`, OLD, "Proton 9.0", "Proton 6.3", "Proton - Experimental"]);
    // A game on the default: the default build is its current one.
    expect(shown(game("Portal 2"))).toContain(`${OLD} +cur`);
    expect(readFileSync(join(steamRoot(), "config/config.vdf"), "utf8")).toBe(before);
  });

  it("Heroic: its own Proton and Wine builds plus Steam's (native Heroic)", () => {
    expect(shown(game("The Witcher 3: Wild Hunt"))).toEqual([`${OURS} +rec`, `${OLD} +cur`, "Proton 9.0", "Proton 6.3", "Proton - Experimental", "wine-ge-8-26"]);
  });

  it("Lutris: its runner builds and Steam's (umu runs the Protons)", () => {
    expect(shown(game("Maneater"))).toEqual([`${OURS} +rec`, OLD, "Proton 9.0", "Proton 6.3", "Proton - Experimental", "wine-ge-8-26 +cur"]);
  });

  it("Lutris without umu: only the Wine builds", () => {
    rmSync(join(lutrisData(), "runtime/umu/umu-run"));
    expect(shown(game("Maneater"))).toEqual(["wine-ge-8-26 +cur"]);
  });

  it("picks are their own fixes: ids the IPC accepts, never a recommended change, each saying what changes", () => {
    const { report, plan, choices } = scan(deps());
    const picks = report.games.flatMap((g) => (g.protons ?? []).flatMap((c) => (c.fix ? [c.fix] : [])));
    expect(picks.length).toBeGreaterThan(10);
    expect(FixIdsSchema.safeParse(picks.map((f) => f.id)).success).toBe(true);
    for (const f of picks) {
      expect(f.kind).toBe("set-proton");
      expect(f.recommended).toBe(false);
      expect(choices.has(f.id)).toBe(true);
      expect(plan.has(f.id)).toBe(false);
      expect(f.files.length).toBe(1);
    }
    expect(allFixes(report).some((f) => f.kind === "set-proton")).toBe(false);
    // Portal 2 follows Steam's default: the choice says a Linux version would switch to Windows.
    expect(choice(game("Portal 2", report), "Proton 9.0").why).toMatchObject({ key: "why.protonPick", params: { current: OLD, note: { key: "why.protonPickDefault" } } });
    expect(choice(game("Cyberpunk 2077", report), "Proton 9.0").why.params?.note).toBe("");
  });

  it("not on Windows (Proton is Linux only)", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      expect(scan(deps()).report.games.every((g) => g.protons === undefined)).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    }
  });
});

describe("a pick goes through the fix engine", () => {
  const files = () => ["config/config.vdf"].map((f) => join(steamRoot(), f)).concat([join(heroicRoot(), "GamesConfig/1207664663.json"), join(lutrisData(), "games/maneater-1.yml")]);
  const snapshot = () => files().map((f) => readFileSync(f, "utf8"));

  it("writes each launcher's own setting, and Undo restores every file byte for byte", async () => {
    const before = snapshot();
    const fresh = scan(deps());
    const ids = [
      choice(game("Cyberpunk 2077", fresh.report), "Proton 9.0").id,
      choice(game("The Witcher 3: Wild Hunt", fresh.report), "wine-ge-8-26").id,
      choice(game("Maneater", fresh.report), OURS).id,
    ];
    const r = await applyFixes(fresh, ids, [], applyDeps());
    expect(r.blockedBy).toEqual([]);
    expect(r.applied.every((a) => a.ok)).toBe(true);
    // Steam: the internal name, in the game's own CompatToolMapping entry.
    expect(readFileSync(join(steamRoot(), "config/config.vdf"), "utf8")).toMatch(/"1091500"\s*\{\s*"name"\s*"proton_9"/);
    expect(JSON.parse(readFileSync(join(heroicRoot(), "GamesConfig/1207664663.json"), "utf8"))["1207664663"]).toEqual({
      wineVersion: { bin: join(heroicRoot(), "tools/wine/wine-ge-8-26/bin/wine"), name: "wine-ge-8-26", type: "wine" },
      other: true,
    });
    expect(readFileSync(join(lutrisData(), "games/maneater-1.yml"), "utf8")).toContain(`version: ${OURS}`);
    // The next scan marks the new builds current.
    const after = scan(deps()).report;
    expect(shown(game("Cyberpunk 2077", after))).toContain("Proton 9.0 +cur");
    expect(shown(game("Maneater", after))).toContain(`${OURS} +rec +cur`);
    backups.restore(r.backupId!);
    expect(snapshot()).toEqual(before);
  });

  it("a running launcher is named first: nothing is written until the page says it will close it", async () => {
    const before = snapshot();
    const fresh = scan(deps(["steam"]));
    const id = choice(game("Cyberpunk 2077", fresh.report), OLD).id;
    expect(await applyFixes(fresh, [id], [], applyDeps(["steam"]))).toEqual({ applied: [], backupId: null, blockedBy: ["steam"] });
    expect(snapshot()).toEqual(before);
  });

  it("a stale pick (the build was removed since) is refused, not guessed", async () => {
    const fresh = scan(deps());
    const id = choice(game("Cyberpunk 2077", fresh.report), "Proton 6.3").id;
    rmSync(join(steamRoot(), "steamapps/common/Proton 6.3"), { recursive: true });
    const r = await applyFixes(scan(deps()), [id], [], applyDeps());
    expect(r.applied).toEqual([{ id, ok: false, message: { key: "result.stale" } }]);
    expect(id).toBe(`steam-${idHash(steamRoot())}:proton:1091500:${idHash("proton_63")}`);
  });
});
