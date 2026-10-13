// Which screens have HDR on right now (Games page, Linux), for the "Turn on
// HDR" fix: Proton can only give a game HDR as a native Wayland window, on a
// screen the desktop runs in HDR. Read-only: KDE Plasma's `kscreen-doctor -o`
// (fixed argv, no shell, 5 s timeout). Other desktops have no read-only check
// we can rely on, so the fix isn't offered there and the page says why.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HdrScreens } from "../../../src/desktop/games/types";

const run = promisify(execFile);

export interface KscreenOutput {
  name: string; // connector, e.g. DP-5
  enabled: boolean;
  connected: boolean;
  hdr: string; // "enabled", "disabled", "incapable", or "" when not listed
}

// kscreen-doctor colours its output (ANSI codes) even into a pipe.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

// Parse `kscreen-doctor -o`: one "Output: <id> <connector> <uuid>" block per
// output, with "enabled"/"disabled", "connected"/"disconnected" and "HDR: <state>" lines.
export function parseKscreenOutputs(text: string): KscreenOutput[] {
  const clean = text.replace(ANSI, "");
  return clean
    .split(/^Output:/m)
    .slice(1)
    .flatMap((block) => {
      const name = /^\s*\d+\s+(\S+)/.exec(block)?.[1];
      if (!name) return [];
      const lines = block.split("\n").map((l) => l.trim());
      return [
        {
          name,
          enabled: lines.includes("enabled"),
          connected: lines.includes("connected"),
          hdr: /^HDR:\s*(\S+)/m.exec(lines.join("\n"))?.[1]?.toLowerCase() ?? "",
        },
      ];
    });
}

// Connected, enabled screens with HDR on.
export const hdrOutputs = (text: string): string[] =>
  parseKscreenOutputs(text)
    .filter((o) => o.enabled && o.connected && o.hdr === "enabled")
    .map((o) => o.name);

type Runner = (cmd: string, args: string[], opts: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }) => Promise<{ stdout: string }>;

export async function hdrScreens(env: NodeJS.ProcessEnv = process.env, exec: Runner = run): Promise<HdrScreens> {
  if (!env.WAYLAND_DISPLAY && env.XDG_SESSION_TYPE !== "wayland") return { check: "x11", outputs: [] };
  if (!/(^|:)KDE(:|$)/i.test(env.XDG_CURRENT_DESKTOP ?? "")) return { check: "other-desktop", outputs: [] };
  try {
    const { stdout } = await exec("kscreen-doctor", ["-o"], { timeout: 5000, env: { ...env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 });
    return { check: "kde", outputs: hdrOutputs(stdout) };
  } catch {
    return { check: "failed", outputs: [] };
  }
}
