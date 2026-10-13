// Games known to use the DualSense natively (from the firmware repo's
// DUALSENSE_GAME_LIST.md, tested through the dongle). Matched by normalized
// title, since app ids differ between Steam, Epic and GOG.
//   triggers: adaptive triggers (and haptics)
//   haptics:  haptics, little or no trigger use
//   xinput:   XInput-only on PC: rumble, never adaptive triggers (any OS)
// Tags:
//   hdr:      the PC version has HDR output (Windows-only games: the Games
//             page may move them to another Proton for it)
import type { DualSenseSupport } from "./types";

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
