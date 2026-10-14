// Windows: repair the dongle's USB driver setup. The dongle uses a real
// DualSense's USB IDs (054C:0CE6 / 0DF2, revision 0100) and asks Windows for
// the WinUSB driver on its configurator interface (MS OS 1.0 descriptors).
// Windows asks a device for those descriptors only once per VID/PID/revision
// and keeps the answer (usbflags\<VVVVPPPPRRRR>). If a real DualSense was
// plugged in by USB first, the saved answer is "none": the interface gets no
// driver, or WinUSB without its interface GUID, and the app can't open it.
// Repair: forget the saved answers and the cached device entries (Windows
// sets them up again from scratch), then the user replugs the dongle. A rescan
// is not enough; Windows only asks again on a real re-enumeration.
// Needs admin once (UAC prompt). The script is fixed text with no input.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { REPAIR_SCRIPT } from "../../src/desktop/windowsRepairScript";

// The script itself is shared with the page, which shows it before it runs.
export { REPAIR_SCRIPT };

const CANCELLED = 1223; // ERROR_CANCELLED: the UAC prompt was declined

// PowerShell's -EncodedCommand: base64 of the UTF-16LE script, so nothing in
// it is parsed by a shell on the way.
export const encodeCommand = (script: string): string => Buffer.from(script, "utf16le").toString("base64");

// The unelevated PowerShell that starts the elevated one and passes its exit
// code back (or CANCELLED when the prompt is declined).
export function launcherScript(powershell: string, script: string): string {
  return [
    "try {",
    `  $p = Start-Process -FilePath '${powershell}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodeCommand(script)}'`,
    "  exit $p.ExitCode",
    `} catch { exit ${CANCELLED} }`,
  ].join("\n");
}

export function repairWindowsUsb(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, message: "Only needed on Windows." });
  // Full path, never PATH lookup.
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve) => {
    // lifetime: OK — exits when the UAC prompt is answered and the repair ends; no timeout (a person answers)
    execFile(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(launcherScript(powershell, REPAIR_SCRIPT))], { windowsHide: true }, (error) => {
      if (!error) resolve({ ok: true, message: "Repaired. Now unplug your board and plug it back in." });
      else if (error.code === CANCELLED) resolve({ ok: false, message: "Cancelled." });
      else resolve({ ok: false, message: `Repair failed: ${error.message}` });
    });
  });
}
