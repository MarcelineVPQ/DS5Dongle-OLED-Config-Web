import { describe, expect, it, vi } from "vitest";
import { FirmwareHold } from "../../electron/main/firmwareHold";

const quitEvent = () => ({ preventDefault: vi.fn() });

describe("FirmwareHold (no restart or quit mid-write)", () => {
  it("runs a restart right away when nothing is being written", () => {
    const hold = new FirmwareHold(() => undefined);
    const restart = vi.fn();
    expect(hold.whenDone("restart", restart)).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("holds a restart requested mid-write and fires it once the write ends", () => {
    const states: unknown[] = [];
    const hold = new FirmwareHold((s) => states.push(s));
    const restart = vi.fn();
    hold.setWriting(true);
    expect(hold.whenDone("restart", restart)).toBe(false);
    hold.whenDone("restart", restart); // asked twice: still one restart
    expect(restart).not.toHaveBeenCalled();
    expect(hold.state()).toEqual({ writing: true, restartQueued: true, quitQueued: false });
    hold.setWriting(false);
    expect(restart).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ writing: false, restartQueued: false, quitQueued: false });
    hold.setWriting(true);
    hold.setWriting(false);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("prevents before-quit while writing and quits after; allows it when idle", () => {
    const hold = new FirmwareHold(() => undefined);
    const quit = vi.fn();
    const idle = quitEvent();
    expect(hold.allowQuit(idle, quit)).toBe(true);
    expect(idle.preventDefault).not.toHaveBeenCalled();

    hold.setWriting(true);
    const mid = quitEvent();
    expect(hold.allowQuit(mid, quit)).toBe(false);
    expect(mid.preventDefault).toHaveBeenCalledOnce();
    expect(hold.state().quitQueued).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    hold.setWriting(false);
    expect(quit).toHaveBeenCalledOnce();
    // The quit it fires goes through before-quit again, now allowed.
    const after = quitEvent();
    expect(hold.allowQuit(after, quit)).toBe(true);
    expect(after.preventDefault).not.toHaveBeenCalled();
  });

  it("installs the held app update before restarting, and quits last", () => {
    const hold = new FirmwareHold(() => undefined);
    const order: string[] = [];
    hold.setWriting(true);
    hold.allowQuit(quitEvent(), () => order.push("quit"));
    hold.whenDone("restart", () => order.push("restart"));
    hold.whenDone("install", () => order.push("install"));
    hold.setWriting(false);
    expect(order).toEqual(["install", "restart", "quit"]);
  });
});
