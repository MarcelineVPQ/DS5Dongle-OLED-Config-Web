// Whether the desktop has an app registered for a link's scheme (steam://,
// heroic://, lutris:), so the game page can say "is the launcher installed?"
// only when it really isn't. Linux: xdg-mime's default handler.
import { execFileSync } from "node:child_process";

export function hasSchemeHandler(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return false;
  try {
    return execFileSync("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8", timeout: 3000 }).trim() !== "";
  } catch {
    return true; // can't tell (no xdg-mime): let the open attempt decide
  }
}
