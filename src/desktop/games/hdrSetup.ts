// HDR in games on Linux, shared by the scanner (electron/main/games) and the
// Games pages: the game runs inside gamescope (Valve's compositor) as a
// Wayland window with HDR on, on a screen the desktop runs in HDR.
//
// Verified on KDE Plasma 6 (Wayland, HDR on), NVIDIA 615, gamescope 3.16.20,
// GE-Proton11-7.2-DualSense, Indiana Jones and the Great Circle (Vulkan):
//   ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%
// The earlier PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 variant showed a
// black screen (the Wine-Wayland window never appeared), so it is removed
// wherever it's found.
//
// DXVK_HDR=1 (what makes DXVK / vkd3d-proton offer HDR to DirectX games) is
// not added: gamescope's Wayland backend sets it for the game itself, to 1
// when --hdr-enabled and the screen has HDR on, else 0, overwriting any value
// from the launch options (gamescope src/Backends/WaylandBackend.cpp,
// HackUpdatePatchedEdid, since 3.15.0). ENABLE_GAMESCOPE_WSI=1 is gamescope's
// default for nested games too; it stays in the line because that is the line
// verified above.
import type { GameEntry, HdrState, HdrSystem } from "./types";

// The oldest gamescope that works: --backend wayland and --hdr-enabled both
// arrived in 3.15.0 (HDR to the desktop through KDE's frog colour-management
// protocol); GNOME's Mutter only speaks wp_color_management_v1, which gamescope
// supports from 3.16.5.
export const GAMESCOPE_MIN = { kde: "3.15.0", gnome: "3.16.5" } as const;

export const OLD_HDR_VARS = ["PROTON_ENABLE_WAYLAND", "PROTON_ENABLE_HDR"] as const;
export const WSI_ENV = "ENABLE_GAMESCOPE_WSI=1";
export const FLATPAK_GAMESCOPE = "org.freedesktop.Platform.VulkanLayer.gamescope";

export const NO_HDR_SYSTEM: HdrSystem = { check: "unchecked", screens: [], gamescope: { path: null, version: null, min: GAMESCOPE_MIN.kde, layer: false, flatpak: false } };

// a >= b for dotted versions (3.16.14.5 >= 3.16.5).
export function versionAtLeast(a: string, b: string): boolean {
  // loop: NOT-WORTH — N ≤ 4 version parts
  const pa = a.split(".").map(Number);
  // loop: NOT-WORTH — N ≤ 4 version parts
  const pb = b.split(".").map(Number);
  // loop: NOT-WORTH — N ≤ 4 version parts
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}

// The screen with HDR on (the first, if several), and the screen a line is
// made for: that one, else the first screen (the manual line before HDR is on).
// loop: NOT-WORTH — N ≤ 3 screens
export const hdrScreen = (sys: HdrSystem) => sys.screens.find((s) => s.hdr) ?? null;
export const lineScreen = (sys: HdrSystem) => hdrScreen(sys) ?? sys.screens[0] ?? null;

export interface Size {
  width: number;
  height: number;
}
// gamescope's own flags: Wayland backend, HDR, fullscreen at the screen's current mode,
// and relative mouse (games that hide the cursor otherwise lose the mouse).
export const gamescopeFlags = (s: Size) => ["--backend", "wayland", "--hdr-enabled", "-f", "-W", String(s.width), "-H", String(s.height), "--force-grab-cursor"];

// Heroic and Lutris have their own gamescope settings (size, fullscreen, and
// in Lutris HDR and relative mouse); the rest goes in their free-text options.
export const HEROIC_GAMESCOPE_OPTIONS = ["--backend", "wayland", "--hdr-enabled", "--force-grab-cursor"];
export const LUTRIS_GAMESCOPE_FLAGS = "--backend wayland";

// ---- Steam launch options ----
const word = (re: string) => new RegExp(`(^|\\s)${re}(?=\\s|$)`);
const GAMESCOPE = /(^|\s)(\S*\/)?gamescope(?=\s|$)/;
// A gamescope line with --hdr-enabled (ours, or written by hand).
export const hasGamescopeHdr = (opts: string) => GAMESCOPE.test(opts) && word("--hdr-enabled").test(opts);
const OLD_ASSIGN = new RegExp(`(^|\\s)(?:${OLD_HDR_VARS.join("|")})=\\S*`, "g");
export const hasOldHdrVars = (opts: string) => new RegExp(OLD_ASSIGN.source).test(opts);
// Remove PROTON_ENABLE_WAYLAND / PROTON_ENABLE_HDR wherever they are in the line.
export const stripOldHdrVars = (opts: string) =>
  opts
    .replace(OLD_ASSIGN, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const ENV_PREFIX = /^((?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)(?:\s+|$))*)/;
