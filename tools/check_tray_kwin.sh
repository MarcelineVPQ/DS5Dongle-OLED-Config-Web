#!/usr/bin/env bash
# The tray check in a nested KWin: does a tray click bring the minimized app
# back the way Plasma's tray does it on Wayland (an xdg-activation token, then
# Activate)? Run by hand when the tray or Electron changes (docs/TEST_PLAN.md);
# never in CI (it needs KWin and a display server).
#
#   tools/check_tray_kwin.sh [--state DIR] [--port P]
#
# Needs a build (npm run build:desktop) and: kwin_wayland, Xvfb, dbus-run-session,
# gdbus, bwrap, python3 with PyGObject (Gio, GTK 4), curl, node.
#
# Everything is private, nothing touches your session (the isolated-copy
# rules of tools/isolated.sh):
#   - env -i: a clean environment; its own HOME (DIR/home), settings
#     (DIR/userdata) and runtime folder (mode 700 under /tmp), so no Wayland,
#     PipeWire or bus socket of yours is found;
#   - a private D-Bus session bus from a minimal config whose only service
#     folder is empty: nothing can be started on it by name (no portals,
#     wallet, kglobalaccel, tray host of yours);
#   - its own X server (Xvfb, never your display) with a nested KWin
#     (kwin_wayland --x11-display) inside it: the app is a Wayland client of
#     that KWin only;
#   - a stand-in tray host: a small StatusNotifierWatcher on the private bus
#     that records the app's tray item (Plasma's tray isn't there);
#   - the app in bubblewrap with a fresh /dev (no USB or hidraw: no real
#     board), --password-store=basic, quit through app.quit() (never SIGTERM:
#     Electron answers it with a core dump and a crash notice on the desktop).
#
# The trial, the way Plasma's tray brings a window back:
#   1. the app's window is up; KWin reports where it is;
#   2. a KWin script minimizes it;
#   3. a helper window opens and takes the focus (focus is elsewhere);
#   4. the helper asks KWin for an xdg-activation token and hands it to the
#      app's tray item (ProvideXdgActivationToken), then calls Activate;
#   5. a KWin script reports: the app is restored (not minimized), it is the
#      active window, at the same position, and doesn't ask for attention
#      (no taskbar flashing instead of raising).
# Prints PASS or FAIL per check; exit 0 only when all pass. Files: DIR
# (default tmp/tray-kwin): kwin.log, app.log, reports.jsonl.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$APP/node_modules/electron/dist/electron"
STATE="$APP/tmp/tray-kwin" PORT=9450
HELPER_TITLE="ds5-tray-check-helper"

