// 2026-10-31 app review S6: on GNOME without a StatusNotifier host the tray
// is missing (closing quits, never starts hidden); elsewhere, or when gdbus
// can't be asked, the tray is assumed (the behaviour before).
import { describe, expect, it } from "vitest";
import { saysNoOwner, trayHostMissing } from "../../electron/main/trayHost";

describe("tray host check", () => {
  it("reads gdbus's NameHasOwner answer", () => {
    expect(saysNoOwner("(false,)\n")).toBe(true);
    expect(saysNoOwner("(true,)\n")).toBe(false);
    expect(saysNoOwner("")).toBe(false);
  });

  it("asks only on GNOME", async () => {
    await expect(trayHostMissing("KDE")).resolves.toBe(false);
    await expect(trayHostMissing("XFCE")).resolves.toBe(false);
  });
});
