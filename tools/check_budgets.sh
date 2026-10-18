#!/usr/bin/env bash
# The resource budget gate (docs/BUDGETS.md, limits in tools/budgets.json):
# idle frames per page, CPU shown and idle, CPU hidden in the tray, memory
# (PSS) and, with --long, memory growth over a 30-minute soak. It prints a
# PASS/FAIL table and exits 1 when any budget fails.
#
# Like the UI checker it runs its own copy of the app, never the one you're
# using: a dev build with its own home folder and settings (tmp/budgets),
# DevTools on port 9420 (main-process inspector 9421; far from the
# 9333-9345 range the dev copy and other test copies use), fully isolated
# (tools/isolated.sh): a clean environment with its own runtime folder, a
# virtual 1920x1080 display (xvfb-run), a private D-Bus session that can
# start nothing (no portals, kscreen, wallet or tray icon on your desktop),
# --password-store=basic, and a bubblewrap sandbox with a fresh /dev (no
# /dev/bus/usb or /dev/hidraw*: it can never reach a real board or
# controller; the GPU nodes are passed through). It quits through the app's
# own quit and fails when a core dump or a desktop helper appeared meanwhile. The board is the simulated
# one with the controller put down; Developer card -> Fake games gives it a
# full game library, so it never reads your Steam or Heroic. Everything
# runs at nice 19. WebGL runs on SwiftShader (software), which inflates the
# GPU process's CPU: that column is reported, not judged.
#
#   tools/check_budgets.sh            --quick (default, ~10 min): the release check
#   tools/check_budgets.sh --long     ~55 min: 60 s per page, 5 min hidden,
#                                     memory at 10 min, a 30 min soak
#   tools/check_budgets.sh --no-build measure the build already in out/
#   DS5_BUDGET_PAGES=controller,about tools/check_budgets.sh   only those pages
#   DS5_BUDGET_KEEP=1 tools/check_budgets.sh                   leave the copy running
#   DS5_BUDGET_PROFILES=0 tools/check_budgets.sh               no game profiles in the test library
#
# The hidden stretch runs with Fake games off: the real running-game check
# watches this PC's /proc (read-only, your own processes) against the test
# home's library, which has one game profile (so it looks every 2 s).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$APP/tmp/budgets"
PORT="${DS5_BUDGET_PORT:-9420}"
MODE=quick
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --quick) MODE=quick ;;
    --long) MODE=long ;;
    --no-build) BUILD=0 ;;
    *) echo "usage: tools/check_budgets.sh [--quick|--long] [--no-build]" >&2; exit 2 ;;
  esac
done

stop() { "$APP/tools/isolated.sh" stop --state "$STATE" --port "$PORT"; }

command -v getconf > /dev/null || { echo "check_budgets.sh needs: getconf (install it first)" >&2; exit 2; }

cd "$APP"
rm -rf "$STATE"
mkdir -p "$STATE/userdata"
node tools/seed_test_library.mjs "$STATE" > /dev/null
# DS5_BUDGET_PROFILES=0: no game profiles (the running-game check's slow tray pace).
if [ "${DS5_BUDGET_PROFILES:-1}" = 0 ]; then
  node -e 'const fs = require("fs"); const f = process.argv[1]; const l = JSON.parse(fs.readFileSync(f, "utf8")); for (const g of Object.values(l.games)) delete g.profile; fs.writeFileSync(f, JSON.stringify(l, null, 2));' "$STATE/userdata/game-library-2.json"
fi
if [ "$BUILD" = 1 ]; then
  echo "== Building (dev tools on)"
  DS5_DEV_TOOLS=1 nice -n 19 npx electron-vite build > "$STATE/build.log" 2>&1
fi
echo "== Starting the budget copy (port $PORT, $MODE)"
tools/isolated.sh start --state "$STATE" --port "$PORT" --size 1920x1080 --nice -- --enable-unsafe-swiftshader --ignore-gpu-blocklist
# The after-check's verdict counts: a core dump or a desktop helper started fails the gate.
finish() {
  local code=$?
  if [ "${DS5_BUDGET_KEEP:-}" != 1 ]; then stop || code=1; fi
  exit "$code"
}
trap finish EXIT

status=0
nice -n 19 node tools/measure_budgets.mjs --port "$PORT" --mode "$MODE" --out "$STATE/results.json" || status=$?
if [ "$status" != 0 ]; then
  echo "Measuring failed (exit $status); see $STATE/app.log" >&2
  exit "$status"
fi
node tools/budgets_report.mjs "$STATE/results.json"
