# The resource budget gate inside the Windows test VM (win11-test), run by
# tools/check_budgets_vm.sh through the QEMU guest agent (as SYSTEM) from
# the gate's CD (the volume with ds5-budgets.txt). It installs the
# installer on that CD unless that very installer (its SHA-256) is the last one installed (per user, as
# the signed-in user), starts the installed app in the signed-in user's
# session (the "DS5 gate launch" scheduled task, interactive token: never
# around the sign-in; a locked session still runs it) with its own settings
# and DevTools, runs tools/measure_budgets.mjs with the VM's Node, prints the
# results between markers for the host, then stops the copy and removes its
# files.
param(
  [string]$Mode = "quick",
  [int]$Port = 9420,
  [string]$Pages = "",
  [string]$ModeJson = "",
  [switch]$Keep,
  # The memory probe (tools/budget_probe.mjs): heap snapshots kept in C:\ds5test\probe.
  [switch]$Probe
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
function Say($text) { Write-Output "[vm] $text" }

# 1. The gate's CD (this script is its tools\budgets_vm.ps1) and the signed-in user
$src = Split-Path $PSScriptRoot -Parent
$user = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $user) { Say "nobody is signed in to the VM: sign in first (the app must run in a signed-in session)"; exit 4 }
$userName = $user.Split("\")[-1]
$profileDir = (Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like "*\$userName" } | Select-Object -First 1).LocalPath
if (-not $profileDir) { $profileDir = "C:\Users\$userName" }
$node = Get-ChildItem "C:\ds5test\node" -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { Say "no Node in C:\ds5test\node (unpack a Node 22+ win-x64 zip there)"; exit 5 }
$exe = Join-Path $profileDir "AppData\Local\Programs\ds5-dongle-configurator\DS5 Dongle OLED Edition Configurator.exe"
Say "user $user, node $($node.FullName) $(& $node.FullName --version)"

# 2. Our folder (the user's copy writes its settings there)
$work = "C:\ds5test\budgets"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory "$work\tools", "$work\userdata" | Out-Null
Copy-Item "$src\tools\*" "$work\tools"
Copy-Item "$src\game-library-2.json" "$work\userdata"
& icacls $work /grant "${user}:(OI)(CI)M" /T /Q | Out-Null

function Stop-App {
  # Every copy of the app in the VM: a second copy would share the 2 vCPUs.
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "DS5 Dongle OLED Edition Configurator.exe" -or $_.Name -like "DS5*.exe" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep 3
}
function As-User($name, $execute, $arguments) {
  $a = New-ScheduledTaskAction -Execute $execute -Argument $arguments
  $p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $name -Action $a -Principal $p -Settings $s -Force | Out-Null
  Start-ScheduledTask -TaskName $name
}

# 3. Install when asked and needed (per user, silent, as the user)
$installer = "$src\installer.exe"
if (Test-Path $installer) {
  # The installer's ProductVersion and the app's FileVersion are the full
  # version ("0.9.5-dev.11"); the app's ProductVersion is numeric only.
  $want = (Get-Item $installer).VersionInfo.ProductVersion
  $have = if (Test-Path $exe) { (Get-Item $exe).VersionInfo.FileVersion } else { "" }
  # Builds of the same version differ (every dev build of a branch is
  # "0.9.5-dev.12"): the installer's hash, kept after each install, says
  # whether this one is already in. A version match alone measured an older
  # build on 2026-10-15.
  $hash = (Get-FileHash $installer -Algorithm SHA256).Hash
  $marker = "C:\ds5test\installed-installer.sha256"
  $had = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { "" }
  if ($want -and $want -eq $have -and $hash -eq $had) {
    Say "installed $have already (this installer, $($hash.Substring(0, 12))); not reinstalling"
  } else {
    Stop-App
    Copy-Item $installer "$work\installer.exe"
    Say "installing $want (installed: $(if ($have) { $have } else { 'none' }))"
    As-User "DS5 gate install" "$work\installer.exe" "/S"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    do {
      Start-Sleep 2
      $state = (Get-ScheduledTask -TaskName "DS5 gate install").State
      $now = if (Test-Path $exe) { (Get-Item $exe).VersionInfo.FileVersion } else { "" }
    } while (($state -eq "Running" -or $now -ne $want) -and $sw.Elapsed.TotalSeconds -lt 300)
    Unregister-ScheduledTask -TaskName "DS5 gate install" -Confirm:$false
    Remove-Item "$work\installer.exe" -Force -ErrorAction SilentlyContinue
    if ($now -ne $want) { Say "the install didn't finish in 5 min (installed: '$now', wanted: '$want')"; exit 6 }
    Set-Content -Path $marker -Value $hash
    Say "installed $now ($($hash.Substring(0, 12))) in $([int]$sw.Elapsed.TotalSeconds) s"
  }
}
if (-not (Test-Path $exe)) { Say "the app isn't installed for $userName ($exe): pass --installer"; exit 7 }
Say "app $((Get-Item $exe).VersionInfo.FileVersion)"

# 4. Start our copy in the user's session
Stop-App
foreach ($p in $Port, ($Port + 1)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { Say "port $p is taken in the VM"; exit 8 }
}
As-User "DS5 gate launch" $exe "--remote-debugging-port=$Port --inspect=$($Port + 1) --user-data-dir=`"$work\userdata`""
$sw = [Diagnostics.Stopwatch]::StartNew()
$up = $false
while (-not $up -and $sw.Elapsed.TotalSeconds -lt 90) {
  try { $up = [bool]((Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 1) | Where-Object type -eq "page") } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $up) { Say "the app never answered on port $Port"; Stop-App; Unregister-ScheduledTask -TaskName "DS5 gate launch" -Confirm:$false; exit 9 }
Say ("DevTools up after {0:N1} s" -f $sw.Elapsed.TotalSeconds)

# 5. Measure
if ($Pages) { $env:DS5_BUDGET_PAGES = $Pages }
if ($ModeJson) { $env:DS5_BUDGET_MODE = $ModeJson }
if ($Probe) {
  $env:DS5_BUDGET_PROBE = "1"
  $env:DS5_BUDGET_PROBE_DIR = "C:\ds5test\probe"
  if (Test-Path $env:DS5_BUDGET_PROBE_DIR) { Remove-Item $env:DS5_BUDGET_PROBE_DIR -Recurse -Force }
  Say "probe on: heap snapshots in $env:DS5_BUDGET_PROBE_DIR"
}
$run = Start-Process -FilePath $node.FullName -ArgumentList "$work\tools\measure_budgets.mjs", "--port", $Port, "--mode", $Mode, "--out", "$work\results.json" `
  -RedirectStandardError "$work\measure.log" -RedirectStandardOutput "$work\measure.out" -NoNewWindow -Wait -PassThru
$status = $run.ExitCode

# 6. Hand the results over and clean up
if (-not $Keep) {
  Stop-App
  Unregister-ScheduledTask -TaskName "DS5 gate launch" -Confirm:$false
}
Write-Output "===MEASURE-LOG==="
if (Test-Path "$work\measure.log") { Get-Content "$work\measure.log" -Raw -Encoding UTF8 }
if (Test-Path "$work\results.json") {
  Write-Output "===RESULTS==="
  Get-Content "$work\results.json" -Raw -Encoding UTF8
  Write-Output "===END==="
}
if (-not $Keep) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
exit $status
