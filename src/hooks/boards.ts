// Several boards on one PC (any number: 1, 2 or 20). Which boards are on USB,
// a short summary of each for the rail's board stack, which one to show at
// start, and which bootloader a firmware update may write.
//
// A board is told apart by its own id (protocol 1.20, identity [50..57]: the
// Pico's flash unique id). The USB serial can't do it: the firmware makes it
// the paired controller's MAC on purpose (Wine / Steam match the controller
// by it), so two boards paired to one DualSense present the same serial.
// Older firmware has no id: such a board is known by its serial (and, when
// two share it, only by its place in the list for this session).
//
// Only the board on screen is polled (useDs5Bridge, once a second). The
// others are read once when they show up, on a switch, and then every
// OTHER_BOARDS_MS while the window is shown: one identity + version read each.
import { type BridgeIdentity, Ds5BridgeClient, supportsIdentify } from "../protocol/bridgeClient";
import { SimulatedDongle } from "../protocol/simulatedDongle";
import type { Ds5Transport } from "../protocol/transport";
import { WebUsbTransport, configuratorInterface, isDongle, webUsbAvailable } from "../protocol/webUsbTransport";
import { extraSimulatedBoards, simulatedBoard } from "../desktop/devPreview";
import { readPref, writePref } from "../desktop/storage";

export const LAST_BOARD_ID_KEY = "ds5.lastBoardId";
// How often the boards not on screen are read again (window shown only).
export const OTHER_BOARDS_MS = 15_000;
// How many boards are read at once (each is its own USB device, so they can
// overlap; a bound keeps 20 boards from opening 20 devices at the same moment).
export const BOARD_READS_AT_ONCE = 4;

export type BoardKind = "usb" | "simulated";

// A board on USB now. `key` stays the same while it stays plugged in.
export interface BoardEntry {
  key: string;
  kind: BoardKind;
  device?: USBDevice;
  sim?: SimulatedDongle;
}

// What the board stack shows for a board.
export interface BoardSummary {
  key: string;
  kind: BoardKind;
  // "ok": read; "busy": another program has it; "unreadable": it didn't answer (old firmware, a hiccup).
  reach: "ok" | "busy" | "unreadable";
  boardId: string | null;
  serial: string | null;
  name: string | null;
  version: string | null;
  slot: number | null;
  controllerConnected: boolean;
  model: BridgeIdentity["model"];
  colorwayCode: string | null;
  identifies: boolean;
}

// cache: OK — key=the USBDevice object (Chromium keeps one per plugged-in device); invalidated=a WeakMap entry goes with its device; bound=the boards plugged in this session
const usbKeys = new WeakMap<USBDevice, string>();
// cache: OK — key=none (a counter for usbKeys' names); invalidated=never; bound=one number
let nextUsbKey = 0;
function usbKey(device: USBDevice): string {
  let key = usbKeys.get(device);
  if (!key) {
    key = `usb-${nextUsbKey++}`;
    usbKeys.set(device, key);
  }
  return key;
}

// Every board this app may open now: the simulated ones (dev builds, when on)
// first, then the real ones in the order USB lists them.
export async function listBoards(): Promise<BoardEntry[]> {
  const out: BoardEntry[] = [];
  const sim = simulatedBoard()?.dongle();
  if (sim) out.push({ key: "sim-0", kind: "simulated", sim });
  // loop: NOT-WORTH — N = the Developer card's extra simulated boards (0..19); on a board list refresh
  extraSimulatedBoards().forEach((extra, i) => out.push({ key: `sim-${i + 1}`, kind: "simulated", sim: extra }));
  if (webUsbAvailable()) {
    const devices = await navigator.usb.getDevices();
    // loop: NOT-WORTH — N = USB devices this app may open (the boards); on a board list refresh
    for (const device of devices) if (isDongle(device) && configuratorInterface(device) >= 0) out.push({ key: usbKey(device), kind: "usb", device });
  }
  return out;
}

export const entryTransport = (entry: BoardEntry): Ds5Transport => (entry.sim ? entry.sim : new WebUsbTransport(entry.device!));

// The summary of the board on screen, from what its poll already read.
export function summaryOf(entry: Pick<BoardEntry, "key" | "kind">, id: BridgeIdentity | null, serial: string | null, version: string | null): BoardSummary {
  return {
    key: entry.key,
    kind: entry.kind,
    reach: id ? "ok" : "unreadable",
    boardId: id?.boardId ?? null,
    serial,
    name: id?.boardName ?? null,
    version,
    slot: id ? id.currentSlot : null,
    controllerConnected: !!id?.controllerConnected,
    model: id?.model ?? null,
    colorwayCode: id?.colorwayCode ?? null,
    identifies: supportsIdentify(id),
  };
}

