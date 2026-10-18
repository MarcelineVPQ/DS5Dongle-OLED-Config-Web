#!/usr/bin/env bash
# One isolated copy of the app for checks (tools/check_ui.sh,
# tools/check_budgets.sh, screenshots, measurements): never the copy you're
# using, never your screen, your D-Bus, your portals, your keyring, your
# tray or a real board.
#
#   tools/isolated.sh start --state DIR --port P [--size 1600x1000] [--nice] [--show] [--env K=V]... [-- app args]
#   tools/isolated.sh stop  --state DIR --port P     quit it through the app's own quit (app.quit()),
#                                                    then the after-check below
#   tools/isolated.sh check --state DIR              the after-check alone
#
# DIR holds its home folder (DIR/home), settings (DIR/userdata), its log
# (DIR/app.log) and the run's records (DIR/iso). P is the DevTools port of
# the page; the main process's inspector is on P + 1. --show draws it on
# your own X display (DISPLAY, XWayland) instead of a virtual one, to watch
# it; everything else stays isolated.
#
# What isolates it:
#   - env -i: a clean environment built here. No WAYLAND_DISPLAY, DISPLAY,
#     DBUS_SESSION_BUS_ADDRESS, XDG_RUNTIME_DIR, KDE/GNOME session variables
#     or snap paths from your shell reach it.
#   - a fresh XDG_RUNTIME_DIR (mode 700, under /tmp: short, a socket path
#     must fit 108 bytes) and its own HOME (DIR/home): no Wayland, PipeWire,
#     PulseAudio or bus sockets of yours to find. Your /run/user/UID is hidden
#     too (an empty tmpfs over it in the sandbox).
#   - its own virtual display (xvfb-run -a), drawn with the X11 backend.
#   - a private D-Bus session bus from a minimal config (DIR/iso/session.conf)
#     whose only service folder is empty: nothing can be started on it by
#     name, so no xdg-desktop-portal(-kde), kscreen, kwalletd/ksecretd,
#     document portal, dconf or at-spi. GTK_USE_PORTAL=0, NO_AT_BRIDGE=1,
#     GSETTINGS_BACKEND=memory and GIO_USE_VFS=local keep the toolkit from
#     asking for them at all.
#   - --password-store=basic (Chromium never looks for a keyring).
#   - bubblewrap with a fresh /dev: no /dev/bus/usb or /dev/hidraw*, so it
#     can never reach a real board or controller (the GPU nodes are passed in).
#   - stop quits through the app (app.quit() in the main process, so the
#     app's own before-quit path runs) and waits for it. Never SIGTERM
#     (Electron answers it with a core dump, and every dump pops a crash
#     notice on the desktop); SIGKILL only as the last resort.
#   - the after-check fails when, since the start, a core dump appeared (any
#     process) or a portal, kscreen, wallet or at-spi process was started, or
#     anything still runs with this copy's runtime folder.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$APP/node_modules/electron/dist/electron"
cmd="${1:-}"
shift || true
STATE="" PORT="" SIZE="1600x1000" NICE=() ENVS=() EXTRA=() SHOW=0
while [ $# -gt 0 ]; do
  case "$1" in
    --state) STATE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --size) SIZE="$2"; shift 2 ;;
    --nice) NICE=(nice -n 19); shift ;;
    --show) SHOW=1; shift ;;
    --env) ENVS+=("$2"); shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "isolated.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$STATE" ] || { sed -n 2,13p "$0"; exit 2; }
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd)"
ISO="$STATE/iso"

# Desktop helpers a test copy must never start (or crash): matched by the
# program's path at the start of the command line, so a shell or editor
# whose command line merely mentions one never counts.
WATCH='^/usr/[^ ]*/(xdg-desktop-portal[^ /]*|xdg-document-portal|xdg-permission-store|kscreen_backend_launcher|kwalletd[0-9]*|ksecretd|at-spi-bus-launcher|at-spi2-registryd|dconf-service)( |$)'
watched_pids() { pgrep -f "$WATCH" | sort || true; }
copy_pids() { [ -n "$PORT" ] && pgrep -f "^$ELECTRON .*--remote-debugging-port=$PORT( |\$)" || true; }

after_check() {
  [ -s "$ISO/started" ] || { echo "isolated.sh check: no run recorded in $ISO" >&2; return 2; }
  local since run fail=0 dumps new left
  since="$(cat "$ISO/started")"
  run="$(cat "$ISO/runtime" 2>/dev/null || echo /nonexistent)"
  dumps="$(coredumpctl list --since "$since" --no-legend 2>/dev/null | grep -v '^No coredumps' || true)"
  if [ -n "$dumps" ]; then
    echo "after-check: core dumps since $since:" >&2
    printf '%s\n' "$dumps" >&2
    fail=1
  fi
  new="$(comm -13 "$ISO/watched-before" <(watched_pids))"
  if [ -n "$new" ]; then
    echo "after-check: desktop helpers started since $since:" >&2
    for p in $new; do ps -o pid=,args= -p "$p" >&2 || true; done
    fail=1
  fi
  left="$( { grep -lsaF "XDG_RUNTIME_DIR=$run" /proc/[0-9]*/environ || true; } | wc -l)"
  if [ "$left" != 0 ]; then
    echo "after-check: $left processes still run with this copy's runtime folder $run" >&2
    fail=1
  fi
  [ "$fail" = 0 ] && echo "after-check: clean (no core dumps, no desktop helpers started, nothing left running)"
  return "$fail"
}

