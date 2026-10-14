// Launch at login on macOS is applied only when the system's login item
// differs from the setting: unregistering one that was never registered made
// Electron log "Unable to set login item" at every start (macOS smoke test).
import { afterEach, describe, expect, it, vi } from "vitest";

const login = { openAtLogin: false };
const setLoginItemSettings = vi.fn((s: { openAtLogin: boolean }) => (login.openAtLogin = s.openAtLogin));
vi.mock("electron", () => ({ app: { getLoginItemSettings: () => ({ ...login }), setLoginItemSettings } }));

const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });
afterEach(() => {
  onPlatform(realPlatform);
  setLoginItemSettings.mockClear();
  login.openAtLogin = false;
});

describe("applyAutostart on macOS", () => {
  it("leaves an unchanged login item alone (the start-up re-apply)", async () => {
    onPlatform("darwin");
    const { applyAutostart } = await import("../../electron/main/autostart");
    applyAutostart(false, false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
    login.openAtLogin = true;
    applyAutostart(true, true);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("applies a change, both ways", async () => {
    onPlatform("darwin");
    const { applyAutostart } = await import("../../electron/main/autostart");
    applyAutostart(true, false);
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: [] });
    applyAutostart(false, false);
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: [] });
    expect(setLoginItemSettings).toHaveBeenCalledTimes(2);
  });
});

describe("applyAutostart on Windows", () => {
  it("still applies at every start (corrects an older build's entry)", async () => {
    onPlatform("win32");
    const { applyAutostart } = await import("../../electron/main/autostart");
    applyAutostart(false, false);
    expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
    expect(setLoginItemSettings.mock.calls[0]![0]).toMatchObject({ openAtLogin: false, path: expect.any(String) });
  });
});