if [ "${1:-}" = "__inner" ]; then
  shift
  STATE="$1" PORT="$2"
  run="$XDG_RUNTIME_DIR"
  pids=()
  cleanup() {
    # The app through its own quit; then the rest (our own children, plain TERM).
    node --input-type=module -e '
      const list = await (await fetch(`http://127.0.0.1:${process.argv[1]}/json/list`)).json();
      const ws = new WebSocket(list[0].webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "{ const app = require(\"electron\").app; setTimeout(() => app.quit(), 50); true }", includeCommandLineAPI: true } }));
      await new Promise((r) => setTimeout(r, 300));
      ws.close();' "$PORT" 2> /dev/null || true
    for _ in $(seq 40); do pgrep -f "^$ELECTRON .*--inspect=$PORT( |\$)" > /dev/null || break; sleep 0.5; done
    pkill -KILL -f "^$ELECTRON .*--inspect=$PORT( |\$)" 2> /dev/null || true
    for p in "${pids[@]}"; do kill "$p" 2> /dev/null || true; done
    wait 2> /dev/null || true
  }
  trap cleanup EXIT

  # The stand-in tray host and the report sink, on the private bus.
  python3 -I "$STATE/traycheck.py" watcher "$STATE" > "$STATE/watcher.log" 2>&1 &
  pids+=($!)
  # Our own X server; Xvfb picks a free display and writes its number.
  rm -f "$STATE/xdisplay"
  Xvfb -displayfd 3 -screen 0 1600x1000x24 -nolisten tcp 3> "$STATE/xdisplay" > "$STATE/xvfb.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 50); do [ -s "$STATE/xdisplay" ] && break; sleep 0.1; done
  [ -s "$STATE/xdisplay" ] || { echo "Xvfb didn't start (see $STATE/xvfb.log)" >&2; exit 1; }
  export DISPLAY=":$(head -n1 "$STATE/xdisplay")"
  kwin_wayland --x11-display "$DISPLAY" --socket wayland-ds5tray --width 1400 --height 900 --no-lockscreen --no-global-shortcuts > "$STATE/kwin.log" 2>&1 &
  pids+=($!)
  owner() { gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner "$1" 2> /dev/null | grep -q true; }
  for _ in $(seq 100); do [ -S "$run/wayland-ds5tray" ] && owner org.kde.KWin && owner org.ds5.TrayCheck && break; sleep 0.2; done
  owner org.kde.KWin || { echo "the nested KWin didn't start (see $STATE/kwin.log)" >&2; exit 1; }
  export WAYLAND_DISPLAY=wayland-ds5tray

  # A KWin script: report the windows (and, with "minimize", minimize the app first).
  n=0
  kwin() {
    n=$((n + 1))
    local file="$STATE/kwin-$n.js"
    cat > "$file" << EOF
const helperTitle = "$HELPER_TITLE";
const wins = workspace.windowList().filter((w) => w.normalWindow);
const app = wins.find((w) => !w.caption.startsWith(helperTitle));
if ("$1" === "minimize" && app) app.minimized = true;
const show = (w) => w && { caption: w.caption, x: w.frameGeometry.x, y: w.frameGeometry.y, minimized: w.minimized, demandsAttention: w.demandsAttention };
const active = workspace.activeWindow;
callDBus("org.ds5.TrayCheck", "/TrayCheck", "org.ds5.TrayCheck", "Report", JSON.stringify({
  label: "$2", app: show(app), activeIsApp: !!app && !!active && active.internalId.toString() === app.internalId.toString(), active: active ? active.caption : null, windows: wins.length,
}));
EOF
    local id
    id="$(gdbus call --session --dest org.kde.KWin --object-path /Scripting --method org.kde.kwin.Scripting.loadScript "$file" "ds5tray$n" | grep -o '[0-9]\+' | head -n1)"
    gdbus call --session --dest org.kde.KWin --object-path "/Scripting/Script$id" --method org.kde.kwin.Script.run > /dev/null
    sleep 1
    gdbus call --session --dest org.kde.KWin --object-path /Scripting --method org.kde.kwin.Scripting.unloadScript "ds5tray$n" > /dev/null || true
  }
  report() { python3 -I -c 'import json,os,sys; r=[json.loads(l) for l in open(sys.argv[1])] if os.path.exists(sys.argv[1]) else []; m=[x for x in r if x["label"]==sys.argv[2]]; print(json.dumps(m[-1]) if m else "")' "$STATE/reports.jsonl" "$1"; }
  field() { python3 -I -c 'import json,sys; d=json.loads(sys.argv[1] or "{}"); v=d; [v := (v or {}).get(k) for k in sys.argv[2].split(".")]; print(json.dumps(v))' "$1" "$2"; }

  # The app: a Wayland client of the nested KWin, no USB, its own settings.
  bwrap --dev-bind / / --dev /dev --tmpfs "/run/user/$(id -u)" $(for node in /dev/dri /dev/nvidia*; do [ -e "$node" ] && echo --dev-bind "$node" "$node"; done) \
    "$ELECTRON" "$APP" --ozone-platform=wayland --no-sandbox --password-store=basic \
    --user-data-dir="$STATE/userdata" --inspect="$PORT" > "$STATE/app.log" 2>&1 < /dev/null &
  for _ in $(seq 60); do
    [ -s "$STATE/items.txt" ] && kwin report up && [ "$(field "$(report up)" app)" != "null" ] && break
    sleep 1
  done
  [ -s "$STATE/items.txt" ] || { echo "FAIL: the app's tray item never registered (see $STATE/app.log)"; exit 1; }
  sleep 2 # let the window settle where KWin placed it
  kwin report before
  before="$(report before)"
  [ "$(field "$before" app)" != "null" ] || { echo "FAIL: no app window (see $STATE/app.log)"; exit 1; }

  kwin minimize minimized
  python3 -I "$STATE/traycheck.py" helper "$STATE" "$HELPER_TITLE" > "$STATE/helper.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 30); do [ -s "$STATE/activated" ] && break; sleep 0.5; done
  [ -s "$STATE/activated" ] || { echo "FAIL: the helper never handed a token to the tray item (see $STATE/helper.log)"; exit 1; }
  sleep 2
  kwin report after
  after="$(report after)"

  fail=0
  check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got $2, want $3)"; fail=1; fi; }
  check "minimized by the KWin script" "$(field "$(report minimized)" app.minimized)" true
  check "focus was elsewhere before the tray click" "$(cat "$STATE/activated")" "token-given-while-focused"
  check "restored (not minimized)" "$(field "$after" app.minimized)" false
  check "the active window" "$(field "$after" activeIsApp)" true
  check "same position x" "$(field "$after" app.x)" "$(field "$before" app.x)"
  check "same position y" "$(field "$after" app.y)" "$(field "$before" app.y)"
  check "no attention flag" "$(field "$after" app.demandsAttention)" false
  exit "$fail"
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --state) STATE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) sed -n 2,9p "$0"; exit 2 ;;
  esac
