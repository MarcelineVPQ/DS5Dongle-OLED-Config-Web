// "Set up USB access" is one action for both uses (IA audit Q4): the one
// rule file gives this app the board and its boot device (WebUSB) and games
// the controller's hidraw node; the setup reloads both subsystems.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rule = readFileSync(new URL("../../resources/linux/70-ds5-dongle.rules", import.meta.url), "utf8");
const lines = rule.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

describe("the USB access rule", () => {
  it("covers the app's WebUSB (the board in both modes, the RP2350 boot device)", () => {
    for (const pid of ["0ce6", "0df2"]) expect(lines).toContain(`SUBSYSTEM=="usb", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="${pid}", TAG+="uaccess"`);
    expect(lines.some((l) => l.includes('ATTRS{idVendor}=="2e8a"') && l.includes('ATTRS{idProduct}=="000f"'))).toBe(true);
  });

  it("covers the games' hidraw path (DualSense and Edge)", () => {
    for (const pid of ["0ce6", "0df2"]) expect(lines).toContain(`KERNEL=="hidraw*", ATTRS{idVendor}=="054c", ATTRS{idProduct}=="${pid}", TAG+="uaccess"`);
  });

  it("the setup reloads the usb and hidraw devices", () => {
    const setup = readFileSync(new URL("../../electron/main/linuxSetup.ts", import.meta.url), "utf8");
    expect(setup).toContain("udevadm trigger --subsystem-match=usb --subsystem-match=hidraw");
  });
});
