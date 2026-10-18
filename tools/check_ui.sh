#!/usr/bin/env bash
# The UI checker (tools/check_layout.mjs) on its own copy of the app, never
# the one you're using: a dev build run with its own settings
# (tmp/check/userdata), the simulated dongle (your real one stays with your
# copy) and Games allowed, on DevTools port 9334. Stopped again at the end.
# It runs fully isolated (tools/isolated.sh): a clean environment with its
# own runtime folder, a virtual display (xvfb-run), a private D-Bus session
# that can start nothing (no portals, kscreen, wallet or tray icon on your
# desktop), --password-store=basic, and a bubblewrap sandbox with a fresh
# /dev (no /dev/bus/usb or /dev/hidraw*, so it can never reach a real
# dongle or controller; the GPU nodes are passed through). It quits through
# the app's own quit and fails when a core dump or a desktop helper appeared
# meanwhile. CHECK_UI_SHOW=1 draws it on your real display instead.
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
mkdir -p "$STATE/userdata"

stop() { "$APP/tools/isolated.sh" stop --state "$STATE" --port "$PORT"; }

cd "$APP"
node tools/seed_test_library.mjs "$STATE"
echo "== Building (dev tools on)"
DS5_DEV_TOOLS=1 npx electron-vite build > "$STATE/build.log" 2>&1
echo "== Starting the checker copy (port $PORT)"
SHOW=()
[ "${CHECK_UI_SHOW:-}" = 1 ] && SHOW=(--show)
tools/isolated.sh start --state "$STATE" --port "$PORT" --size 1600x1000 "${SHOW[@]}"

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
# HDR lighting's mask follows each model's own drawing (stubbed WebGPU).
node tools/check_hdr_mask.mjs --port "$PORT" || status=$?
# Keyboard focus shows on every part of both drawings, in every colorway.
node tools/check_focus_ring.mjs --port "$PORT" $(printf "%s\n" "$@" | grep -qx -- "full" && echo --plan full) || status=$?
if [ "${DS5_CHECK_KEEP:-}" != 1 ]; then stop || status=1; fi
exit "$status"
