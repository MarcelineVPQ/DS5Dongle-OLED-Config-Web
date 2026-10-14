#!/usr/bin/env bash
# The resource budget gate (docs/BUDGETS.md, limits in tools/budgets.json):
# idle frames per page, CPU shown and idle, CPU hidden in the tray, memory
# (PSS) and, with --long, memory growth over a 30-minute soak. It prints a
# PASS/FAIL table and exits 1 when any budget fails.
#
# Like the UI checker it runs its own copy of the app, never the one you're
# using: a dev build with its own home folder and settings (tmp/budgets),
# DevTools on port 9420 (main-process inspector 9421; far from the
# 9333-9345 range the dev copy and other test copies use), a virtual 1920x1080
# display (xvfb-run, WAYLAND_DISPLAY unset), a private D-Bus session (no
# tray icon on your desktop) and a bubblewrap sandbox with a fresh /dev (no
# /dev/bus/usb or /dev/hidraw*: it can never reach a real board or
# controller; the GPU nodes are passed through). The board is the simulated
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
ELECTRON="$APP/node_modules/electron/dist/electron"
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

# Only our copy: Electron from this tree with our debug port (an anchored
# full path, so the pattern never matches this shell).
stop() {
  local pids
  pids="$(pgrep -f "^$ELECTRON .*--remote-debugging-port=$PORT" || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
}

missing=()
for tool in bwrap dbus-run-session curl xvfb-run getconf; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check_budgets.sh needs: ${missing[*]} (install them first)" >&2
  exit 2
fi

cd "$APP"
stop
# Never attach to someone else's app: both ports must be free.
for p in "$PORT" $((PORT + 1)); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$p/json"; then
    echo "Port $p is in use by another program; pick other ports with DS5_BUDGET_PORT=<n> (uses n and n+1)." >&2
    exit 2
  fi
done
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
SANDBOX=(bwrap --dev-bind / / --dev /dev)
for node in /dev/dri /dev/nvidia*; do
  if [ -e "$node" ]; then SANDBOX+=(--dev-bind "$node" "$node"); fi
done
setsid dbus-run-session -- xvfb-run -a -s "-screen 0 1920x1080x24" env -u WAYLAND_DISPLAY "${SANDBOX[@]}" \
  env HOME="$STATE/home" nice -n 19 "$ELECTRON" . --ozone-platform=x11 --no-sandbox --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  --user-data-dir="$STATE/userdata" --remote-debugging-port="$PORT" --inspect=$((PORT + 1)) > "$STATE/app.log" 2>&1 < /dev/null &
up=0
for _ in $(seq 60); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/json" && up=1 && break; sleep 1; done
if [ "$up" != 1 ]; then
  echo "The budget copy never answered on port $PORT. The end of $STATE/app.log:" >&2
  tail -n 30 "$STATE/app.log" >&2 || true
  stop
  exit 1
fi
[ "${DS5_BUDGET_KEEP:-}" = 1 ] || trap stop EXIT

status=0
nice -n 19 node tools/measure_budgets.mjs --port "$PORT" --state "$STATE" --mode "$MODE" --out "$STATE/results.json" || status=$?
if [ "$status" != 0 ]; then
  echo "Measuring failed (exit $status); see $STATE/app.log" >&2
  exit "$status"
fi
node tools/budgets_report.mjs "$STATE/results.json"
