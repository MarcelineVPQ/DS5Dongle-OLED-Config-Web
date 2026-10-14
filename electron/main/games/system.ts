// Host checks that silently break native DualSense features on Linux:
//   - the controller's audio card on a pro-audio profile (GE-Proton 11 then
//     sends zero-force triggers and no HD haptics; it must stay on HiFi)
//   - a global PROTON_PREFER_SDL / PROTON_USE_SDL (forces the Xbox path)
//   - no read/write access to the controller's hidraw node
//   - the controller's hardware volume and mic gain left low by the boot ALSA restore
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const DS5_CARD = /^alsa_card\.usb-Sony_Interactive_Entertainment_DualSense(_Edge)?_Wireless_Controller/;
export const SDL_FORCING_VARS = ["PROTON_PREFER_SDL", "PROTON_USE_SDL"];

// Set to anything but "0" or "" forces the Xbox (SDL) path. The one rule used for
// environment files here and for Steam launch options and Heroic env lists (games.ts).
// `PROTON_USE_SDL="0"` / `=''` are off too: compare the value without its quotes.
const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");
export const sdlVarForcing = (key: string, value: string) => SDL_FORCING_VARS.includes(key) && unquote(value) !== "0" && unquote(value) !== "";

export interface AudioCard {
  name: string;
  activeProfile: string;
  hifiProfile: string | null; // exact profile name to switch back to
}

