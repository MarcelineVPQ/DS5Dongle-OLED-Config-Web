// One-time Linux setup: install a udev rule that gives the logged-in user
// access to the dongle and the RP2350 boot device (resources/linux/), and, on
// systems that restrict user namespaces (Ubuntu 23.10+), the AppArmor profile
// that lets Chromium's sandbox run (without it the AppImage starts with
// --no-sandbox; docs/SECURITY_AUDIT.md O1). Needs root once, via pkexec
// (graphical password prompt). The script is fixed text
// with no user input; the rule file is copied from the app's own resources
// (through a temporary copy root can read).
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { errorText } from "../../src/errorText";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { join } from "node:path";

const RULE_NAME = "70-ds5-dongle.rules";
const RULE_DEST = `/etc/udev/rules.d/${RULE_NAME}`;
const PROFILE_NAME = "ds5-dongle-configurator.apparmor";
const PROFILE_DEST = "/etc/apparmor.d/ds5-dongle-configurator";

// The profile is needed (and possible) when the kernel restricts user
// namespaces to profiled apps, AppArmor's parser is there, and this is the
// AppImage (the profile matches its /tmp/.mount_* path).
export function sandboxProfileNeeded(): boolean {
  if (process.platform !== "linux" || !process.env.APPIMAGE) return false;
  try {
    const restricted = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
    return restricted && (existsSync("/usr/sbin/apparmor_parser") || existsSync("/sbin/apparmor_parser"));
  } catch {
    return false;
  }
}

function sameFile(dest: string, source: string): boolean {
  try {
    return existsSync(dest) && readFileSync(dest, "utf8") === readFileSync(source, "utf8");
  } catch {
    return false;
  }
}

export interface SetupResult {
  ok: boolean;
  message: string;
}

// Everything the setup installs is in place (the rule, and the sandbox
// profile where it's needed).
export function usbRuleInstalled(resourcesDir: string): boolean {
  if (process.platform !== "linux") return true;
  const rule = sameFile(RULE_DEST, join(resourcesDir, "linux", RULE_NAME));
  return rule && (!sandboxProfileNeeded() || sameFile(PROFILE_DEST, join(resourcesDir, "linux", PROFILE_NAME)));
}

export function installUsbRule(resourcesDir: string): Promise<SetupResult> {
  if (process.platform !== "linux") return Promise.resolve({ ok: true, message: "Not needed on this OS." });
  // Root can't read inside the AppImage's FUSE mount (it's private to this
  // user), so the rule goes through a temporary copy.
  let dir: string;
  let source: string;
  let profile = "";
  const withProfile = sandboxProfileNeeded();
  try {
    dir = mkdtempSync(join(tmpdir(), "ds5-setup-"));
    source = join(dir, RULE_NAME);
    writeFileSync(source, readFileSync(join(resourcesDir, "linux", RULE_NAME)), { mode: 0o644 });
    if (withProfile) {
      profile = join(dir, PROFILE_NAME);
      writeFileSync(profile, readFileSync(join(resourcesDir, "linux", PROFILE_NAME)), { mode: 0o644 });
    }
    chmodSync(dir, 0o755);
  } catch (cause) {
    return Promise.resolve({ ok: false, message: `Setup failed: ${errorText(cause)}` });
  }
  // Positional args ($1/$2 = rule source/dest, $3/$4 = profile source/dest,
  // empty when not needed) instead of string interpolation. Exit 3 = no
  // udevadm (126/127 are pkexec's "dismissed"/"not authorized").
  const script =
    'command -v udevadm >/dev/null || exit 3; install -m 0644 "$1" "$2" && udevadm control --reload-rules && udevadm trigger --subsystem-match=usb' +
    ' && { [ -z "$3" ] || { install -m 0644 "$3" "$4" && apparmor_parser -r "$4"; }; }';
  return new Promise((resolve) => {
    execFile("pkexec", ["/bin/sh", "-c", script, "ds5-setup", source, RULE_DEST, profile, withProfile ? PROFILE_DEST : ""], (error) => {
      rmSync(dir, { recursive: true, force: true });
      if (!error)
        resolve({
          ok: true,
          message: withProfile
            ? "USB access set up, and the app's sandbox allowed. Unplug and replug your board; the sandbox is on from the next start."
            : "USB access set up. Unplug and replug your board.",
        });
      else if ((error as NodeJS.ErrnoException).code === "ENOENT") resolve({ ok: false, message: "pkexec isn't installed. Copy the rule manually (see the README)." });
      else if (error.code === 3) resolve({ ok: false, message: "udevadm isn't installed, so the rule can't be loaded. Copy it manually (see the README)." });
      else if (error.code === 126 || error.code === 127) resolve({ ok: false, message: "Cancelled." });
      else resolve({ ok: false, message: `Setup failed: ${error.message}` });
    });
  });
}
