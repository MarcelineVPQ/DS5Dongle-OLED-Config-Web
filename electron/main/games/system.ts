// Host checks that silently break native DualSense features on Linux:
//   - the controller's audio card on a pro-audio profile (GE-Proton 11 then
//     sends zero-force triggers and no HD haptics; it must stay on HiFi)
//   - a global PROTON_PREFER_SDL / PROTON_USE_SDL (forces the Xbox path)
//   - no read/write access to the controller's hidraw node
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const DS5_CARD = /^alsa_card\.usb-Sony_Interactive_Entertainment_DualSense(_Edge)?_Wireless_Controller/;
export const SDL_FORCING_VARS = ["PROTON_PREFER_SDL", "PROTON_USE_SDL"];

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
    return [];
  }
}

export const isProAudio = (profile: string) => /pro-audio/i.test(profile);

// A rule file that forces pro-audio onto the DualSense card.
export function forcesProAudio(text: string): boolean {
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
  for (const [dir, editable] of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".conf") || f.endsWith(".lua"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        if (forcesProAudio(readFileSync(join(dir, f), "utf8"))) out.push({ path: join(dir, f), editable });
      } catch {
        // unreadable: skip
      }
    }
  }
  return out;
}

// Environment files that set an SDL-forcing variable for every game.
export function findGlobalSdlVars(home: string): string[] {
  const files = [join(home, ".profile"), join(home, ".bash_profile"), join(home, ".bashrc"), join(home, ".zshenv"), join(home, ".pam_environment"), "/etc/environment"];
  for (const dir of [join(home, ".config/environment.d"), join(home, ".config/plasma-workspace/env"), "/etc/environment.d"]) {
    try {
      for (const f of readdirSync(dir)) files.push(join(dir, f));
    } catch {
      // missing dir
    }
  }
  const out: string[] = [];
  const pattern = new RegExp(`^\\s*(export\\s+)?(${SDL_FORCING_VARS.join("|")})\\s*=`, "m");
  for (const f of files) {
    try {
      const m = pattern.exec(readFileSync(f, "utf8"));
      if (m) out.push(`${m[2]} is set in ${f.startsWith(home) ? f.replace(home, "~") : f}`);
    } catch {
      // missing file
    }
  }
  for (const v of SDL_FORCING_VARS) if (process.env[v]) out.push(`${v} is set in this session's environment`);
  return out;
}

// true/false for a connected DualSense's hidraw node, null when none is connected.
export function hidrawAccess(): boolean | null {
  let nodes: string[];
  try {
    nodes = readdirSync("/sys/class/hidraw");
  } catch {
    return null;
  }
  let found = false;
  for (const n of nodes) {
    try {
      const uevent = readFileSync(`/sys/class/hidraw/${n}/device/uevent`, "utf8");
      if (!/HID_ID=\w+:0000054C:0000(0CE6|0DF2)/i.test(uevent)) continue;
      found = true;
      accessSync(`/dev/${n}`, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      // not this node / no access
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