done
missing=()
for tool in kwin_wayland Xvfb dbus-run-session gdbus bwrap python3 curl node; do command -v "$tool" > /dev/null || missing+=("$tool"); done
python3 -I -c 'import gi; gi.require_version("Gtk", "4.0"); from gi.repository import Gtk, Gio' 2> /dev/null || missing+=("python3 PyGObject with GTK 4")
[ "${#missing[@]}" = 0 ] || { echo "check_tray_kwin.sh needs: ${missing[*]}" >&2; exit 2; }
[ -x "$ELECTRON" ] || { echo "no Electron at $ELECTRON (npm ci first)" >&2; exit 2; }
[ -f "$APP/out/main/index.js" ] || { echo "no build in out/ (npm run build:desktop first)" >&2; exit 2; }
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/json"; then
  echo "port $PORT is in use by another program; pick another --port" >&2
  exit 2
fi
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd)"
rm -rf "$STATE/home" "$STATE/userdata" "$STATE/no-services" "$STATE"/kwin-*.js
rm -f "$STATE/items.txt" "$STATE/reports.jsonl" "$STATE/activated"
mkdir -p "$STATE/home" "$STATE/userdata" "$STATE/no-services"
run="$(mktemp -d /tmp/ds5tray.XXXXXX)"
chmod 700 "$run"
cat > "$STATE/session.conf" << EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<!-- A private session bus with nothing to start: its only service folder is empty. -->
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:dir=$run</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$STATE/no-services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF

# The stand-in tray host + report sink (watcher) and the focus-taking helper window (helper).
cat > "$STATE/traycheck.py" << 'EOF'
import json, os, sys
import gi
gi.require_version("Gtk", "4.0")
from gi.repository import Gio, GLib

mode, state = sys.argv[1], sys.argv[2]
SNI = "org.kde.StatusNotifierItem"

