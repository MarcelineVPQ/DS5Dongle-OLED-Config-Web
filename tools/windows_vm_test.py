#!/usr/bin/env python3
"""Windows end-to-end test of connecting to the dongle, in a libvirt VM.

Runs against a Windows VM (default: win11-test) with the QEMU guest agent
installed and the dongle plugged into this PC with a controller connected (it
only appears on USB then). The test passes the dongle into the VM by its USB
address (never by ID: a real DualSense has the same one), drives the app with
virtual keystrokes, checks Windows' driver state through the guest agent, and
saves a screenshot of every step for a person to look at.

  tools/windows_vm_test.py --exe 'C:\\Users\\Public\\Desktop\\DS5-repair-test.exe'

Cases:
  new-user  Windows has never seen the dongle's IDs: WinUSB is set up by
            itself and the app connects.
  repair    Windows kept "no descriptor" for the IDs (what a real DualSense
            plugged in by USB leaves): the app shows Repair USB driver; Yes on
            the admin prompt; replug; the app connects.
  cancel    The same, but No on the admin prompt: nothing changes, the app
            says Cancelled.
Afterwards the dongle is left attached to the VM and working.
"""
import argparse
import base64
import json
import re
import subprocess
import sys
import time
from pathlib import Path

VM = "win11-test"
CONN = ["-c", "qemu:///system"]
OUT = Path("tmp/windows-vm-test")
FLAGS = r"HKLM:\SYSTEM\CurrentControlSet\Control\usbflags\054C0CE60100"


def virsh(*args, check=True):
    return subprocess.run(["virsh", *CONN, *args], capture_output=True, text=True, check=check).stdout


def ga(cmd):
    return json.loads(virsh("qemu-agent-command", VM, json.dumps(cmd)))["return"]


def ps(script):
    """PowerShell in the VM (as SYSTEM, through the guest agent); returns stdout."""
    enc = base64.b64encode(("$ProgressPreference='SilentlyContinue'\n" + script).encode("utf-16-le")).decode()
    pid = ga({"execute": "guest-exec", "arguments": {"path": "powershell.exe", "arg": ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc], "capture-output": True}})["pid"]
    for _ in range(600):
        s = ga({"execute": "guest-exec-status", "arguments": {"pid": pid}})
        if s["exited"]:
            return base64.b64decode(s.get("out-data", "")).decode("utf-8", "replace").strip()
        time.sleep(0.2)
    raise TimeoutError(script)


def click(x, y):
    """Left-click at screen pixel (x, y) through the VM's USB tablet (absolute, 0..32767)."""
    from PIL import Image

    OUT.mkdir(parents=True, exist_ok=True)
    ppm = OUT / "screen.ppm"
    virsh("screenshot", VM, str(ppm))
    w, h = Image.open(ppm).size
    pos = [{"type": "abs", "data": {"axis": "x", "value": round(x * 32767 / (w - 1))}}, {"type": "abs", "data": {"axis": "y", "value": round(y * 32767 / (h - 1))}}]
    virsh("qemu-monitor-command", VM, json.dumps({"execute": "input-send-event", "arguments": {"events": pos}}))
    for down in (True, False):
        virsh("qemu-monitor-command", VM, json.dumps({"execute": "input-send-event", "arguments": {"events": [{"type": "btn", "data": {"down": down, "button": "left"}}]}}))
        time.sleep(0.1)


def admin_prompt_open():
    return ps("[bool](Get-Process consent -EA 0)") == "True"


def keys(*names):
    virsh("send-key", VM, *names)
    time.sleep(0.05)


SPECIAL = {" ": "KEY_SPACE", ".": "KEY_DOT", "-": "KEY_MINUS", "\\": "KEY_BACKSLASH", "/": "KEY_SLASH", ",": "KEY_COMMA"}
SHIFTED = {":": "KEY_SEMICOLON", "_": "KEY_MINUS", "(": "KEY_9", ")": "KEY_0"}


def type_text(text):
    for ch in text:
        if ch.isalpha():
            keys(*(["KEY_LEFTSHIFT"] if ch.isupper() else []), "KEY_" + ch.upper())
        elif ch.isdigit():
            keys("KEY_" + ch)
        elif ch in SPECIAL:
            keys(SPECIAL[ch])
        elif ch in SHIFTED:
            keys("KEY_LEFTSHIFT", SHIFTED[ch])
        else:
            raise ValueError(f"can't type {ch!r}")


def shot(name):
    from PIL import Image  # python3-pil

    OUT.mkdir(parents=True, exist_ok=True)
    ppm = OUT / "screen.ppm"
    virsh("screenshot", VM, str(ppm))
    Image.open(ppm).save(OUT / f"{name}.png")
    print(f"    screenshot: {OUT / name}.png")


def dongle_address():
    m = re.search(r"Bus (\d+) Device (\d+): ID 054c:(0ce6|0df2)", subprocess.run(["lsusb"], capture_output=True, text=True).stdout)
    if not m:
        sys.exit("No dongle on USB. Plug it in and turn the controller on (the dongle only appears once a controller is connected).")
    return int(m[1]), int(m[2])


def hostdev_xml(bus, dev):
    path = OUT / "dongle.xml"
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(f"<hostdev mode='subsystem' type='usb' managed='yes'><source><address bus='{bus}' device='{dev}'/></source></hostdev>")
    return str(path)


