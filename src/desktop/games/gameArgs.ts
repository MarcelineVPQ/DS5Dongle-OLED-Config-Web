// A game's own arguments, the one writer for every launcher: Steam's launch
// options, Heroic's game arguments (`launcherArgs`, split like a shell line)
// and Lutris's `game.args`. In Steam's line the game arguments follow
// %command%; a line without %command% is all game arguments (Steam adds them
// after the game). Everything else in the line stays as it is: variables in
// front (PROTON_PREFER_SDL=1), wrappers (the gamescope HDR line), the
// player's own arguments.
import type { GraphicsApi, ModeInfo } from "./types";
import type { GraphicsMode } from "./knownGames";

export const API_NAME: Record<GraphicsApi, string> = { dx12: "DirectX 12", vulkan: "Vulkan" };

// Flags that pick a graphics mode (Unreal Engine's and the common others),
// and the ones that mean the same mode as a game's own flag.
const MODE_FLAGS = ["-dx11", "-d3d11", "-dx12", "-d3d12", "-vulkan", "-opengl"];
const SAME_MODE: Record<GraphicsApi, string[]> = { dx12: ["-dx12", "-d3d12"], vulkan: ["-vulkan"] };

const argsOf = (line: string) => {
  const at = line.indexOf("%command%");
  // loop: NOT-WORTH — N ≤ ~20 words in one launch line; per known-mode game per scan
  return (at < 0 ? line : line.slice(at + "%command%".length)).split(/\s+/).filter(Boolean);
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// loop: NOT-WORTH — N ≤ ~20 launch arguments; per known-mode game per scan
export const hasArg = (line: string, flag: string) => argsOf(line).some((a) => same(a, flag));

// The line with `flag` added at the end of the game arguments (unchanged if it's there).
// loop: NOT-WORTH — N = 2 parts
export const withArg = (line: string, flag: string) => (hasArg(line, flag) ? line : [line.trim(), flag].filter(Boolean).join(" "));

// Does the line start the game in `mode`, or pick another mode of the player's own?
export function modeInfo(mode: GraphicsMode, line: string): ModeInfo {
  const base = { api: mode.api, flag: mode.flag, unlocks: mode.unlocks };
  const args = argsOf(line);
  // loop: NOT-WORTH — N ≤ ~20 launch arguments; per known-mode game per scan
  if (args.some((a) => same(a, mode.flag) || SAME_MODE[mode.api].includes(a.toLowerCase()))) return { ...base, state: "set" };
  // loop: NOT-WORTH — N ≤ ~20 launch arguments; per known-mode game per scan
  const own = args.find((a) => MODE_FLAGS.includes(a.toLowerCase()));
  return own ? { ...base, state: "own", own } : { ...base, state: "needed" };
}
