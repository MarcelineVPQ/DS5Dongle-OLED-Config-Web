// The UI checker's fixed game library (tools/check_ui.sh), rebuilt at every
// run so the game pages it renders never depend on what the test copy
// happens to have: a home folder of its own (the checker copy runs with
// HOME set to it, so its game scan never reads your launchers) holding a
// Steam and a Heroic (GOG) install, and the copy's game-library-2.json with
// the player's data for those games:
//   Cyberpunk 2077 (Steam)        a profile, a 4-star rating, feedback, notes
//   The Last of Us Part I (Steam) a 2-star rating and notes, no profile
//   Portal 2 (Steam)              nothing of the player's
//   The Witcher 3 (GOG, Heroic)   nothing of the player's
//   The Witcher 3 (Steam)         the same name in a second launcher: both
//                                 list rows carry their launcher's label
// None has artwork, so every game page shows the art fallback.
// Your desktop color scheme (kdeglobals) is copied in, so Match desktop
// still shows yours.
//
//   node tools/seed_test_library.mjs <checker state dir>   (e.g. tmp/check)
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const state = resolve(process.argv[2] ?? "tmp/check");
const home = join(state, "home");
const userdata = join(state, "userdata");

// The app's own key hash (a launcher install's key prefix) and library
// schema, bundled from the sources (packages stay external).
const entry = `
  export { idHash } from "./electron/main/games/games";
  export { LibraryFileSchema } from "./src/desktop/games/library";
`;
const out = await build({ stdin: { contents: entry, resolveDir: ROOT, loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", write: false, logLevel: "silent" });
mkdirSync(state, { recursive: true });
const bundle = join(state, "seed-library.mjs");
writeFileSync(bundle, out.outputFiles[0].text);
const { idHash, LibraryFileSchema } = await import(pathToFileURL(bundle).href);
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

rmSync(home, { recursive: true, force: true });

// ---- Steam: config.vdf (marks the install) and one manifest per game ----
const steamRoot = join(home, ".local/share/Steam");
write(join(steamRoot, "config/config.vdf"), `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t}\n\t\t}\n\t}\n}\n`);
const STEAM = [
  ["1091500", "Cyberpunk 2077"],
  ["1888930", "The Last of Us Part I"],
  ["620", "Portal 2"],
  ["292030", "The Witcher 3: Wild Hunt"],
];
for (const [appid, name] of STEAM)
  write(
    join(steamRoot, `steamapps/appmanifest_${appid}.acf`),
    `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${name}"\n\t"SizeOnDisk"\t\t"1073741824"\n\t"buildid"\t\t"1000"\n\t"LastUpdated"\t\t"1760000000"\n}\n`,
  );
const steamKey = (appid) => `steam-${idHash(realpathSync(steamRoot))}:steam:${appid}`;

// ---- Heroic: one installed GOG game ----
const heroicRoot = join(home, ".config/heroic");
write(join(heroicRoot, "config.json"), JSON.stringify({ defaultSettings: {} }) + "\n");
write(join(heroicRoot, "gog_store/installed.json"), JSON.stringify({ installed: [{ appName: "1207664663", platform: "windows" }] }) + "\n");
write(join(heroicRoot, "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "1207664663", title: "The Witcher 3: Wild Hunt" }] }) + "\n");

// ---- Your desktop colors, for Match desktop ----
const kde = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "kdeglobals");
if (existsSync(kde)) copyFileSync(kde, join(home, ".config/kdeglobals"));

// ---- The player's data (src/desktop/games/library.ts LibraryFileSchema) ----
const ratedOn = { app: "1.0.0", build: "1000", at: 1760000000000 };
const library = {
  version: 1,
  games: {
    [steamKey("1091500")]: {
      title: "Cyberpunk 2077",
      profile: { settings: { format: 2, hapticsGain: 4, speakerVolume: -6, lightbarMode: 2, buttonLayout: "fixture-southpaw" }, updated: 1760000000000 },
      mine: { rating: 4, tags: ["triggers-work", "haptics-work", "weak-vibration"], ratedOn, notes: "Fixture notes: triggers feel right on the bow." },
    },
    [steamKey("1888930")]: {
      title: "The Last of Us Part I",
      mine: { rating: 2, ratedOn, notes: "Fixture notes: no profile, rated only." },
    },
  },
  layouts: {
    "fixture-southpaw": { name: "Southpaw", table: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], updated: 1760000000000 },
  },
};
// A fixture the app would set aside as bad would leave the library empty.
LibraryFileSchema.parse(library);
mkdirSync(userdata, { recursive: true });
writeFileSync(join(userdata, "game-library-2.json"), JSON.stringify(library, null, 2) + "\n");
console.log(`== Test library: ${STEAM.length + 1} games in ${home}`);