def attached():
    m = re.search(r"<hostdev[^>]*type='usb'.*?<address bus='(\d+)' device='(\d+)'/>", virsh("dumpxml", VM), re.S)
    return (int(m[1]), int(m[2])) if m else None


def replug():
    """Unplug the dongle from the VM and plug it back in (a real re-enumeration)."""
    old = attached()
    if old:
        virsh("detach-device", VM, hostdev_xml(*old), "--live")
        time.sleep(3)
    # Detaching can make the dongle reconnect on this PC with a new address.
    for _ in range(20):
        try:
            virsh("attach-device", VM, hostdev_xml(*dongle_address()), "--live")
            break
        except subprocess.CalledProcessError:
            time.sleep(1)
    time.sleep(15)


def driver_state():
    return ps(
        r"""$d = Get-PnpDevice -PresentOnly | ? InstanceId -like 'USB\VID_054C&PID_0CE6&MI_04*'
if (-not $d) { 'missing'; exit }
$svc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId DEVPKEY_Device_Service -EA 0).Data
$guid = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Enum\$($d.InstanceId)\Device Parameters" -EA 0).DeviceInterfaceGUIDs
'{0} {1} {2}' -f $d.Status, $svc, [bool]$guid"""
    )


def close_app():
    ps("Get-Process | ? { $_.Name -like 'DS5*' } | Stop-Process -Force; Start-Sleep 2")


def forget():
    """What Windows looks like before it has ever seen the IDs."""
    ps(f"Remove-Item '{FLAGS}' -Recurse -Force -EA 0; Get-PnpDevice | ? InstanceId -like 'USB\\VID_054C&PID_0CE6*' | % {{ pnputil /remove-device \"$($_.InstanceId)\" | Out-Null }}")


def poison():
    """What a real DualSense plugged in by USB leaves: "this ID has no MS OS descriptor"."""
    forget()
    ps(f"New-Item '{FLAGS}' -Force | Out-Null; Set-ItemProperty '{FLAGS}' osvc ([byte[]](0,0))")


def launch(exe):
    keys("KEY_LEFTMETA", "KEY_R")
    time.sleep(1.5)
    type_text(exe)
    keys("KEY_ENTER")
    time.sleep(30)


def press_repair():
    """Focus the app (a click in an empty part of its window: Windows won't let
    a launch steal the focus), then press the repair button, the first Tab stop
    on the "Plug in the DS5 Dongle" screen. True once the admin prompt is up."""
    for _ in range(3):
        keys("KEY_ESC")
        from PIL import Image

        virsh("screenshot", VM, str(OUT / "screen.ppm"))
        w, h = Image.open(OUT / "screen.ppm").size
        click(w * 0.45, h * 0.3)  # above the setup text: Tab then goes to the next control below it
        time.sleep(0.5)
        keys("KEY_TAB")
        keys("KEY_ENTER")
        for _ in range(10):
            time.sleep(1)
            if admin_prompt_open():
                time.sleep(1)
                return True
    return False


failures = []


def expect(what, ok):
    print(f"  {'PASS' if ok else 'FAIL'}  {what}")
    if not ok:
        failures.append(what)


def case_new_user(exe):
    print("new-user: Windows has never seen the dongle")
    close_app()
    forget()
    replug()
    expect("WinUSB is set up by itself, with its interface GUID", driver_state() == "OK WINUSB True")
    launch(exe)
    shot("new-user-connected")


def case_repair(exe, accept):
    name = "repair" if accept else "cancel"
    print(f"{name}: Windows kept an old answer for the IDs")
    close_app()
    poison()
    replug()
    expect("the configurator interface has no working driver", driver_state() != "OK WINUSB True")
    launch(exe)
    shot(f"{name}-1-offered")
    prompt = press_repair()
    shot(f"{name}-2-admin-prompt")
    expect("the admin prompt appeared", prompt)
    if not prompt:
        return
    if accept:
        keys("KEY_LEFT")  # No has the focus; Yes is to its left
    keys("KEY_ENTER")
    time.sleep(6)
    shot(f"{name}-3-result")
    gone = ps(f"Test-Path '{FLAGS}'") == "False"
    expect("the saved answer was removed" if accept else "nothing was changed", gone if accept else not gone)
    replug()
    if accept:
        expect("after a replug: WinUSB with its interface GUID", driver_state() == "OK WINUSB True")
        shot(f"{name}-4-connected")
    else:
        expect("after a replug: still no working driver", driver_state() != "OK WINUSB True")


def main():
    global VM
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vm", default=VM)
    ap.add_argument("--exe", required=True, help="the app's .exe, as a path inside the VM")
    ap.add_argument("--cases", default="new-user,repair,cancel")
    args = ap.parse_args()
    VM = args.vm
    cases = args.cases.split(",")
    if "new-user" in cases:
        case_new_user(args.exe)
    if "cancel" in cases:
        case_repair(args.exe, accept=False)
    if "repair" in cases:
        case_repair(args.exe, accept=True)  # last: leaves the dongle working
    close_app()
    print(f"\n{'FAILED: ' + '; '.join(failures) if failures else 'All checks passed.'} Look at the screenshots in {OUT}/ too.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
