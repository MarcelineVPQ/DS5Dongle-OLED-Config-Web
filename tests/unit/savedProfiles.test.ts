// Game profiles saved by the app before the sections' profile `fields` path
// was taken out (0.9.4 through 0.9.5-dev.17) still load as they were: the
// same library, the same values in the controller view, the file untouched.
// That path only fed the game page's old "All settings" list; profiles were
// always stored as ProfileSettings (no `fields` key), so nothing migrates.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIBRARY_FILE, LibraryStore, OLD_LIBRARY_FILE } from "../../electron/main/games/libraryStore";
import { LibraryFileSchema } from "../../src/desktop/games/library";
import { gameGroups, profileConfig, settingsFrom } from "../../src/desktop/library/profileValues";
import { DEFAULT_CONFIG } from "../../src/protocol/config";

const FIXTURE = readFileSync(join(__dirname, "../fixtures/library/game-library-2.dev17.json"), "utf8");
const CYBERPUNK = "steam-1a2b3c4d:steam:1091500";
const RACER = "steam-1a2b3c4d:steam:2050650";
const QUIET = "heroic-0f0e0d0c:epic:fortnite";

describe("profiles saved before the sections' `fields` path went", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const load = (name: string) => {
    dir = mkdtempSync(join(tmpdir(), "ds5-saved-"));
    writeFileSync(join(dir, name), FIXTURE);
    return new LibraryStore(dir).get();
  };

  it("load whole, as they were saved, with nothing set aside", () => {
    const lib = load(LIBRARY_FILE);
    expect(lib).toEqual(JSON.parse(FIXTURE));
    expect(LibraryFileSchema.safeParse(JSON.parse(FIXTURE)).success).toBe(true);
    // No `.corrupt-` copy and the file isn't rewritten.
    expect(readdirSync(dir)).toEqual([LIBRARY_FILE]);
    expect(readFileSync(join(dir, LIBRARY_FILE), "utf8")).toBe(FIXTURE);
  });

  it("come over from the older apps' library file the same way", () => {
    expect(load(OLD_LIBRARY_FILE)).toEqual(JSON.parse(FIXTURE));
  });

  it("put the same values in the controller view", () => {
    const lib = load(LIBRARY_FILE);
    const normal = lib.restore!.settings;
    const shown = (key: string) => settingsFrom(profileConfig(DEFAULT_CONFIG, normal, lib.games[key].profile!.settings));
    // 0.9.4 format: every value set; no right grip = the same as the left.
    expect(shown(CYBERPUNK)).toEqual({
      ...normal,
      hapticsGain: 2,
      hapticsGainRight: 2,
      autoHapticsEnable: 2,
      autoHapticsGain: 120,
      autoHapticsLowpass: 1,
      lbFavR: [255, 0, 0, 255],
      lbFavG: [0, 255, 0, 255],
      lbFavB: [0, 0, 255, 255],
    });
    // Format 2: what it leaves out is the normal setting.
    expect(shown(RACER)).toEqual({
      ...normal,
      hapticsGain: 4,
      hapticsGainRight: 3,
      speakerVolume: -10,
      lightbarMode: 2,
      lbFavR: [10, 20, 30, 40],
      lbFavG: [50, 60, 70, 80],
      lbFavB: [90, 100, 110, 120],
      triggerReduce: 3,
      speakerGain: 2,
      lockVolume: true,
      micLevel: 40,
      micEchoCancel: false,
    });
    expect(shown(QUIET)).toEqual({ ...normal, btMicEnable: false, audioBufferLength: 96 });
    // The game page's chips: the same groups as this game's own.
    expect(gameGroups(lib.games[QUIET].profile!.settings, normal)).toEqual(["audioBuffer", "mic"]);
    expect(gameGroups(lib.games[RACER].profile!.settings, normal)).toEqual(["grips", "speaker", "lightbar", "favorites", "triggers", "speakerBoost", "volumeLock", "micLevel", "echoCancel"]);
  });
});
