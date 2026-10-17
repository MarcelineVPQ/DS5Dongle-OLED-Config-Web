# Windows' sleep/wake power broadcast, delivered to the DS5 app
# (tools/sleep_wake_vm.mjs runs this in the test VM's signed-in session
# through a scheduled task: window messages don't cross from the guest
# agent's session 0).
#
#   sleep_wake_vm.ps1 -Event list|suspend|resume -Out <log file>
#
# What Windows sends when the PC sleeps and wakes is WM_POWERBROADCAST:
# PBT_APMSUSPEND before the sleep, PBT_APMRESUMESUSPEND and
# PBT_APMRESUMEAUTOMATIC after it. It goes to every top-level window and to
# the windows registered with RegisterSuspendResumeNotification, which is how
# Chromium's power monitor (Electron's powerMonitor) hears it: a message-only
# window of class "Base_PowerMessageWindow" in the app's main process. This
# sends the same messages to the same windows of the app's processes (the
# exe name below) and nothing else on the machine.
param([string]$Event = "list", [string]$Out = "$env:TEMP\ds5-sleepwake-pbt.log", [string]$Exe = "DS5 Dongle OLED Edition Configurator")
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Ds5Pbt {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr result);
  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
  // The app's windows: [hwnd, pid, class, "top" | "message"].
  public static List<string[]> Windows(int[] pids) {
    var found = new List<string[]>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid); if (Array.IndexOf(pids, (int) pid) >= 0) found.Add(new[] { h.ToInt64().ToString(), pid.ToString(), Cls(h), "top" }); return true; }, IntPtr.Zero);
    IntPtr m = IntPtr.Zero;
    while ((m = FindWindowExW(new IntPtr(-3), m, null, null)) != IntPtr.Zero) {
      uint pid; GetWindowThreadProcessId(m, out pid);
      if (Array.IndexOf(pids, (int) pid) >= 0) found.Add(new[] { m.ToInt64().ToString(), pid.ToString(), Cls(m), "message" });
    }
    return found;
  }
  // WM_POWERBROADCAST (0x218) with `pbt`; SMTO_ABORTIFHUNG, 5 s. True when the window answered.
  public static bool Send(long hwnd, int pbt) { IntPtr r; return SendMessageTimeoutW(new IntPtr(hwnd), 0x218, new IntPtr(pbt), IntPtr.Zero, 0x2, 5000, out r) != IntPtr.Zero; }
}
"@
$PBT = @{ suspend = @(4); resume = @(7, 18) }  # PBT_APMSUSPEND; PBT_APMRESUMESUSPEND, PBT_APMRESUMEAUTOMATIC (Windows' order)
$pids = [int[]]@(Get-Process -Name $Exe -EA 0 | % Id)
$lines = @()
if (-not $pids) { $lines += "no app process"; $lines | Set-Content $Out; exit 3 }
$wins = [Ds5Pbt]::Windows($pids)
# Real broadcasts reach top-level windows and the registered power window,
# not other message-only windows.
$targets = @($wins | ? { $_[3] -eq "top" -or $_[2] -eq "Base_PowerMessageWindow" })
if ($Event -eq "list") { $wins | % { $lines += "window $($_ -join ' ')" } }
else {
  if (-not ($targets | ? { $_[2] -eq "Base_PowerMessageWindow" })) { $lines += "no Base_PowerMessageWindow in the app"; $lines | Set-Content $Out; exit 4 }
  foreach ($code in $PBT[$Event]) {
    $ok = 0; foreach ($t in $targets) { if ([Ds5Pbt]::Send([long]$t[0], $code)) { $ok++ } }
    $lines += "sent PBT $code to $($targets.Count) windows, $ok answered"
  }
}
$lines | Set-Content $Out