if mode == "watcher":
    xml = """<node>
      <interface name="org.kde.StatusNotifierWatcher">
        <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
        <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
        <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
        <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
        <property name="ProtocolVersion" type="i" access="read"/>
        <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
        <signal name="StatusNotifierHostRegistered"/>
      </interface>
      <interface name="org.ds5.TrayCheck">
        <method name="Report"><arg type="s" direction="in"/></method>
      </interface>
    </node>"""
    node = Gio.DBusNodeInfo.new_for_xml(xml)
    items = []

    def call(conn, sender, path, iface, method, params, inv):
        if method == "RegisterStatusNotifierItem":
            arg = params.unpack()[0]
            service, obj = (sender, arg) if arg.startswith("/") else (arg, "/StatusNotifierItem")
            items.append(f"{service}{obj}")
            with open(os.path.join(state, "items.txt"), "a") as f:
                f.write(f"{service} {obj}\n")
            conn.emit_signal(None, "/StatusNotifierWatcher", "org.kde.StatusNotifierWatcher", "StatusNotifierItemRegistered", GLib.Variant("(s)", (f"{service}{obj}",)))
        elif method == "Report":
            with open(os.path.join(state, "reports.jsonl"), "a") as f:
                f.write(params.unpack()[0] + "\n")
        inv.return_value(None)

    def prop(conn, sender, path, iface, name):
        return {"RegisteredStatusNotifierItems": GLib.Variant("as", items), "IsStatusNotifierHostRegistered": GLib.Variant("b", True), "ProtocolVersion": GLib.Variant("i", 0)}[name]

    def acquired(conn, name):
        conn.register_object("/StatusNotifierWatcher", node.interfaces[0], call, prop, None)
        conn.register_object("/TrayCheck", node.interfaces[1], call, None, None)

    Gio.bus_own_name(Gio.BusType.SESSION, "org.kde.StatusNotifierWatcher", Gio.BusNameOwnerFlags.NONE, acquired, None, None)
    Gio.bus_own_name(Gio.BusType.SESSION, f"org.kde.StatusNotifierHost-{os.getpid()}", Gio.BusNameOwnerFlags.NONE, None, None, None)
    Gio.bus_own_name(Gio.BusType.SESSION, "org.ds5.TrayCheck", Gio.BusNameOwnerFlags.NONE, None, None, None)
    GLib.MainLoop().run()

elif mode == "helper":
    from gi.repository import Gdk, Gtk

    title = sys.argv[3]
    app = Gtk.Application(application_id="org.ds5.TrayCheckHelper", flags=Gio.ApplicationFlags.NON_UNIQUE)
    done = []

    def hand_over(win):
        # As Plasma's tray does: a token from the focused client, then Activate on the item.
        ctx = Gdk.Display.get_default().get_app_launch_context()
        info = Gio.AppInfo.create_from_commandline("true", "tray-check", Gio.AppInfoCreateFlags.NONE)
        token = ctx.get_startup_notify_id(info, [])
        focused = win.is_active()
        service, path = open(os.path.join(state, "items.txt")).read().split()[:2]
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        bus.call_sync(service, path, SNI, "ProvideXdgActivationToken", GLib.Variant("(s)", (token,)), None, Gio.DBusCallFlags.NONE, 5000, None)
        bus.call_sync(service, path, SNI, "Activate", GLib.Variant("(ii)", (0, 0)), None, Gio.DBusCallFlags.NONE, 5000, None)
        with open(os.path.join(state, "activated"), "w") as f:
            f.write("token-given-while-focused" if token and focused else f"token={bool(token)} focused={focused}")
        GLib.timeout_add(8000, app.quit)  # stays open until the report is taken
        return False

    def on_active(win, _pspec):
        if win.is_active() and not done:
            done.append(True)
            GLib.timeout_add(500, hand_over, win)

    def activate(a):
        win = Gtk.ApplicationWindow(application=a, title=title)
        win.set_default_size(320, 200)
        win.connect("notify::is-active", on_active)
        win.present()

    app.connect("activate", activate)
    app.run([])
EOF

echo "tray check: nested KWin on a private display and bus; files in $STATE"
status=0
setsid env -i PATH=/usr/local/bin:/usr/bin:/bin LANG="${LANG:-C.UTF-8}" USER="$USER" LOGNAME="$USER" \
  HOME="$STATE/home" XDG_RUNTIME_DIR="$run" XDG_CONFIG_HOME="$STATE/home/.config" XDG_DATA_HOME="$STATE/home/.local/share" \
  XDG_CACHE_HOME="$STATE/home/.cache" XDG_DATA_DIRS=/usr/local/share:/usr/share XDG_CONFIG_DIRS=/etc/xdg \
  GTK_USE_PORTAL=0 NO_AT_BRIDGE=1 GSETTINGS_BACKEND=memory GIO_USE_VFS=local \
  dbus-run-session --config-file="$STATE/session.conf" -- bash "$0" __inner "$STATE" "$PORT" || status=$?
left="$( { grep -lsaF "XDG_RUNTIME_DIR=$run" /proc/[0-9]*/environ || true; } | wc -l)"
[ "$left" = 0 ] || { echo "after-check: $left processes still run with this check's runtime folder $run" >&2; status=1; }
rm -rf "$run"
exit "$status"
