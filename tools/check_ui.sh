#!/usr/bin/env bash
# The UI checker (tools/check_layout.mjs) on its own copy of the app, never
# the one you're using: a dev build run with its own settings
# (tmp/check/userdata), the simulated dongle (your real one stays with your
# copy) and Games allowed, on DevTools port 9334. Stopped again at the end.
# It runs on a private D-Bus session (dbus-run-session: no tray icon on your
# desktop) and in a bubblewrap sandbox with a fresh /dev (bwrap --dev: no
# /dev/bus/usb or /dev/hidraw*, so it can never reach a real dongle or
# controller; the GPU nodes are passed through). It draws on a virtual
# display (xvfb-run, software rendering, WAYLAND_DISPLAY unset), never on
# your screen; CHECK_UI_SHOW=1 shows it on your real display instead.
# Its home folder is its own too (tmp/check/home, HOME): a fixed test game
# library (tools/seed_test_library.mjs), rebuilt at every run with the
# player's data for it, so the game pages always show the same states
# (profile or not, a rating, notes, the art fallback).
#
#   tools/check_ui.sh                the fast plan (dev builds): pairwise
#                                    combinations, colorways computed
#   tools/check_ui.sh --plan full    everything rendered: the release gate
#                                    (docs/TEST_PLAN.md)
#   tools/check_ui.sh [other check_layout options, e.g. --mode contrast --langs en]
#   DS5_CHECK_KEEP=1 tools/check_ui.sh   leave the checker copy running
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$APP/tmp/check"
PORT="${DS5_CHECK_PORT:-9334}"
ELECTRON="$APP/node_modules/electron/dist/electron"
mkdir -p "$STATE/userdata"

# Only our checker copy: Electron from this tree with our debug port (an
# anchored full path, so the pattern never matches this shell).
stop() {
  local pids
  pids="$(pgrep -f "^$ELECTRON .*--remote-debugging-port=$PORT" || true)"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
}

# The sandbox tools: a missing one would only show as a 60 s wait and an
# unrelated error.
TOOLS=(bwrap dbus-run-session curl)
[ "${CHECK_UI_SHOW:-}" = 1 ] || TOOLS+=(xvfb-run)
missing=()
for tool in "${TOOLS[@]}"; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check_ui.sh needs: ${missing[*]} (install them first)" >&2
  exit 2
fi

cd "$APP"
stop
node tools/seed_test_library.mjs "$STATE"
echo "== Building (dev tools on)"
DS5_DEV_TOOLS=1 npx electron-vite build > "$STATE/build.log" 2>&1
echo "== Starting the checker copy (port $PORT)"
SANDBOX=(bwrap --dev-bind / / --dev /dev)
for node in /dev/dri /dev/nvidia*; do
  if [ -e "$node" ]; then SANDBOX+=(--dev-bind "$node" "$node"); fi
done
DISPLAY_WRAP=(xvfb-run -a -s "-screen 0 1600x1000x24" env -u WAYLAND_DISPLAY)
OZONE=(--ozone-platform=x11)
if [ "${CHECK_UI_SHOW:-}" = 1 ]; then DISPLAY_WRAP=() OZONE=(); fi
setsid dbus-run-session -- "${DISPLAY_WRAP[@]}" "${SANDBOX[@]}" env HOME="$STATE/home" "$ELECTRON" . "${OZONE[@]}" --no-sandbox --user-data-dir="$STATE/userdata" --remote-debugging-port="$PORT" > "$STATE/app.log" 2>&1 < /dev/null &
up=0
for _ in $(seq 60); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/json" && up=1 && break; sleep 1; done
if [ "$up" != 1 ]; then
  echo "The checker copy never answered on port $PORT. The end of $STATE/app.log:" >&2
  tail -n 30 "$STATE/app.log" >&2 || true
  stop
  exit 1
fi

# Simulated dongle + Games allowed + no first-run banners, then reload.
node --input-type=module -e '
const port = Number(process.argv[1]);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const expr = `(async () => { localStorage.setItem("ds5.dev.simulated", "1"); localStorage.setItem("ds5.dev.tools", "1"); await window.desktop.setSetting("gamesScanAllowed", true); await window.desktop.setSetting("updatesAsked", true); await window.desktop.setSetting("updateChannel", "dev"); location.reload(); })()`;
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true } }));
await new Promise((r) => setTimeout(r, 1500));
ws.close();
' "$PORT"
sleep 8

status=0
node tools/check_layout.mjs --port "$PORT" "$@" || status=$?
[ "${DS5_CHECK_KEEP:-}" = 1 ] || stop
exit "$status"
