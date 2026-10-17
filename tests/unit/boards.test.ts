// @vitest-environment jsdom
// Several boards (hooks/boards.ts): which board to show at start, which
// bootloader a firmware update may write (never a guess, with 1, 2 or 20
// boards), and the stack's rows (AppRail.tsx).
import { describe, expect, it } from "vitest";
import { type BoardSummary, chooseBootTarget, pickBoard, rememberKey, serialMatchesBoard } from "../../src/hooks/boards";
import { BOARD_ROWS, boardMatches, shownBoards } from "../../src/desktop/AppRail";
import { sameBoard } from "../../src/desktop/live/slotSettings";
import { Ds5BridgeClient } from "../../src/protocol/bridgeClient";
import { SimulatedDongle } from "../../src/protocol/simulatedDongle";

const id = (n: number) => `E66141030000${n.toString(16).padStart(4, "0")}`.toUpperCase();
const board = (n: number, over: Partial<BoardSummary> = {}): BoardSummary => ({
  key: `usb-${n}`,
  kind: "usb",
  reach: "ok",
  boardId: id(n),
  serial: "143A9AFFD9F9", // every board paired to the same DualSense: the same serial
  name: "Pico 2 W",
  version: "v0.9.5-dev.19-oled-edition",
  slot: 0,
  controllerConnected: true,
  model: "dualsense",
  colorwayCode: "00",
  identifies: true,
  ...over,
});

describe("the board to show at start", () => {
  it("is the last one used, found by its board id even with the same serial", () => {
    const boards = [board(1), board(2), board(3)];
    expect(pickBoard(boards, id(2))).toBe(1);
    expect(pickBoard(boards, id(3))).toBe(2);
  });
  it("is the first when the last one isn't there (or none was remembered)", () => {
    expect(pickBoard([board(1), board(2)], id(9))).toBe(0);
    expect(pickBoard([board(1), board(2)], null)).toBe(0);
    expect(pickBoard([], id(1))).toBe(-1);
  });
  it("older firmware (no id): by its serial, only when no other board has the same one", () => {
    const old = (n: number, serial: string) => board(n, { boardId: null, serial });
    expect(pickBoard([old(1, "AAA"), old(2, "BBB")], "serial:BBB")).toBe(1);
    expect(pickBoard([old(1, "AAA"), old(2, "AAA")], "serial:AAA")).toBe(0); // ambiguous: the first, not a guess between them
    expect(rememberKey({ boardId: null, serial: "AAA" })).toBe("serial:AAA");
    expect(rememberKey({ boardId: id(1), serial: "AAA" })).toBe(id(1));
  });
  it("works the same with 20 boards", () => {
    const boards = Array.from({ length: 20 }, (_, i) => board(i + 1));
    expect(pickBoard(boards, id(17))).toBe(16);
  });
});

describe("the bootloader a firmware update writes", () => {
  it("one board: the one that appeared after its reboot", () => {
    expect(chooseBootTarget(["0011223344556677"], id(1), new Set())).toEqual({ pick: 0 });
  });
  it("the one whose USB serial is the board's id, in either byte order, whatever else is in BOOTSEL", () => {
    const target = id(5);
    const reversed = target.match(/../g)!.reverse().join("");
    const others = Array.from({ length: 19 }, (_, i) => id(100 + i));
    expect(chooseBootTarget([...others, target], target, new Set(others))).toEqual({ pick: 19 });
    expect(chooseBootTarget([target, ...others], target, new Set())).toEqual({ pick: 0 }); // 20 new ones, but this one is identified
    expect(chooseBootTarget([...others.slice(0, 3), reversed], target, new Set())).toEqual({ pick: 3 });
    expect(serialMatchesBoard(target.toLowerCase(), target)).toBe(true);
    expect(serialMatchesBoard(target, null)).toBe(false);
  });
  it("a board already in BOOTSEL before is never taken for the rebooted one", () => {
    const before = new Set(["AAAA000000000001"]);
    expect(chooseBootTarget(["AAAA000000000001"], id(1), before)).toBe("wait"); // ours isn't there yet
    expect(chooseBootTarget(["AAAA000000000001", "BBBB000000000002"], id(1), before)).toEqual({ pick: 1 }); // the one that appeared
  });
  it("several new ones and none identifiable: ambiguous, nothing is written", () => {
    expect(chooseBootTarget(["AAAA000000000001", "BBBB000000000002"], id(1), new Set())).toBe("ambiguous");
    expect(chooseBootTarget(["AAAA000000000001", "BBBB000000000002"], null, new Set())).toBe("ambiguous");
    const twenty = Array.from({ length: 20 }, (_, i) => id(200 + i));
    expect(chooseBootTarget(twenty, id(1), new Set())).toBe("ambiguous");
    expect(chooseBootTarget(twenty, id(1), new Set(twenty))).toBe("wait");
  });
  it("nothing yet: wait", () => {
    expect(chooseBootTarget([], id(1), new Set())).toBe("wait");
  });
});

