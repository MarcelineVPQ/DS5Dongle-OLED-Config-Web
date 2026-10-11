// Whether the desktop has an app registered for a link's scheme (steam://,
// heroic://, lutris:), so the game page can say "is the launcher installed?"
// only when it really isn't. Linux: xdg-mime's default handler. Async, so a
// slow xdg-mime never freezes the main process.
import { execFile } from "node:child_process";

export function hasSchemeHandler(url: string): Promise<boolean> {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return Promise.resolve(false);
  return new Promise((resolve) =>
    execFile("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8", timeout: 3000 }, (err, out) =>
      // can't tell (no xdg-mime): let the open attempt decide
      resolve(err ? true : out.trim() !== ""),
    ),
  );
}
