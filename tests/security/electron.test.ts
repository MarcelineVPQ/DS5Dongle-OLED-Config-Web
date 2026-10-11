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
    expect(isAllowedExternalUrl("https://42pixelstudios.com/")).toBe(true);
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

  it("denies every web permission request and only checks usb (and audio device names)", () => {
    expect(mainSource).toMatch(/setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/);
    expect(mainSource).toMatch(
      /isAppOrigin\(requestingOrigin\) &&\s*\(permission === "usb" \|\| \(permission as string\) === "speaker-selection" \|\| \(permission === "media" && \(details as \{ mediaType\?: string \}\)\.mediaType === "audio"\)\)/,
    );
    expect(mainSource).toMatch(/setDevicePermissionHandler/);
  });

  it("blocks new windows and off-app navigation", () => {
    expect(mainSource).toMatch(/return \{ action: "deny" \}/);
    expect(mainSource).toMatch(/will-navigate/);
  });

  it("never hands ipcRenderer to the page, only fixed channel functions", () => {
    const code = preloadSource.replace(/\/\/.*$/gm, "").replace(/^import .*$/gm, "");
    expect(code).toMatch(/contextBridge\.exposeInMainWorld\("desktop", api\)/);
    // ipcRenderer may be used inside the wrapper functions, but never placed on
    // the exposed object or passed to the bridge.
    expect(code).not.toMatch(/[{,]\s*ipcRenderer\s*[,}:]/);
    expect(code).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer/);
    // Every channel comes from the IPC constant table, no ad-hoc strings.
    for (const call of code.match(/ipcRenderer\.(send|invoke|on|removeListener)\(([^,)]+)/g) ?? []) {
      expect(call, call).toMatch(/\(IPC\./);
    }
  });

  it("ships a CSP without eval or remote origins", () => {
    const csp = viteSource.slice(viteSource.indexOf("const CSP"), viteSource.indexOf('].join("; ")'));
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe("IPC payload validation", async () => {
  // Loaded lazily: the module imports electron, which only exists at runtime.
  const { z } = await import("zod");
  const DeviceStatus = z.strictObject({ dongle: z.boolean(), controller: z.boolean(), slot: z.number().int().min(-1).max(3), firmware: z.string().max(64).nullable() });
  const ipcSource = readFileSync(new URL("../../electron/main/ipc.ts", import.meta.url), "utf8");

  it("validates every renderer message and checks the sender", () => {
    expect(ipcSource).toMatch(/DeviceStatusSchema\.safeParse\(raw\)/);
    expect(ipcSource).toMatch(/SettingUpdate\.parse\(raw\)/);
    expect((ipcSource.match(/trusted\(event\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the status schema rejects extra keys and out-of-range slots", () => {
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 2, firmware: "0.8.0" }).success).toBe(true);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 9, firmware: null }).success).toBe(false);
    expect(DeviceStatus.safeParse({ dongle: true, controller: true, slot: 0, firmware: null, extra: 1 }).success).toBe(false);
  });
});

describe("trusted page", () => {
  const mainSource = readFileSync(new URL("../../electron/main/index.ts", import.meta.url), "utf8");

  it("trusts only the exact packaged page, not any file under a renderer/ folder", () => {
    expect(mainSource).toMatch(/pagePath\(parsed\.pathname\) === APP_PAGE/);
    expect(mainSource).not.toMatch(/includes\("\/renderer\/"\)/);
    expect(mainSource).not.toMatch(/url\.startsWith\(devServerUrl\)/);
  });
});

describe("privileged Linux setup", () => {
  const setupSource = readFileSync(new URL("../../electron/main/linuxSetup.ts", import.meta.url), "utf8");

  it("runs pkexec through execFile with a fixed script and positional paths", () => {
    expect(setupSource).toMatch(/execFile\("pkexec", \["\/bin\/sh", "-c", script, "ds5-setup", source, RULE_DEST\]/);
    expect(setupSource).toMatch(/const script = 'command -v udevadm >\/dev\/null \|\| exit 3; install -m 0644 "\$1" "\$2"/);
    expect(setupSource).not.toMatch(/\bexec\(/);
    expect(setupSource).not.toMatch(/script\s*=\s*`/);
  });
});
