#!/usr/bin/env bash
# The resource budget gate on Windows: the same measurement as
# tools/check_budgets.sh (tools/measure_budgets.mjs, tools/budgets.json), run
# inside the Windows test VM (libvirt win11-test) on the installed app.
# Overnight only, like the Linux gate (docs/BUDGETS.md, "Windows (VM,
# overnight)").
#
# It puts the measuring scripts, the test game library and the installer on
# a CD (an ISO in ~/VMs, swapped into the VM's CD drive and swapped back
# afterwards), then runs tools/budgets_vm.ps1 in the VM through the QEMU
# guest agent. That script installs the installer for the signed-in user when
# the app isn't at that version, stops every copy of the app in the VM,
# starts the installed app in the signed-in session (the "DS5 gate launch"
# scheduled task: never around the sign-in; a locked session is fine) with
# its own settings folder and DevTools on 9420 (inspector 9421), measures
# with the VM's Node (C:\ds5test\node), stops the copy and removes its files.
# The results come back to tmp/budgets-vm/results.json and the table is
# printed. The VM is never started, shut down or restarted.
#
#   tools/check_budgets_vm.sh --installer <...>-win-x64-setup.exe     --quick (~12 min)
#   tools/check_budgets_vm.sh --long --installer <exe>                ~60 min, with the soak
#   tools/check_budgets_vm.sh --build                                 cross-build a dev installer from this tree first (~5 min), then measure it
#   tools/check_budgets_vm.sh                                         measure the app already installed in the VM
#   DS5_BUDGET_PAGES / DS5_BUDGET_MODE work as for tools/check_budgets.sh; DS5_BUDGET_KEEP=1 leaves the copy running
#
# The build must be a dev build (X.Y.Z-dev.N or DS5_DEV_TOOLS=1): the
# simulated board and Fake games are on its Developer card.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$APP/tmp/budgets-vm"
VM="${DS5_BUDGET_VM:-win11-test}"
PORT="${DS5_BUDGET_PORT:-9420}"
ISO="$HOME/VMs/test-budgets.iso"
MODE=quick
INSTALLER=""
BUILD=0
usage() { echo "usage: tools/check_budgets_vm.sh [--quick|--long] [--installer <setup.exe> | --build]" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) MODE=quick ;;
    --long) MODE=long ;;
    --installer) [ $# -ge 2 ] || usage; INSTALLER="$(realpath "$2")"; shift ;;
    --build) BUILD=1 ;;
    *) usage ;;
  esac
  shift
done

missing=()
for tool in virsh xorriso jq base64 iconv node; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check_budgets_vm.sh needs: ${missing[*]} (install them first)" >&2
  exit 2
