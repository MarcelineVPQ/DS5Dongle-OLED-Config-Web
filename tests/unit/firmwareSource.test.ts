import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { choose, firmwareBytes, latestFirmware, readBundled, type FirmwareSourceDeps } from "../../electron/main/firmwareSource";
import { Manifest } from "../../src/update/manifest";

let res: string;
const uf2 = new Uint8Array([1, 2, 3, 4]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function bundle(version: string, hash = sha(uf2)) {
  mkdirSync(join(res, "firmware"), { recursive: true });
  writeFileSync(join(res, "firmware/ds5-bridge-oled.uf2"), uf2);
  writeFileSync(join(res, "firmware/firmware.json"), JSON.stringify({ version, file: "ds5-bridge-oled.uf2", sha256: hash }));
}

const published = (version: string) => ({ version, notes_url: "https://github.com/x", uf2: { url: "https://github.com/x/fw.uf2", size: 4, sha256: "0".repeat(64) } });
const deps = (pub: ReturnType<typeof published> | null): FirmwareSourceDeps => ({
  bundled: () => readBundled(res),
  manifest: async () =>
    pub ? { manifest: Manifest.parse({ channel: "stable", app: { version: "0.8.0", platforms: {} }, firmware: pub }), problem: null } : { manifest: null, problem: "offline" as const },
  downloadPublished: async () => ({ version: pub!.version, bytes: new Uint8Array([9]) }),
});

beforeEach(() => {
  res = mkdtempSync(join(tmpdir(), "ds5-fw-"));
});
afterEach(() => rmSync(res, { recursive: true, force: true }));

describe("firmware source", () => {
  it("uses the bundled firmware offline, and when the published one isn't newer", async () => {
    bundle("v0.8.0-oled-edition");
    expect(await latestFirmware(deps(null))).toEqual({ latest: { version: "v0.8.0-oled-edition", source: "bundled" }, problem: "offline" });
    expect((await firmwareBytes(deps(published("v0.8.0-oled-edition")))).bytes).toEqual(uf2);
    expect(choose(readBundled(res), published("v0.7.0-oled-edition"))).toBe("bundled");
  });

  it("prefers a strictly newer published firmware", async () => {
    bundle("v0.8.0-oled-edition");
    expect((await latestFirmware(deps(published("v0.8.1-oled-edition")))).latest?.source).toBe("online");
    expect((await firmwareBytes(deps(published("v0.8.1-oled-edition")))).bytes).toEqual(new Uint8Array([9]));
  });

  it("falls back to the feed when nothing is bundled (builds from source)", async () => {
    expect(readBundled(res)).toBeNull();
    expect((await latestFirmware(deps(published("v0.8.0-oled-edition")))).latest?.source).toBe("online");
    await expect(firmwareBytes(deps(null))).rejects.toThrow(/No firmware is available/);
  });

  it("refuses a damaged bundled file", async () => {
    bundle("v0.8.0-oled-edition", "f".repeat(64));
    await expect(firmwareBytes(deps(null))).rejects.toThrow(/damaged/);
  });

  it("ignores a malformed bundle description", () => {
    mkdirSync(join(res, "firmware"), { recursive: true });
    writeFileSync(join(res, "firmware/firmware.json"), JSON.stringify({ version: "x", file: "../../etc/passwd", sha256: "a".repeat(64) }));
    expect(readBundled(res)).toBeNull();
  });
});