// The launch options with the game inside gamescope with HDR. The player's own
// variables stay in front (PROTON_PREFER_SDL=1 included), other wrappers
// (mangohud, gamemoderun) go inside gamescope, game arguments stay after
// %command%. A gamescope of their own keeps its flags and gets ours added.
export function withGamescopeHdr(opts: string, screen: Size): string {
  const rest = stripOldHdrVars(opts);
  if (hasGamescopeHdr(rest)) return rest;
  const at = rest.indexOf("%command%");
  const pre = at < 0 ? "" : rest.slice(0, at).trim();
  const post = (at < 0 ? rest : rest.slice(at + "%command%".length)).trim();
  const env = ENV_PREFIX.exec(pre)![1].trim();
  let wrappers = pre.slice(ENV_PREFIX.exec(pre)![1].length).trim();
  // loop: NOT-WORTH — N = 2 parts; per HDR game per scan
  const envOut = [env, /(^|\s)ENABLE_GAMESCOPE_WSI=/.test(env) ? "" : WSI_ENV].filter(Boolean).join(" ");
  const own = GAMESCOPE.exec(wrappers);
  if (own) {
    wrappers = wrappers.replace(/(^|\s)--backend(?:\s+|=)\S+/, "");
    const end = GAMESCOPE.exec(wrappers)!;
    const cut = end.index + end[0].length;
    wrappers = `${wrappers.slice(0, cut)} --backend wayland --hdr-enabled${wrappers.slice(cut)}`;
    // loop: NOT-WORTH — N = 4 parts; per HDR game per scan
    return [envOut, wrappers, "%command%", post].filter(Boolean).join(" ");
  }
  // loop: NOT-WORTH — N ≤ 10 parts; per HDR game per scan
  return [envOut, "gamescope", ...gamescopeFlags(screen), "--", wrappers, "%command%", post].filter(Boolean).join(" ");
}

// The line for a player setting it up by hand (no other options).
export const manualSteamLine = (screen: Size) => withGamescopeHdr("", screen);

// ---- Requirements checklist (Home -> This computer, and each HDR game's page) ----
export type HdrReqId = "wayland" | "screen" | "gamescope" | "layer" | "proton" | "game" | "runner" | "setup";
export interface HdrReq {
  id: HdrReqId;
  ok: boolean;
  key: string; // text under desktop.hdrCheck.<key>
  params?: Record<string, string>;
}

const mode = (s: Size & { refresh?: number }) => `${s.width}×${s.height}`;

// What this computer needs; `flatpak` for a launcher installed as a Flatpak
// (gamescope and its layer then come from the Flatpak extension).
export function hdrSystemReqs(sys: HdrSystem, o: { ourProton: string | null; flatpak?: boolean }): HdrReq[] {
  const reqs: HdrReq[] = [];
  const wayland = sys.check !== "x11" && sys.check !== "unchecked";
  reqs.push({ id: "wayland", ok: wayland, key: wayland ? "wayland.ok" : "wayland.no" });
  const scr = hdrScreen(sys);
  if (scr) reqs.push({ id: "screen", ok: true, key: "screen.ok", params: { screen: scr.name, mode: mode(scr) } });
  else reqs.push({ id: "screen", ok: false, key: sys.check === "kde" || sys.check === "gnome" ? `screen.off.${sys.check}` : `screen.${sys.check}` });
  const g = sys.gamescope;
  if (o.flatpak) {
    reqs.push({ id: "gamescope", ok: g.flatpak, key: g.flatpak ? "gamescope.flatpakOk" : "gamescope.flatpakNo", params: { ext: FLATPAK_GAMESCOPE } });
  } else {
    if (!g.path) reqs.push({ id: "gamescope", ok: false, key: "gamescope.no", params: { min: g.min } });
    else if (!g.version) reqs.push({ id: "gamescope", ok: false, key: "gamescope.unknown", params: { min: g.min } });
    else if (!versionAtLeast(g.version, g.min)) reqs.push({ id: "gamescope", ok: false, key: "gamescope.old", params: { version: g.version, min: g.min } });
    else reqs.push({ id: "gamescope", ok: true, key: "gamescope.ok", params: { version: g.version } });
    reqs.push({ id: "layer", ok: g.layer, key: g.layer ? "layer.ok" : "layer.no" });
  }
  reqs.push(o.ourProton ? { id: "proton", ok: true, key: "proton.ok", params: { proton: o.ourProton } } : { id: "proton", ok: false, key: "proton.no" });
  return reqs;
}

// Everything the fix itself needs (our Proton is recommended, not required:
// gamescope gives any Proton HDR; ours adds the DualSense's triggers and haptics).
export const hdrReady = (sys: HdrSystem, flatpak = false) =>
  // loop: NOT-WORTH — N ≤ 6 requirements; per HDR game per scan
  hdrSystemReqs(sys, { ourProton: "-", flatpak })
    .filter((r) => r.id !== "proton")
    .every((r) => r.ok);

// The full list for one game's page.
export function hdrGameReqs(sys: HdrSystem, game: Pick<GameEntry, "hdr" | "usesOurProton" | "runner">, o: { ourProton: string | null; flatpak?: boolean }): HdrReq[] {
  const state: HdrState = game.hdr ?? "missing";
  return [
    ...hdrSystemReqs(sys, o),
    { id: "game", ok: true, key: "game.ok" },
    game.usesOurProton ? { id: "runner", ok: true, key: "runner.ok" } : { id: "runner", ok: false, key: "runner.no", params: { runner: game.runner ?? "" } },
    { id: "setup", ok: state === "set", key: `setup.${state}` },
  ];
}