fi
V=(virsh -c qemu:///system)
if [ "$("${V[@]}" domstate "$VM" 2> /dev/null)" != "running" ]; then
  echo "The VM $VM isn't running. Start it and sign in, then run this again (this script never starts or stops it)." >&2
  exit 2
fi
ga() { "${V[@]}" qemu-agent-command "$VM" "$1"; }
ga '{"execute":"guest-ping"}' > /dev/null || { echo "The VM's guest agent doesn't answer." >&2; exit 2; }

cd "$APP"
rm -rf "$STATE"
mkdir -p "$STATE/cd/tools"

if [ "$BUILD" = 1 ]; then
  echo "== Building a dev installer (DS5_DEV_TOOLS=1, NSIS, nice 19)"
  # npm installs only this OS's koffi binary; the Windows build needs the
  # Windows one (the running-game check, electron/main/games/winProcs.ts).
  koffi="$(node -p 'require("./package.json").dependencies.koffi')"
  if [ ! -d node_modules/@koromix/koffi-win32-x64 ]; then
    mkdir -p "$STATE/koffi" node_modules/@koromix/koffi-win32-x64
    (cd "$STATE/koffi" && npm pack -q "@koromix/koffi-win32-x64@$koffi" > /dev/null)
    tar xzf "$STATE/koffi"/koromix-koffi-win32-x64-*.tgz -C node_modules/@koromix/koffi-win32-x64 --strip-components=1
  fi
  rm -rf "$STATE/release"
  DS5_DEV_TOOLS=1 nice -n 19 npx electron-vite build > "$STATE/build.log" 2>&1
  nice -n 19 npx electron-builder --win -c.directories.output="$STATE/release" >> "$STATE/build.log" 2>&1 || { echo "The build failed; see $STATE/build.log" >&2; exit 1; }
  INSTALLER="$(ls "$STATE"/release/*-setup.exe | head -n 1)"
fi

echo "== Preparing the CD"
node tools/seed_test_library.mjs "$STATE/seed" > /dev/null
cp "$STATE/seed/userdata/game-library-2.json" "$STATE/cd/"
cp tools/measure_budgets.mjs tools/budgets_lib.mjs tools/budgets.json tools/cdp_lib.mjs tools/procs_windows.mjs tools/budgets_vm.ps1 "$STATE/cd/tools/"
echo "DS5 resource budget gate CD ($(date -Iseconds))" > "$STATE/cd/ds5-budgets.txt"
if [ -n "$INSTALLER" ]; then
  cp "$INSTALLER" "$STATE/cd/installer.exe"
  echo "installer: $(basename "$INSTALLER")" >> "$STATE/cd/ds5-budgets.txt"
fi
xorriso -as mkisofs -quiet -J -joliet-long -r -V DS5BUDGETS -o "$ISO" "$STATE/cd"

# Swap our CD in, and the one that was there back afterwards.
CD_DEV="$("${V[@]}" domblklist "$VM" --details | awk '$2 == "cdrom" { print $3; exit }')"
PREV="$("${V[@]}" domblklist "$VM" --details | awk -v d="$CD_DEV" '$3 == d { print $4 }')"
[ -n "$CD_DEV" ] || { echo "The VM has no CD drive." >&2; exit 2; }
restore() {
  if [ -n "$PREV" ] && [ "$PREV" != "-" ] && [ -e "$PREV" ]; then
    "${V[@]}" change-media "$VM" "$CD_DEV" "$PREV" --update --live > /dev/null 2>&1 || true
  else
    "${V[@]}" change-media "$VM" "$CD_DEV" --eject --live > /dev/null 2>&1 || true
  fi
  rm -f "$ISO"
}
trap restore EXIT
"${V[@]}" change-media "$VM" "$CD_DEV" "$ISO" --update --live > /dev/null

# The orchestrator, through the guest agent: a short bootstrap finds the CD
# and runs tools/budgets_vm.ps1 from it.
args="-Mode $MODE -Port $PORT"
[ -n "${DS5_BUDGET_PAGES:-}" ] && args="$args -Pages '${DS5_BUDGET_PAGES}'"
[ -n "${DS5_BUDGET_MODE:-}" ] && args="$args -ModeJson '${DS5_BUDGET_MODE//\'/\'\'}'"
[ "${DS5_BUDGET_KEEP:-}" = 1 ] && args="$args -Keep"
boot="\$ProgressPreference='SilentlyContinue'
\$cd = \$null; foreach (\$i in 1..30) { \$cd = Get-Volume | ? { \$_.DriveLetter -and (Test-Path \"\$(\$_.DriveLetter):\\ds5-budgets.txt\") } | select -First 1; if (\$cd) { break }; Start-Sleep 1 }
if (-not \$cd) { 'the gate CD never appeared'; exit 3 }
& \"\$(\$cd.DriveLetter):\\tools\\budgets_vm.ps1\" $args
exit \$LASTEXITCODE"
enc="$(printf '%s' "$boot" | iconv -f utf-8 -t utf-16le | base64 -w0)"
echo "== Measuring in $VM ($MODE; the VM's copy of the app, not yours)"
pid="$(ga "{\"execute\":\"guest-exec\",\"arguments\":{\"path\":\"powershell.exe\",\"arg\":[\"-NoProfile\",\"-NonInteractive\",\"-ExecutionPolicy\",\"Bypass\",\"-EncodedCommand\",\"$enc\"],\"capture-output\":true}}" | jq -r .return.pid)"
case "$MODE" in long) limit=$((100 * 60)) ;; *) limit=$((30 * 60)) ;; esac
start=$SECONDS
while :; do
  status="$(ga "{\"execute\":\"guest-exec-status\",\"arguments\":{\"pid\":$pid}}")"
  [ "$(jq -r .return.exited <<< "$status")" = true ] && break
  if [ $((SECONDS - start)) -gt "$limit" ]; then
    echo "The VM run took over $((limit / 60)) min; it may still be going (C:\\ds5test\\budgets in the VM)." >&2
    exit 1
  fi
  sleep 10
done
jq -r '.return["out-data"] // ""' <<< "$status" | base64 -d > "$STATE/vm.log"
jq -r '.return["err-data"] // ""' <<< "$status" | base64 -d >> "$STATE/vm.log"
code="$(jq -r '.return.exitcode // 1' <<< "$status")"
tr -d '\r' < "$STATE/vm.log" | awk '/^===RESULTS===$/ { on = 1; next } /^===END===$/ { on = 0 } on' > "$STATE/results.json"
tr -d '\r' < "$STATE/vm.log" | awk '/^===MEASURE-LOG===$/ { on = 1; next } /^===RESULTS===$/ { on = 0 } on' > "$STATE/measure.log"
grep '^\[vm\]' "$STATE/vm.log" | tr -d '\r' || true
if [ "$code" != 0 ] || [ ! -s "$STATE/results.json" ]; then
  echo "Measuring in the VM failed (exit $code); see $STATE/vm.log" >&2
  tail -n 20 "$STATE/measure.log" >&2 || true
  exit 1
fi
node tools/budgets_report.mjs "$STATE/results.json"
