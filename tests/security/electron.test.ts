// Security regression tests for the desktop app. The allowlists are tested
// directly; the window/session baseline is checked in the source so a change
// to it has to come with a change here (and a SECURITY_AUDIT.md note).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAllowedUsbDevice } from "../../electron/main/devices";
import { isAllowedExternalUrl } from "../../electron/main/urls";

const mainSource = readFileSync(new URL("../../electron/main/index.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload/index.ts", import.meta.url), "utf8");
const viteSource = readFileSync(new URL("../../electron.vite.config.ts", import.meta.url), "utf8");

describe("USB device allowlist", () => {
  it("allows the dongle (DS5 and Edge mode) and the RP2350 boot device", () => {
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x0ce6 })).toBe(true);
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x0df2 })).toBe(true);
    expect(isAllowedUsbDevice({ vendorId: 0x2e8a, productId: 0x000f })).toBe(true);
  });

  it("denies everything else, including other Sony and Raspberry Pi devices", () => {
    expect(isAllowedUsbDevice({ vendorId: 0x054c, productId: 0x09cc })).toBe(false);
    expect(isAllowedUsbDevice({ vendorId: 0x2e8a, productId: 0x0003 })).toBe(false);
    expect(isAllowedUsbDevice({ vendorId: 0x046d, productId: 0xc52b })).toBe(false);
    expect(isAllowedUsbDevice(undefined)).toBe(false);
    expect(isAllowedUsbDevice({})).toBe(false);
  });
});

describe("external URL allowlist", () => {
  it("allows https GitHub and the project site", () => {
    expect(isAllowedExternalUrl("https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition")).toBe(true);
    expect(isAllowedExternalUrl("https://marcelinevpq.github.io/DS5Dongle-OLED-Config-Web/")).toBe(true);
  });

  it("refuses other schemes, hosts, look-alikes and embedded credentials", () => {
    for (const url of [
      "http://github.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://github.com.evil.example/",
      "https://evil.example/github.com",
      "https://user:pass@github.com/",
      "not a url",
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });
});

describe("window and session baseline", () => {
  it("keeps the renderer isolated and sandboxed", () => {
    expect(mainSource).toMatch(/contextIsolation:\s*true/);
    expect(mainSource).toMatch(/sandbox:\s*true/);
    expect(mainSource).toMatch(/nodeIntegration:\s*false/);
    expect(mainSource).toMatch(/webSecurity:\s*true/);
  });

  it("denies every web permission request and only checks usb", () => {
    expect(mainSource).toMatch(/setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/);
    expect(mainSource).toMatch(/permission === "usb" && isAppOrigin/);
    expect(mainSource).toMatch(/setDevicePermissionHandler/);
  });

  it("blocks new windows and off-app navigation", () => {
    expect(mainSource).toMatch(/return \{ action: "deny" \}/);
    expect(mainSource).toMatch(/will-navigate/);
  });

  it("never hands ipcRenderer to the page", () => {
    const code = preloadSource.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/ipcRenderer/);
  });

  it("ships a CSP without eval or remote origins", () => {
    const csp = viteSource.slice(viteSource.indexOf("const CSP"), viteSource.indexOf('].join("; ")'));
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:/);
  });
});