case "$cmd" in
  start)
    [ -n "$PORT" ] || { echo "isolated.sh start: --port P" >&2; exit 2; }
    [ -x "$ELECTRON" ] || { echo "isolated.sh: no Electron at $ELECTRON (npm ci first)" >&2; exit 2; }
    missing=()
    for tool in bwrap dbus-run-session curl coredumpctl $([ "$SHOW" = 1 ] || echo xvfb-run); do command -v "$tool" > /dev/null || missing+=("$tool"); done
    [ "${#missing[@]}" = 0 ] || { echo "isolated.sh needs: ${missing[*]} (install them first)" >&2; exit 2; }
    # Never attach to someone else's app: both ports must be free.
    for p in "$PORT" $((PORT + 1)); do
      if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$p/json"; then
        echo "isolated.sh: port $p is in use by another program; pick another --port (uses P and P + 1)" >&2
        exit 2
      fi
    done
    [ -s "$ISO/runtime" ] && rm -rf "$(cat "$ISO/runtime")"
    rm -rf "$ISO"
    mkdir -p "$ISO/no-services" "$STATE/home" "$STATE/userdata"
    run="$(mktemp -d /tmp/ds5iso.XXXXXX)"
    chmod 700 "$run"
    echo "$run" > "$ISO/runtime"
    cat > "$ISO/session.conf" <<EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<!-- A private session bus with nothing to start: its only service folder is empty. -->
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:dir=$run</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$ISO/no-services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF
    watched_pids > "$ISO/watched-before"
    date '+%Y-%m-%d %H:%M:%S' > "$ISO/started"
    SANDBOX=(bwrap --dev-bind / / --dev /dev --tmpfs "/run/user/$(id -u)")
    for node in /dev/dri /dev/nvidia*; do
      if [ -e "$node" ]; then SANDBOX+=(--dev-bind "$node" "$node"); fi
    done
    DISPLAY_WRAP=(xvfb-run -a -s "-screen 0 ${SIZE}x24 -nolisten tcp")
    [ "$SHOW" = 1 ] && DISPLAY_WRAP=(env DISPLAY="${DISPLAY:?--show needs DISPLAY}")
    setsid env -i PATH=/usr/local/bin:/usr/bin:/bin LANG="${LANG:-C.UTF-8}" USER="$USER" LOGNAME="$USER" \
      HOME="$STATE/home" XDG_RUNTIME_DIR="$run" XDG_CONFIG_HOME="$STATE/home/.config" XDG_DATA_HOME="$STATE/home/.local/share" \
      XDG_CACHE_HOME="$STATE/home/.cache" XDG_DATA_DIRS=/usr/local/share:/usr/share XDG_CONFIG_DIRS=/etc/xdg \
      GTK_USE_PORTAL=0 NO_AT_BRIDGE=1 GSETTINGS_BACKEND=memory GIO_USE_VFS=local \
      "${ENVS[@]}" \
      "${DISPLAY_WRAP[@]}" \
      dbus-run-session --config-file="$ISO/session.conf" -- \
      "${SANDBOX[@]}" "${NICE[@]}" "$ELECTRON" "$APP" --ozone-platform=x11 --no-sandbox --password-store=basic \
      --user-data-dir="$STATE/userdata" --remote-debugging-port="$PORT" --inspect="$((PORT + 1))" "${EXTRA[@]}" \
      > "$STATE/app.log" 2>&1 < /dev/null &
    echo "$!" > "$ISO/session-pid"
    up=0
    for _ in $(seq 60); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/json" && up=1 && break; sleep 1; done
    if [ "$up" != 1 ]; then
      echo "isolated.sh: the copy never answered on port $PORT. The end of $STATE/app.log:" >&2
      tail -n 30 "$STATE/app.log" >&2 || true
      "$0" stop --state "$STATE" --port "$PORT" || true
      exit 1
    fi
    echo "isolated copy up: DevTools $PORT, main inspector $((PORT + 1)), files in $STATE"
    ;;
  stop)
    [ -n "$PORT" ] || { echo "isolated.sh stop: --port P" >&2; exit 2; }
    how=""
    if [ -n "$(copy_pids)" ]; then
      # The app's own quit: app.quit() in the main process (its before-quit runs).
      node --input-type=module -e '
        const port = Number(process.argv[1]) + 1;
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const ws = new WebSocket(list[0].webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "{ const app = require(\"electron\").app; setTimeout(() => app.quit(), 50); true }", includeCommandLineAPI: true } }));
        await new Promise((r) => setTimeout(r, 300));
        ws.close();
      ' "$PORT" 2> /dev/null && how="app.quit()"
      for _ in $(seq 40); do [ -z "$(copy_pids)" ] && break; sleep 0.5; done
      if [ -n "$(copy_pids)" ]; then
        echo "isolated.sh: still running 20 s after app.quit(); last resort: SIGKILL" >&2
        kill -KILL $(copy_pids) 2> /dev/null || true
        how="SIGKILL (last resort)"
      fi
    fi
    # The wrapper (xvfb-run, the private bus) ends with the app: up to 10 s.
    sp="$(cat "$ISO/session-pid" 2>/dev/null || true)"
    run="$(cat "$ISO/runtime" 2>/dev/null || echo /nonexistent)"
    for _ in $(seq 20); do
      { [ -z "$sp" ] || ! kill -0 "$sp" 2> /dev/null; } && ! grep -qsaF "XDG_RUNTIME_DIR=$run" /proc/[0-9]*/environ && break
      sleep 0.5
    done
    [ -n "${how}" ] && echo "isolated copy stopped: $how"
    status=0
    after_check || status=$?
    [ -s "$ISO/runtime" ] && rm -rf "$(cat "$ISO/runtime")"
    exit "$status"
    ;;
  check)
    after_check
    ;;
  *)
    sed -n 2,13p "$0"
    exit 2
    ;;
esac
