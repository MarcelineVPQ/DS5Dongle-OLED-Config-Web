import { describe, expect, it } from "vitest";
import { isAllowedDownloadUrl } from "../../electron/main/urls";
import { Manifest, devNumber, isNewer, parseVersion, sameVersion, shortVersion } from "../../src/update/manifest";

describe("parseVersion", () => {
  it("reads plain, v-prefixed and suffixed versions", () => {
    expect(parseVersion("0.8.0")).toEqual([0, 8, 0]);
    expect(parseVersion("v0.8.0-oled-edition")).toEqual([0, 8, 0]);
    expect(parseVersion("0.7.0-vendor")).toEqual([0, 7, 0]);
    expect(parseVersion(" v1.12.3 ")).toEqual([1, 12, 3]);
  });

  it("refuses anything it doesn't understand", () => {
    for (const bad of ["", "dev", "1.2", "1.2.3.4", "1.x.3", "v", "1..3", null, undefined]) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });
});

describe("isNewer (strict, fail-safe)", () => {
  it("is true only for a strictly higher version", () => {
    expect(isNewer("0.8.0", "0.7.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true); // numeric, not string, comparison
  });

  it("never treats equal or older as newer", () => {
    expect(isNewer("0.8.0", "0.8.0")).toBe(false);
    expect(isNewer("v0.8.0-oled-edition", "0.8.0-vendor")).toBe(false);
    expect(isNewer("0.7.0", "0.8.0")).toBe(false);
  });

  it("does nothing when either side is unreadable", () => {
    expect(isNewer("garbage", "0.1.0")).toBe(false);
    expect(isNewer("9.9.9", "dev")).toBe(false);
  });
});

describe("manifest schema", () => {
  const sha = "a".repeat(64);
  const good = {
    channel: "stable",
    app: { version: "0.2.0", platforms: { linux: { url: "https://github.com/x/y/releases/download/v0.2.0/a.AppImage", size: 10, sha256: sha } } },
    firmware: { version: "v0.8.0-oled-edition", uf2: { url: "https://github.com/x/y/releases/download/v0.8.0/f.uf2", size: 10, sha256: sha } },
  };

  it("accepts a well-formed manifest", () => {
    expect(Manifest.safeParse(good).success).toBe(true);
  });

  it("rejects a missing or malformed checksum (fail closed)", () => {
    const noSha = structuredClone(good) as Record<string, unknown> & typeof good;
    noSha.firmware.uf2.sha256 = "abc";
    expect(Manifest.safeParse(noSha).success).toBe(false);
    const upper = structuredClone(good);
    upper.app.platforms.linux.sha256 = "A".repeat(64);
    expect(Manifest.safeParse(upper).success).toBe(false);
  });
});

describe("download host allowlist", () => {
  it("allows GitHub release hosts over https", () => {
    expect(isAllowedDownloadUrl("https://github.com/MarcelineVPQ/x/releases/download/v1/a.uf2")).toBe(true);
    expect(isAllowedDownloadUrl("https://objects.githubusercontent.com/abc")).toBe(true);
  });

  it("refuses everything else", () => {
    for (const url of [
      "http://github.com/a",
      "https://github.com.evil.example/a",
      "https://evil.example/github.com",
      "https://u:p@github.com/a",
      "https://github.com:8443/a",
      "file:///tmp/a.uf2",
      "nope",
    ]) {
      expect(isAllowedDownloadUrl(url), url).toBe(false);
    }
  });
});

describe("development builds", () => {
  it("reads the development number", () => {
    expect(devNumber("0.9.1-dev.3")).toBe(3);
    expect(devNumber("v0.9.1-dev.12-oled-edition")).toBe(12);
    expect(devNumber("0.9.1")).toBeNull();
    expect(devNumber("v0.9.0-oled-edition")).toBeNull();
  });
  it("orders them before their release", () => {
    expect(isNewer("0.9.1-dev.2", "0.9.1-dev.1")).toBe(true);
    expect(isNewer("0.9.1", "0.9.1-dev.5")).toBe(true);
    expect(isNewer("0.9.1-dev.1", "0.9.0")).toBe(true);
    expect(isNewer("0.9.1-dev.1", "0.9.1")).toBe(false);
    expect(isNewer("0.9.1-dev.1", "0.9.1-dev.1")).toBe(false);
    expect(isNewer("v0.9.1-dev.2-oled-edition", "0.9.1-dev.1")).toBe(true);
  });
  it("tells versions apart by their development number", () => {
    expect(sameVersion("v0.9.1-dev.2-oled-edition", "0.9.1-dev.2")).toBe(true);
    expect(sameVersion("0.9.1-dev.2", "0.9.1")).toBe(false);
    expect(sameVersion("v0.9.0-oled-edition", "0.9.0")).toBe(true);
  });
});

describe("shortVersion", () => {
  it("drops the v and the edition suffix", () => {
    expect(shortVersion("v0.9.2-oled-edition")).toBe("0.9.2");
    expect(shortVersion("v0.9.3-dev.1-oled-edition")).toBe("0.9.3-dev.1");
    expect(shortVersion("0.9.2")).toBe("0.9.2");
    expect(shortVersion(undefined)).toBe("");
  });
});
