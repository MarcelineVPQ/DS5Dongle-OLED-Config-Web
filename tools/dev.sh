#!/usr/bin/env bash
# The dev copy of the app: built from this working tree with the dev tools
# (Developer card, previews, fake controllers) and a build id from Git
# ("0.9.3 · dev +3.a1b2c3d"), run with its own settings (never yours) and the
# Chrome DevTools port open for tools/check_layout.mjs. Releases are
# ~/projects/DS5Dongle/tools/release.sh (CI); they have neither.
#
#   tools/dev.sh            build the AppImage and (re)start the dev copy
#   tools/dev.sh --quick    skip packaging: run the build with Electron directly
#   tools/dev.sh --stop     stop the dev copy
#
# State lives in tmp/dev/ (git-ignored): home/ is the dev copy's HOME (its
# settings, art cache, Proton downloads), app/ the packaged AppImage, *.log.
# CDP port: DS5_DEV_PORT (default 9333).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$APP/tmp/dev"
PORT="${DS5_DEV_PORT:-9333}"
MODE=package
case "${1:-}" in
  "") ;;
  --quick) MODE=quick ;;
  --stop) MODE=stop ;;
  *) echo "usage: tools/dev.sh [--quick|--stop]" >&2; exit 2 ;;
esac
mkdir -p "$DEV/home" "$DEV/app"

# Only ever our own dev copy: matched by its debug port (the user's own copy
# never has one) or the AppImage path under tmp/dev/app.
stop() {
  pkill -f -- "--remote-debugging-port=$PORT" 2>/dev/null || true
  pkill -f "^$DEV/app/" 2>/dev/null || true
  for _ in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$PORT/json" || return 0; sleep 0.5; done
}
stop
[ "$MODE" = stop ] && { echo "Dev copy stopped."; exit 0; }

cd "$APP"
echo "== Building (dev tools on)"
DS5_DEV_TOOLS=1 npx electron-vite build > "$DEV/build.log" 2>&1 || { tail -20 "$DEV/build.log"; exit 1; }
if [ "$MODE" = package ]; then
  npx electron-builder --linux AppImage -c.directories.output="$DEV/app" >> "$DEV/build.log" 2>&1 || { tail -20 "$DEV/build.log"; exit 1; }
  BIN="$DEV/app/DS5Dongle-OLED-Edition-Configurator-$(node -p 'require("./package.json").version')-linux-x86_64.AppImage"
  (HOME="$DEV/home" "$BIN" --remote-debugging-port="$PORT" > "$DEV/app.log" 2>&1 &)
else
  (HOME="$DEV/home" ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port="$PORT" > "$DEV/app.log" 2>&1 &)
fi
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/json" && break; sleep 1; done
curl -s -o /dev/null "http://127.0.0.1:$PORT/json" || { echo "The dev copy didn't start; see $DEV/app.log" >&2; exit 1; }
echo "Dev copy running ($MODE), DevTools port $PORT, settings in $DEV/home"
