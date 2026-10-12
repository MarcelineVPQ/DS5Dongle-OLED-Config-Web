// The PowerShell behind Windows' "Repair USB driver" (electron/main/windowsSetup.ts
// runs it elevated; WindowsUsbRepair.tsx shows it before it runs; the README
// publishes it, checked by tests/security/electron.test.ts). Fixed text: no
// input goes into it. It forgets Windows' cached USB answer and device entries
// for the dongle's two IDs only.
const IDS = ["0CE6", "0DF2"]; // DualSense, DualSense Edge mode

export const REPAIR_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `foreach ($id in @(${IDS.map((p) => `'${p}'`).join(", ")})) {`,
  '  Remove-Item "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\usbflags\\054C$($id)0100" -Recurse -Force -ErrorAction SilentlyContinue',
  '  Get-PnpDevice | Where-Object { $_.InstanceId -like "USB\\VID_054C&PID_$($id)*" } | ForEach-Object {',
  '    & "$env:SystemRoot\\System32\\pnputil.exe" /remove-device "$($_.InstanceId)" | Out-Null',
  "  }",
  "}",
  "exit 0",
].join("\n");
