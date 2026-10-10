// One-time Linux setup: install a udev rule that gives the logged-in user
// access to the dongle and the RP2350 boot device (resources/linux/). Needs
// root once, via pkexec (graphical password prompt). The script is fixed text
// with no user input; the rule file is copied from the app's own resources.
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";

const RULE_NAME = "70-ds5-dongle.rules";
const RULE_DEST = `/etc/udev/rules.d/${RULE_NAME}`;

export interface SetupResult {
  ok: boolean;
  message: string;
}

export function usbRuleInstalled(resourcesDir: string): boolean {
  if (process.platform !== "linux") return true;
  try {
    return existsSync(RULE_DEST) && readFileSync(RULE_DEST, "utf8") === readFileSync(join(resourcesDir, "linux", RULE_NAME), "utf8");
  } catch {
    return false;
  }
}

export function installUsbRule(resourcesDir: string): Promise<SetupResult> {
  if (process.platform !== "linux") return Promise.resolve({ ok: true, message: "Not needed on this OS." });
  const source = join(resourcesDir, "linux", RULE_NAME);
  // Positional args ($1 = source, $2 = dest) instead of string interpolation.
  const script = 'install -m 0644 "$1" "$2" && udevadm control --reload-rules && udevadm trigger --subsystem-match=usb';
  return new Promise((resolve) => {
    execFile("pkexec", ["/bin/sh", "-c", script, "ds5-setup", source, RULE_DEST], (error) => {
      if (!error) resolve({ ok: true, message: "USB access set up. Unplug and replug the dongle." });
      else if ((error as NodeJS.ErrnoException).code === "ENOENT") resolve({ ok: false, message: "pkexec isn't installed. Copy the rule manually (see the README)." });
      else if (error.code === 126 || error.code === 127) resolve({ ok: false, message: "Cancelled." });
      else resolve({ ok: false, message: `Setup failed: ${error.message}` });
    });
  });
}