describe("the rail's board stack", () => {
  it("shows at most BOARD_ROWS rows, the board in use always among them", () => {
    const boards = Array.from({ length: 20 }, (_, i) => board(i + 1));
    expect(shownBoards(boards, "usb-1").map((b) => b.key)).toEqual(["usb-1", "usb-2", "usb-3"]);
    const shown = shownBoards(boards, "usb-17");
    expect(shown).toHaveLength(BOARD_ROWS);
    expect(shown.map((b) => b.key)).toContain("usb-17");
    expect(shownBoards(boards.slice(0, 2), "usb-2")).toHaveLength(2);
  });
  it("its search finds a board by name, controller, slot, version or id", () => {
    const b = board(13, { slot: 2, model: "edge" });
    const lines = { name: "Pico 2 W", version: b.version!, detail: "DualSense Edge · Slot 2" };
    expect(boardMatches(lines, b, "edge")).toBe(true);
    expect(boardMatches(lines, b, "slot 2")).toBe(true);
    expect(boardMatches(lines, b, id(13).slice(-4).toLowerCase())).toBe(true);
    expect(boardMatches(lines, b, "dev.19")).toBe(true);
    expect(boardMatches(lines, b, "zzz")).toBe(false);
    expect(boardMatches(lines, b, "  ")).toBe(true);
  });
});

describe("the same board (staged drafts kept across a reconnect)", () => {
  const client = async (opts: { boardId?: string; serial: string; protoMinor?: number }) => {
    const c = new Ds5BridgeClient(new SimulatedDongle({ protoMinor: opts.protoMinor ?? 20, boardId: opts.boardId, serial: opts.serial }));
    await c.transport.open();
    await c.identity();
    return c;
  };
  it("is told by the board id, not the serial (two boards paired to one DualSense share it)", async () => {
    const a = await client({ boardId: id(1), serial: "143A9AFFD9F9" });
    const b = await client({ boardId: id(2), serial: "143A9AFFD9F9" });
    const a2 = await client({ boardId: id(1), serial: "OTHERMAC0000" }); // same board, another controller paired
    expect(sameBoard(a, b)).toBe(false);
    expect(sameBoard(a, a2)).toBe(true);
    expect(a.boardId).toBe(id(1));
  });
  it("older firmware (no id): by the serial, as before", async () => {
    const a = await client({ serial: "AAA", protoMinor: 19 });
    const b = await client({ serial: "AAA", protoMinor: 19 });
    const c = await client({ serial: "BBB", protoMinor: 19 });
    expect(a.boardId).toBeNull();
    expect(sameBoard(a, b)).toBe(true);
    expect(sameBoard(a, c)).toBe(false);
  });
});

describe("identify (protocol 1.20)", () => {
  it("sends 0xF6 0x1A [tenths]; firmware before 1.20 refuses it with the keyed message", async () => {
    const sim = new SimulatedDongle({ protoMinor: 20 });
    const c = new Ds5BridgeClient(sim);
    await sim.open();
    await c.identity();
    expect(c.identifies).toBe(true);
    await c.identify();
    await c.identify(0);
    expect(sim.identifies).toEqual([30, 0]);
    const old = new Ds5BridgeClient(new SimulatedDongle({ protoMinor: 19 }));
    await old.transport.open();
    await old.identity();
    expect(old.identifies).toBe(false);
    await expect(old.identify()).rejects.toMatchObject({ key: "desktop.errors.board.noIdentify" });
  });
});