// One read of a board not on screen: open, identity + version, let go.
// Never call it for the board on screen (closing would release its interface).
export async function readSummary(entry: BoardEntry, busy: (cause: unknown) => boolean): Promise<BoardSummary> {
  const transport = entryTransport(entry);
  const serial = transport.serial ?? null;
  try {
    // lifetime: OK — closed in the finally below, whatever the read did
    await transport.open();
    const client = new Ds5BridgeClient(transport);
    const id = await client.identity();
    // error: NOT-WORTH — the row shows no version (older firmware without the report); the rest of the read stands
    const version = await client.readFirmwareVersion().catch(() => null);
    return summaryOf(entry, id, serial, version);
  } catch (cause) {
    // error: SHOWN — desktop.boards.busy / desktop.boards.unreadable on the board's row in the stack
    return { ...summaryOf(entry, null, serial, null), reach: busy(cause) ? "busy" : "unreadable" };
  } finally {
    // Simulated boards stay "open" (one shared object); a real one is let go.
    if (entry.kind === "usb") await transport.close();
  }
}

// Reads every entry, BOARD_READS_AT_ONCE at a time, in entry order.
export async function readSummaries(entries: readonly BoardEntry[], busy: (cause: unknown) => boolean): Promise<BoardSummary[]> {
  const out: BoardSummary[] = new Array<BoardSummary>(entries.length);
  let next = 0;
  const worker = async () => {
    // loop: PARALLELIZE — independent boards (each its own USB device), BOARD_READS_AT_ONCE workers; one session per board stays serial
    while (next < entries.length) {
      const i = next++;
      out[i] = await readSummary(entries[i], busy);
    }
  };
  // loop: NOT-WORTH — N ≤ BOARD_READS_AT_ONCE workers started once per refresh
  await Promise.all(Array.from({ length: Math.min(BOARD_READS_AT_ONCE, entries.length) }, worker));
  return out;
}

// The board to show at start: the last one used (by its id; by its serial
// only when no other board has the same one), else the first.
export function pickBoard(summaries: readonly BoardSummary[], lastId: string | null): number {
  if (summaries.length === 0) return -1;
  if (lastId) {
    // loop: NOT-WORTH — N = boards on USB; once per connect
    const byId = summaries.findIndex((s) => s.boardId === lastId);
    if (byId >= 0) return byId;
    if (lastId.startsWith("serial:")) {
      const serial = lastId.slice(7);
      // loop: NOT-WORTH — N = boards on USB; once per connect
      const same = summaries.filter((s) => !s.boardId && s.serial === serial);
      // loop: NOT-WORTH — N = boards on USB; once per connect
      if (same.length === 1) return summaries.findIndex((s) => s === same[0]);
    }
  }
  return 0;
}

// What the app remembers as "the last board": its id, or its serial on firmware without one.
export const rememberKey = (s: Pick<BoardSummary, "boardId" | "serial">): string | null => s.boardId ?? (s.serial ? `serial:${s.serial}` : null);
export const lastBoardId = (): string | null => readPref(LAST_BOARD_ID_KEY);
export function rememberBoard(s: Pick<BoardSummary, "boardId" | "serial">): void {
  const key = rememberKey(s);
  if (key) writePref(LAST_BOARD_ID_KEY, key);
}

// Whether a bootloader's USB serial is this board: the RP2350 / RP2040 boot
// ROM names itself by the chip's unique id, as 16 hex digits. Taken in either
// byte order (the firmware sends the SDK's bytes; the boot ROM's spelling is
// checked against a real board in QC).
export function serialMatchesBoard(serial: string | null | undefined, boardId: string | null): boolean {
  if (!serial || !boardId) return false;
  const s = serial.toUpperCase();
  if (s === boardId) return true;
  const bytes = boardId.match(/../g);
  return !!bytes && s === bytes.reverse().join("");
}

// Which bootloader a firmware update may write, given the BOOTSEL devices on
// USB now (their serials), the board it rebooted (its id, if known) and the
// BOOTSEL devices that were already there before it rebooted:
//   - the one whose serial is the board's id;
//   - else the one that appeared since the reboot, if exactly one did;
//   - else "wait" (nothing new yet), or "ambiguous" (several new ones, or
//     several there and none of them identifiable): never guess.
export type BootTarget = { pick: number } | "wait" | "ambiguous";
export function chooseBootTarget(serials: readonly string[], boardId: string | null, before: ReadonlySet<string>): BootTarget {
  // loop: NOT-WORTH — N = BOOTSEL devices on USB; one look every 300 ms during an update
  const byId = serials.findIndex((s) => serialMatchesBoard(s, boardId));
  if (byId >= 0) return { pick: byId };
  // loop: NOT-WORTH — N = BOOTSEL devices on USB; one look every 300 ms during an update
  const fresh = serials.map((s, i) => (before.has(s) ? -1 : i)).filter((i) => i >= 0);
  if (fresh.length === 1) return { pick: fresh[0] };
  if (fresh.length > 1) return "ambiguous";
  return "wait";
}

// The row's controller part, for the stack and its tooltip: null without one.
export const hasController = (s: BoardSummary): boolean => s.reach === "ok" && s.controllerConnected;
