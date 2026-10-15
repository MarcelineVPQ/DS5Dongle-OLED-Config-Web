// Which programs have the board open, for the "in use by another program"
// notice (WebUSB's "Unable to claim interface"). Linux only, read-only: the
// board's device node comes from sysfs (054C:0CE6 / 054C:0DF2 with the
// firmware's vendor-class configurator interface, so a real DualSense on a
// USB cable is never taken for it), and a holder is one of the user's own
// processes with that node among its open files in /proc. Windows and macOS
// have no such list without admin rights: an empty list, and the notice
// names the usual suspects instead. Asked only while the board is busy.
import { readFile, readdir, readlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BoardHolder, BoardHolderKind } from "../../src/desktop/api";

const BOARD_IDS = new Set(["054c:0ce6", "054c:0df2"]);
const VENDOR_CLASS = "ff";
const MAX_HOLDERS = 5;

export interface HolderRoots {
  sys: string; // /sys/bus/usb/devices
  proc: string; // /proc
  dev: string; // /dev/bus/usb
  self: number; // this app's pid (its own handle isn't "another program")
  selfExe: string; // this app's program, to recognize another copy of it
}

const realRoots = (): HolderRoots => ({ sys: "/sys/bus/usb/devices", proc: "/proc", dev: "/dev/bus/usb", self: process.pid, selfExe: process.execPath });

const read = (path: string) =>
  // error: NOT-WORTH — a sysfs/proc file that's gone or unreadable (another user's process, a device leaving): treated as absent
  readFile(path, "utf8").then(
    (s) => s.trim(),
    () => null,
  );

// The board's device nodes (/dev/bus/usb/BBB/DDD).
export async function boardNodes(roots: Pick<HolderRoots, "sys" | "dev">): Promise<string[]> {
  // error: NOT-WORTH — no sysfs: no node, so no holder is named (the notice still shows)
  const entries = await readdir(roots.sys).catch(() => [] as string[]);
  const nodes: string[] = [];
  // loop: NOT-WORTH — the USB devices on the system (tens), only while the board is busy
  for (const entry of entries) {
    if (entry.includes(":")) continue; // an interface, not a device
    const dir = join(roots.sys, entry);
    const ids = `${await read(join(dir, "idVendor"))}:${await read(join(dir, "idProduct"))}`;
    if (!BOARD_IDS.has(ids.toLowerCase())) continue;
    // error: NOT-WORTH — a device that left meanwhile: skipped
    const files = await readdir(dir).catch(() => [] as string[]);
    // loop: NOT-WORTH — one device's few sysfs entries
    const itfs = files.filter((n) => n.startsWith(`${entry}:`));
    // loop: NOT-WORTH — a board's 3-5 interfaces
    const classes = await Promise.all(itfs.map((n) => read(join(dir, n, "bInterfaceClass"))));
    if (!classes.includes(VENDOR_CLASS)) continue; // a DualSense on a cable has no configurator interface
    const bus = Number(await read(join(dir, "busnum")));
    const num = Number(await read(join(dir, "devnum")));
    if (bus > 0 && num > 0) nodes.push(join(roots.dev, String(bus).padStart(3, "0"), String(num).padStart(3, "0")));
  }
  return nodes;
}

const BROWSERS = /^(chrome|chromium|chromium-browser|google-chrome.*|brave.*|msedge|microsoft-edge.*|opera.*|vivaldi.*|thorium.*|yandex.*)$/i;
const APP_NAMES = /ds5-dongle-configurator|DS5Dongle-OLED-Edition-Configurator/i;

export function holderKind(exe: string | null, comm: string, cmdline: string, selfExe: string): BoardHolderKind {
  const name = exe ? basename(exe) : comm;
  if ((exe && basename(exe) === basename(selfExe)) || APP_NAMES.test(cmdline)) return "app";
  if (BROWSERS.test(name) || BROWSERS.test(comm)) return "browser";
  return "other";
}

export async function boardHolders(roots: HolderRoots = realRoots()): Promise<BoardHolder[]> {
  if (process.platform !== "linux" && roots.proc === "/proc") return [];
  const nodes = new Set(await boardNodes(roots));
  if (nodes.size === 0) return [];
  // error: NOT-WORTH — no /proc: nobody can be named
  const pids = (await readdir(roots.proc).catch(() => [] as string[])).filter((e) => /^\d+$/.test(e) && Number(e) !== roots.self);
  const holders: BoardHolder[] = [];
  // loop: NOT-WORTH — rare: only while the board is busy (its first failed claim and Retry), never per frame; stops at MAX_HOLDERS
  for (const pid of pids) {
    const fdDir = join(roots.proc, pid, "fd");
    // error: NOT-WORTH — another user's process (EACCES) or one that ended: not ours to name
    const fds = await readdir(fdDir).catch(() => [] as string[]);
    let holds = false;
    // loop: NOT-WORTH — one process's open files, stops at the first match
    for (const fd of fds) {
      // error: NOT-WORTH — a file closed meanwhile: not the board
      const target = await readlink(join(fdDir, fd)).catch(() => null);
      if (target && nodes.has(target)) {
        holds = true;
        break;
      }
    }
    if (!holds) continue;
    const comm = (await read(join(roots.proc, pid, "comm"))) ?? "?";
    // error: NOT-WORTH — no exe link (a process ending): its short name is used
    const exe = await readlink(join(roots.proc, pid, "exe")).catch(() => null);
    const cmdline = ((await read(join(roots.proc, pid, "cmdline"))) ?? "").replace(/\0/g, " ");
    holders.push({ pid: Number(pid), name: exe ? basename(exe).replace(/ \(deleted\)$/, "") : comm, kind: holderKind(exe, comm, cmdline, roots.selfExe) });
    if (holders.length >= MAX_HOLDERS) break;
  }
  return holders;
}