// Parse `pactl list cards` (C locale) for the DualSense card(s).
export function parseDualSenseCards(text: string): AudioCard[] {
  const cards: AudioCard[] = [];
  for (const block of text.split(/^Card #/m).slice(1)) {
    const name = /^\s*Name: (\S+)/m.exec(block)?.[1];
    if (!name || !DS5_CARD.test(name)) continue;
    const activeProfile = /^\s*Active Profile: (.+)$/m.exec(block)?.[1]?.trim() ?? "";
    const profiles = /^\s*Profiles:\n([\s\S]*?)^\s*Active Profile:/m.exec(block)?.[1] ?? "";
    const hifiProfile = /^\s*(HiFi[^:]*):/m.exec(profiles)?.[1]?.trim() ?? null;
    cards.push({ name, activeProfile, hifiProfile });
  }
  return cards;
}

export async function dualSenseCards(): Promise<AudioCard[]> {
  try {
    const { stdout } = await run("pactl", ["list", "cards"], { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 8 * 1024 * 1024, timeout: 5000 });
    return parseDualSenseCards(stdout);
  } catch {
    // error: NOT-WORTH — no pactl (no PipeWire/Pulse): no cards, and the audio check shows the controller as not found
    return [];
  }
}

export const isProAudio = (profile: string) => /pro-audio/i.test(profile);

// A rule file that forces pro-audio onto the DualSense card.
export function forcesProAudio(text: string): boolean {
  // loop: NOT-WORTH — lines of one small PipeWire rule file
  const live = text
    .split("\n")
    .filter((l) => !/^\s*(#|--)/.test(l))
    .join("\n");
  return /pro-audio/.test(live) && /DualSense/i.test(live);
}

export interface ProAudioRule {
  path: string;
  editable: boolean; // in the user's home (system files are reported, not touched)
}

export function findProAudioRules(home: string): ProAudioRule[] {
  const dirs: Array<[string, boolean]> = [
    [join(home, ".config/wireplumber/wireplumber.conf.d"), true],
    [join(home, ".config/wireplumber/main.lua.d"), true],
    [join(home, ".config/pipewire/pipewire.conf.d"), true],
    [join(home, ".config/pipewire/pipewire-pulse.conf.d"), true],
    ["/etc/wireplumber/wireplumber.conf.d", false],
    ["/etc/wireplumber/main.lua.d", false],
  ];
  const out: ProAudioRule[] = [];
  // loop: NOT-WORTH — six fixed rule folders
  for (const [dir, editable] of dirs) {
    let files: string[];
    try {
      // loop: NOT-WORTH — files in one rule folder
      files = readdirSync(dir).filter((f) => f.endsWith(".conf") || f.endsWith(".lua"));
    } catch {
      // error: NOT-WORTH — rule folder missing: no rules there
      continue;
    }
    // loop: NOT-WORTH — rule files, a small read each
    for (const f of files) {
      try {
        if (forcesProAudio(readFileSync(join(dir, f), "utf8"))) out.push({ path: join(dir, f), editable });
      } catch {
        // error: NOT-WORTH — unreadable: skip
      }
    }
  }
  return out;
}

// Environment files that set an SDL-forcing variable for every game.
// Where an SDL-forcing variable is set for every game: a file (shown with ~),
// or null for this session's own environment.
export interface SdlVarSource {
  variable: string;
  file: string | null;
}

export function findGlobalSdlVars(home: string): SdlVarSource[] {
  const files = [join(home, ".profile"), join(home, ".bash_profile"), join(home, ".bashrc"), join(home, ".zshenv"), join(home, ".pam_environment"), "/etc/environment"];
  // loop: NOT-WORTH — three environment folders
  for (const dir of [join(home, ".config/environment.d"), join(home, ".config/plasma-workspace/env"), "/etc/environment.d"]) {
    try {
      // loop: NOT-WORTH — files in one environment folder
      for (const f of readdirSync(dir)) files.push(join(dir, f));
    } catch {
      // error: NOT-WORTH — missing dir
    }
  }
  const out: SdlVarSource[] = [];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?(${SDL_FORCING_VARS.join("|")})\\s*=\\s*["']?([^"'\\s#]*)`, "gm");
  // loop: NOT-WORTH — shell profile and environment files, a small read each
  for (const f of files) {
    try {
      // loop: NOT-WORTH — matches in one profile file
      for (const m of readFileSync(f, "utf8").matchAll(pattern)) {
        if (sdlVarForcing(m[1], m[2])) out.push({ variable: m[1], file: f.startsWith(home) ? f.replace(home, "~") : f });
      }
    } catch {
      // error: NOT-WORTH — missing file
    }
  }
  // loop: NOT-WORTH — SDL-forcing variable names
  for (const v of SDL_FORCING_VARS) if (sdlVarForcing(v, process.env[v] ?? "")) out.push({ variable: v, file: null });
  return out;
}

// true/false for a connected DualSense's hidraw node, null when none is connected.
export function hidrawAccess(): boolean | null {
  let nodes: string[];
  try {
    nodes = readdirSync("/sys/class/hidraw");
  } catch {
    // error: NOT-WORTH — no hidraw class: access unknown (null), so the check isn't shown
    return null;
  }
  let found = false;
  // loop: NOT-WORTH — hidraw nodes, a small sysfs read each
  for (const n of nodes) {
    try {
      const uevent = readFileSync(`/sys/class/hidraw/${n}/device/uevent`, "utf8");
      if (!/HID_ID=\w+:0000054C:0000(0CE6|0DF2)/i.test(uevent)) continue;
      found = true;
      accessSync(`/dev/${n}`, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      // error: NOT-WORTH — not this node / no access
    }
  }
  return found ? false : null;
}

export async function restartWirePlumber(): Promise<void> {
  await run("systemctl", ["--user", "restart", "wireplumber"], { timeout: 15_000 });
}

export async function setCardProfile(card: string, profile: string): Promise<void> {
  if (!DS5_CARD.test(card)) throw new Error("Not a DualSense audio card.");
  await run("pactl", ["set-card-profile", card, profile], { timeout: 5000 });
}

// ---- The controller's hardware volume and microphone gain (ALSA) ----
// The DualSense UCM names no hardware volume controls, so PipeWire uses
// software volume and never touches them: whatever `alsactl` restored at boot
// stays. A low saved state leaves `Headset Capture Volume` at 0 (the firmware
// then sets the controller's mic volume to 0, near silent) and `PCM Playback
// Volume` below 100 (the amp at −20 dB for 80). The fix sets them to full;
// the desktop's own volume sliders keep working (software volume).

// Sony's USB ids of the DualSense and DualSense Edge (what the board shows the PC).
const DS5_USB_IDS = new Set(["054c:0ce6", "054c:0df2"]);

/** The controls the fix sets, and to what: volumes to their maximum, switches on. */
export const MIXER_TARGETS = ["PCM Playback Volume", "Headset Capture Volume", "PCM Playback Switch", "Headset Capture Switch"] as const;
export type MixerName = (typeof MIXER_TARGETS)[number];

export interface MixerControl {
  name: string;
  value: number; // a switch: 1 on, 0 off
  max: number; // a switch: 1
}

export interface MixerChange {
  name: MixerName;
  from: number;
  to: number;
}

export interface DualSenseMixer {
  card: number; // ALSA card number (changes with plug order)
  key: string; // where it's plugged in (the card's USB path), stable across boots
  controls: MixerControl[];
}

/** `amixer -c N contents` (C locale): every control's name, first value and maximum. */
export function parseAmixerContents(text: string): MixerControl[] {
  const out: MixerControl[] = [];
  for (const block of text.split(/^numid=/m).slice(1)) {
    const name = /,name='([^']*)'/.exec(block)?.[1];
    const type = /type=(\w+)/.exec(block)?.[1];
    const raw = /^\s*: values=([^,\n]+)/m.exec(block)?.[1]?.trim();
    if (!name || raw === undefined) continue;
    if (type === "BOOLEAN") out.push({ name, value: raw === "on" ? 1 : 0, max: 1 });
    else if (type === "INTEGER") {
      const max = Number(/max=(-?\d+)/.exec(block)?.[1]);
      const value = Number(raw);
      if (Number.isFinite(max) && Number.isFinite(value)) out.push({ name, value, max });
    }
  }
  return out;
}

/** What to change on one card: the target controls below full. */
export function lowMixerControls(controls: MixerControl[]): MixerChange[] {
  const out: MixerChange[] = [];
  // loop: NOT-WORTH — N = 4 mixer targets per card; once per scan
  for (const name of MIXER_TARGETS) {
    // loop: NOT-WORTH — ~20 controls per card; once per scan
    const c = controls.find((x) => x.name === name);
    if (c && c.value < c.max) out.push({ name, from: c.value, to: c.max });
  }
  return out;
}

/** The DualSense cards: ALSA card number and the USB port it's plugged into
 * (the sysfs device name without its interface, "3-3"), by Sony's USB id. */
export function findDualSenseAlsaCards(sysSound = "/sys/class/sound", procAsound = "/proc/asound"): Array<{ card: number; key: string }> {
  let entries: string[];
  try {
    entries = readdirSync(sysSound);
  } catch {
    // error: NOT-WORTH — no sound class: no cards
    return [];
  }
  const out: Array<{ card: number; key: string }> = [];
  for (const entry of entries) {
    const card = /^card(\d+)$/.exec(entry)?.[1];
    if (card === undefined) continue;
    try {
      if (
        !DS5_USB_IDS.has(
          readFileSync(join(procAsound, entry, "usbid"), "utf8")
            .trim()
            .toLowerCase(),
        )
      )
        continue;
      out.push({ card: Number(card), key: basename(realpathSync(join(sysSound, entry, "device"))).replace(/:.*$/, "") });
    } catch {
      // error: NOT-WORTH — not a USB card, or it went away
    }
  }
  return out.sort((a, b) => a.card - b.card);
}

/** What talks to ALSA: tests swap in a fake, the app runs amixer. */
export interface MixerLayer {
  cards: () => Array<{ card: number; key: string }>;
  contents: (card: number) => Promise<string>;
  set: (card: number, name: MixerName, value: number) => Promise<void>;
}

export const amixerLayer: MixerLayer = {
  cards: () => findDualSenseAlsaCards(),
  contents: async (card) => (await run("amixer", ["-c", String(card), "contents"], { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024, timeout: 5000 })).stdout,
  set: async (card, name, value) => {
    if (!(MIXER_TARGETS as readonly string[]).includes(name) || !Number.isInteger(value) || value < 0) throw new Error("Not a controller volume control.");
    await run("amixer", ["-c", String(card), "-q", "cset", `name=${name}`, String(value)], { env: { ...process.env, LC_ALL: "C" }, timeout: 5000 });
  },
};

/** Every connected DualSense card with its controls (none without ALSA or amixer). */
export async function dualSenseMixers(layer: MixerLayer = amixerLayer): Promise<DualSenseMixer[]> {
  const out: DualSenseMixer[] = [];
  // loop: NOT-WORTH — DualSense cards, 0-2, one amixer read each; once per scan
  for (const { card, key } of layer.cards()) {
    try {
      out.push({ card, key, controls: parseAmixerContents(await layer.contents(card)) });
    } catch {
      // error: NOT-WORTH — amixer missing or the card went away
    }
  }
  return out;
}

/** Set controls on the card plugged in at `key` (re-found now: card numbers change). */
export async function setDualSenseMixer(key: string, changes: MixerChange[], layer: MixerLayer = amixerLayer): Promise<void> {
  const card = layer.cards().find((c) => c.key === key)?.card;
  if (card === undefined) throw new Error("The controller isn't connected.");
  // loop: SERIAL-REQUIRED — one ALSA card: amixer writes in order, N ≤ 4 controls; per apply
  for (const c of changes) await layer.set(card, c.name, c.to);
}

/** Undo: put back the old values, only on controls still at what we set
 * (one changed since is the user's choice and stays). */
export async function restoreDualSenseMixer(key: string, changes: MixerChange[], layer: MixerLayer = amixerLayer): Promise<void> {
  const card = layer.cards().find((c) => c.key === key)?.card;
  if (card === undefined) throw new Error("The controller isn't connected.");
  const now = parseAmixerContents(await layer.contents(card));
  // loop: SERIAL-REQUIRED — one ALSA card: amixer writes in order, N ≤ 4 controls; per Undo
  for (const c of changes) if (now.find((x) => x.name === c.name)?.value === c.to) await layer.set(card, c.name, c.from);
}
