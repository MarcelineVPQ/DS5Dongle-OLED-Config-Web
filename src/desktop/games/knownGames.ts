// Games known to use the DualSense natively (from the firmware repo's
// DUALSENSE_GAME_LIST.md, tested through the dongle). Matched by normalized
// title, since app ids differ between Steam, Epic and GOG.
//   triggers: adaptive triggers (and haptics)
//   haptics:  haptics, little or no trigger use
//   xinput:   XInput-only on PC: rumble, never adaptive triggers (any OS)
// Tags:
//   hdr:      the PC version has HDR output (Windows-only games: the Games
//             page may move them to another Proton for it)
import type { DualSenseSupport, GraphicsApi, Store, Unlock } from "./types";

type Tag = "hdr";
const KNOWN: Array<[string, DualSenseSupport, ...Tag[]]> = [
  ["Cyberpunk 2077", "triggers", "hdr"],
  ["The Last of Us Part I", "triggers", "hdr"],
  ["Marvel's Spider-Man Remastered", "triggers", "hdr"],
  ["Marvel's Spider-Man: Miles Morales", "triggers", "hdr"],
  ["Marvel's Spider-Man 2", "triggers", "hdr"],
  ["Uncharted: Legacy of Thieves Collection", "triggers", "hdr"],
  ["Ghost of Tsushima", "triggers", "hdr"],
  ["Hogwarts Legacy", "triggers", "hdr"],
  ["Avatar: Frontiers of Pandora", "triggers", "hdr"],
  ["Assassin's Creed Shadows", "triggers", "hdr"],
  ["Indiana Jones and the Great Circle", "triggers", "hdr"],
  ["Star Wars: Galactic Racer", "triggers"],
  ["Star Wars Jedi: Fallen Order", "triggers"],
  ["Star Wars Jedi: Survivor", "triggers", "hdr"],
  ["LEGO Star Wars: The Skywalker Saga", "triggers"],
  ["Metro Exodus", "triggers"],
  ["Marvel's Guardians of the Galaxy", "triggers"],
  ["F.I.S.T.: Forged In Shadow Torch", "triggers"],
  ["Dakar Desert Rally", "triggers"],
  ["Death Stranding", "triggers", "hdr"],
  ["Death Stranding 2: On the Beach", "triggers"],
  ["Baldur's Gate 3", "haptics"],
  ["Sifu", "haptics"],
  ["The Witcher 3: Wild Hunt", "haptics"],
  ["Forza Horizon 5", "haptics", "hdr"],
  ["Hellblade: Senua's Sacrifice", "haptics"],
  ["Star Wars: Squadrons", "haptics"],
  ["Maneater", "haptics"],
  ["Final Fantasy VII Remake Intergrade", "haptics"],
  ["Ghostrunner", "xinput"],
  ["Control", "xinput"],
];

// Lowercase, unify apostrophes, drop ™®©, punctuation and edition suffixes.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[™®©]/g, "")
    .replace(/\b(director'?s cut|ultimate edition|enhanced edition|game of the year edition|goty|complete edition|definitive edition|deluxe edition|digital deluxe)\b/g, "")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

const TABLE = new Map(KNOWN.map(([title, support, ...tags]) => [normalizeTitle(title), { support, tags }]));

export function dualSenseSupport(title: string): DualSenseSupport {
  return TABLE.get(normalizeTitle(title))?.support ?? "unknown";
}

// The game has HDR output on PC (our list; players can mark others on the game page).
export const knownHdr = (title: string): boolean => !!TABLE.get(normalizeTitle(title))?.tags.includes("hdr");

// ---- Graphics mode (DirectX 12 / Vulkan) ----
// Games that start in another mode by default and only offer a feature in
// DirectX 12 or Vulkan, with the game argument that starts them in it. Only
// flags confirmed by a public source (cited per entry) or tested here.
//   flag:    the game argument, exactly as the game takes it
//   unlocks: what the player gets in that mode
//   stores:  which store builds take the flag (absent: every build)
// Not here: games that pick the mode in their own settings or config file
// (Metro Exodus) or with a separate executable (Control's Control_DX12.exe).
export interface GraphicsMode {
  api: GraphicsApi;
  flag: string;
  unlocks: Unlock;
  stores?: Store[];
}
const MODES: Array<[string, GraphicsMode]> = [
  // Unreal Engine 4, DirectX 11 by default; Ray Tracing greys out with "The game
  // needs to be started in DirectX12 mode". Tested 2026-10-13 (GOG via Heroic,
  // GE-Proton, NVIDIA: Ray Tracing through vkd3d-proton). Steam discussion
  // https://steamcommunity.com/app/1139900/discussions/0/3003297945136810853
  ["Ghostrunner", { api: "dx12", flag: "-dx12", unlocks: "rayTracing" }],
  // Same engine and default: Intel's support article 000100401 ("This game
  // launches by default in DirectX 11 mode, however ray tracing requires
  // DirectX 12" ... "Key in -dx12 in Launch Options").
  ["Ghostrunner 2", { api: "dx12", flag: "-dx12", unlocks: "rayTracing" }],
];
const MODE_TABLE = new Map(MODES.map(([title, mode]) => [normalizeTitle(title), mode]));

// The graphics mode a game needs for a feature, for this store's build (null: none known).
export function graphicsMode(title: string, store: Store): GraphicsMode | null {
  const mode = MODE_TABLE.get(normalizeTitle(title));
  return mode && (!mode.stores || mode.stores.includes(store)) ? mode : null;
}
