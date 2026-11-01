// The shell script behind Linux's "Remove USB access setup", the undo of Set
// up USB access (electron/main/linuxSetup.ts runs it as root through pkexec;
// UsbAccessSetup.tsx shows it before it runs). Fixed text: its only arguments
// are the two fixed paths the setup installs, $1 the udev rule and $2 the
// AppArmor sandbox profile, each empty when that file isn't there. The profile
// is unloaded from the kernel before its file goes; after the rule goes, udev
// reloads its rules and applies them again to the USB and hidraw devices (as
// the setup does), so the access ends without a replug.
export const USB_RULE_PATH = "/etc/udev/rules.d/70-ds5-dongle.rules";
export const SANDBOX_PROFILE_PATH = "/etc/apparmor.d/ds5-dongle-configurator";

export const REMOVE_SCRIPT = [
  'if [ -n "$2" ]; then apparmor_parser -R "$2" 2>/dev/null; rm -f "$2" || exit 1; fi',
  'if [ -n "$1" ]; then rm -f "$1" || exit 1; if command -v udevadm >/dev/null; then udevadm control --reload-rules && udevadm trigger --subsystem-match=usb --subsystem-match=hidraw; fi; fi',
  "exit 0",
].join("\n");
