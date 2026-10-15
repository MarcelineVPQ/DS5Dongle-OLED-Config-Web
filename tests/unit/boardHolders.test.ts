// Naming what holds the board (Linux): its device node from sysfs (only a
// board with the configurator interface, never a DualSense on a cable), then
// the user's processes with that node open. A fake sysfs and /proc in a temp
// folder; the real ones are never read here.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardHolders, boardNodes, holderKind, type HolderRoots } from "../../electron/main/boardHolders";
import { isBoardBusy, isOpenFailure } from "../../src/hooks/useDs5Bridge";

let dir = "";
let roots: HolderRoots;

function usbDevice(name: string, ids: string, bus: number, dev: number, classes: string[]) {
  const d = join(roots.sys, name);
  mkdirSync(d, { recursive: true });
  const [vid, pid] = ids.split(":");
  writeFileSync(join(d, "idVendor"), `${vid}\n`);
  writeFileSync(join(d, "idProduct"), `${pid}\n`);
  writeFileSync(join(d, "busnum"), `${bus}\n`);
  writeFileSync(join(d, "devnum"), `${dev}\n`);
  // loop: test — a device's few interfaces
  classes.forEach((c, i) => {
    mkdirSync(join(d, `${name}:1.${i}`));
    writeFileSync(join(d, `${name}:1.${i}`, "bInterfaceClass"), `${c}\n`);
  });
}

function proc(pid: number, comm: string, exe: string, cmdline: string[], fds: string[]) {
  const p = join(roots.proc, String(pid));
  mkdirSync(join(p, "fd"), { recursive: true });
  writeFileSync(join(p, "comm"), `${comm}\n`);
  writeFileSync(join(p, "cmdline"), cmdline.join("\0"));
  symlinkSync(exe, join(p, "exe"));
  // loop: test — a few fds
  fds.forEach((target, i) => symlinkSync(target, join(p, "fd", String(i))));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ds5-holders-"));
  roots = { sys: join(dir, "sys"), proc: join(dir, "proc"), dev: "/dev/bus/usb", self: 100, selfExe: "/tmp/.mount_DS5Don/ds5-dongle-configurator" };
  mkdirSync(roots.sys);
  mkdirSync(roots.proc);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Symlinks in a temp folder need admin rights on Windows (the code is Linux-only anyway).
const posix = process.platform !== "win32";

describe.runIf(posix)("the board's device node", () => {
  it("is the 054C device with a vendor-class interface, not a DualSense on a cable", async () => {
    usbDevice("3-2", "054c:0ce6", 3, 7, ["01", "01", "03", "ff"]); // the board (audio, HID, configurator)
    usbDevice("1-4", "054c:0ce6", 1, 12, ["01", "01", "03"]); // a real DualSense by USB
    usbDevice("1-5", "046d:c52b", 1, 13, ["03"]);
    expect(await boardNodes(roots)).toEqual(["/dev/bus/usb/003/007"]);
  });
});

describe.runIf(posix)("boardHolders", () => {
  it("names the processes with the board's node open, never this app itself", async () => {
    usbDevice("3-2", "054c:0df2", 3, 7, ["01", "03", "ff"]);
    proc(100, "ds5-dongle-conf", "/tmp/.mount_DS5Don/ds5-dongle-configurator", ["ds5-dongle-configurator"], ["/dev/bus/usb/003/007"]); // us
    proc(200, "chrome", "/opt/google/chrome/chrome", ["/opt/google/chrome/chrome"], ["/dev/null", "/dev/bus/usb/003/007"]);
    proc(300, "ds5-dongle-conf", "/tmp/.mount_DS5Dabc/ds5-dongle-configurator", ["ds5-dongle-configurator", "--no-sandbox"], ["/dev/bus/usb/003/007"]); // the dev copy
    proc(400, "steam", "/home/me/.steam/ubuntu12_32/steam", ["steam"], ["/dev/hidraw3"]); // the controller's HID: not the board
    proc(500, "picotool", "/usr/bin/picotool", ["picotool", "info"], ["/dev/bus/usb/003/007"]);
    const holders = await boardHolders(roots);
    expect(holders.sort((a, b) => a.pid - b.pid)).toEqual([
      { pid: 200, name: "chrome", kind: "browser" },
      { pid: 300, name: "ds5-dongle-configurator", kind: "app" },
      { pid: 500, name: "picotool", kind: "other" },
    ]);
  });

  it("is empty without the board, and without access to a process's files", async () => {
    proc(200, "chrome", "/opt/google/chrome/chrome", [], ["/dev/bus/usb/003/007"]);
    expect(await boardHolders(roots)).toEqual([]);
  });
});

describe("holderKind", () => {
  it("tells another copy of the app and a browser from other programs", () => {
    expect(
      holderKind("/home/me/DS5/node_modules/electron/dist/electron", "electron", "electron /home/me/DS5Dongle-OLED-Config-Web/out/main/index.js ds5-dongle-configurator", "/x/ds5-dongle-configurator"),
    ).toBe("app");
    expect(holderKind("/usr/lib/chromium/chromium", "chromium", "", "/x/app")).toBe("browser");
    expect(holderKind("/opt/brave.com/brave/brave", "brave", "", "/x/app")).toBe("browser");
    expect(holderKind(null, "msedge", "", "/x/app")).toBe("browser");
    expect(holderKind("/usr/bin/python3", "python3", "python3 ds4drv", "/x/app")).toBe("other");
  });
});

describe("isBoardBusy", () => {
  const claim = new DOMException("Failed to execute 'claimInterface' on 'USBDevice': Unable to claim interface.", "NetworkError");
  const denied = new DOMException("Failed to execute 'open' on 'USBDevice': Access denied.", "SecurityError");
  const gone = new DOMException("Failed to execute 'open' on 'USBDevice': The device was disconnected.", "NotFoundError");
  it("is the failed claim on every OS", () => {
    // loop: test — 3 platforms
    for (const os of ["linux", "win32", "darwin"]) expect(isBoardBusy(claim, os)).toBe(true);
    expect(isOpenFailure(claim)).toBe(true);
  });
  it("is an open that's refused on Windows and macOS (one program at a time), but the missing udev rule on Linux", () => {
    expect(isBoardBusy(denied, "win32")).toBe(true);
    expect(isBoardBusy(denied, "darwin")).toBe(true);
    expect(isBoardBusy(denied, "linux")).toBe(false);
  });
  it("is never an unplugged board or another error", () => {
    expect(isBoardBusy(gone, "win32")).toBe(false);
    expect(isBoardBusy(new Error("Unable to claim interface"), "linux")).toBe(false);
    expect(isBoardBusy(new DOMException("The transfer timed out.", "TimeoutError"), "linux")).toBe(false);
  });
});
