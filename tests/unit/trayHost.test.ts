// 2026-10-31 app review S6: on GNOME without a StatusNotifier host the tray
// is missing (closing quits, never starts hidden); elsewhere, or when gdbus
// can't be asked, the tray is assumed (the behaviour before).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closeHides, saysNoOwner, showsAfterTrayCheck, trayHostMissing } from "../../electron/main/trayHost";

const mainSource = readFileSync(new URL("../../electron/main/index.ts", import.meta.url), "utf8");

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

  // 2026-11-01 re-review S3: what the user gets on GNOME without a tray.
  it("with no tray, closing the window quits (close to tray or not)", () => {
    expect(closeHides(true, true, false)).toBe(false);
    expect(closeHides(false, true, false)).toBe(false);
    // With a tray, Close to tray hides it until the app is quitting.
    expect(closeHides(true, false, false)).toBe(true);
    expect(closeHides(true, false, true)).toBe(false);
    expect(closeHides(false, false, false)).toBe(false);
    expect(mainSource).toContain("if (closeHides(settings.closeToTray, trayMissing, quitting)) {");
  });

  it("with no tray, a start-hidden launch shows the window", () => {
    expect(showsAfterTrayCheck(true, true)).toBe(true);
    expect(showsAfterTrayCheck(true, false)).toBe(false); // already shown
    expect(showsAfterTrayCheck(false, true)).toBe(false); // the tray brings it back
    expect(mainSource).toContain("if (showsAfterTrayCheck(missing, startHidden)) showWindow();");
  });
});
