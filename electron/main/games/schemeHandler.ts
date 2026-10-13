// Handing game links (steam://, heroic://, lutris:) and folders to the desktop
// on Linux, and asking whether the desktop has an app registered for a link's
// scheme, so the game page can say "is the launcher installed?" only when it
// really isn't.
//
// Both run with the user's real home, not the app's environment: the dev copy
// (tools/dev.sh) runs with HOME set to a test folder, and a launcher that
// wasn't running yet would start with that HOME (its own config, login and
// runtime downloads there). Electron's shell.openExternal/openPath pass the
// app's environment on, so Linux uses xdg-open directly: fixed argv, no shell.
import { execFile, spawn } from "node:child_process";
import { userInfo } from "node:os";
import { inside } from "./running";

// Variables that describe this app, never the launcher: Electron's and
// Chromium's switches, our own DS5_* dev switches, the AppImage runtime's.
const APP_ONLY = /^(ELECTRON_|CHROME_|DS5_)|^(APPIMAGE|APPDIR|ARGV0|OWD)$/;
// Per-user base folders that may point inside an overridden HOME.
const XDG_HOME_DIRS = new Set(["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]);

/** The environment a launcher gets: the app's, with HOME = the real (passwd)
 * home, XDG base folders inside an overridden HOME removed (so they default
 * under the real one), and app-only variables dropped. */
export function launcherEnv(env: NodeJS.ProcessEnv, realHome: string): NodeJS.ProcessEnv {
  const fakeHome = env.HOME && env.HOME !== realHome ? env.HOME : null;
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || APP_ONLY.test(key)) continue;
    if (fakeHome && XDG_HOME_DIRS.has(key) && inside(value, fakeHome)) continue;
    out[key] = value;
  }
  out.HOME = realHome;
  return out;
}

function realHome(): string {
  try {
    return userInfo().homedir; // the passwd entry, which ignores a HOME override
  } catch {
    return process.env.HOME ?? "/";
  }
}

/** Open a link or folder the main process built (never one from the page)
 * with xdg-open, detached, with the launcher environment. Resolves once
 * xdg-open started (true) or couldn't (false). */
export function openForUser(target: string): Promise<boolean> {
  // Links start with their scheme, folders with "/": never an option.
  if (target.startsWith("-")) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore", env: launcherEnv(process.env, realHome()) });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export function hasSchemeHandler(url: string): Promise<boolean> {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return Promise.resolve(false);
  const env = process.platform === "linux" ? launcherEnv(process.env, realHome()) : process.env;
  return new Promise((resolve) =>
    execFile("xdg-mime", ["query", "default", `x-scheme-handler/${scheme}`], { encoding: "utf8", timeout: 3000, env }, (err, out) =>
      // can't tell (no xdg-mime): let the open attempt decide
      resolve(err ? true : out.trim() !== ""),
    ),
  );
}
