import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareOfficial, isComparableVersion, parseOfficialInfo } from "../../src/protocol/officialFirmware";
import { OFFICIAL_FIRMWARE_MAX_BYTES, OfficialFirmwareSource, fetchOfficialFirmware } from "../../electron/main/officialFirmware";

// Sony's answer as fetched on 2026-10-12, byte for byte.
const SONY = readFileSync(new URL("../fixtures/sony/info-2026-10.json", import.meta.url), "utf8");
const latest = parseOfficialInfo(JSON.parse(SONY))!;

describe("Sony's info.json", () => {
  it("parses the real answer into versions per firmware line", () => {
    expect(latest).toEqual({ "0004": 0x0630, "000B": 0x0630, "000E": 0x0641, "0044": 0x0217 });
  });

  it("ignores keys it doesn't know and lines it doesn't use", () => {
    expect(parseOfficialInfo({ ApplicationLatestVersion: "9.9", Other: 1, FwUpdate0044LatestVersion: "0x0300", FwUpdate0099LatestVersion: "0x0101" })).toEqual({ "0044": 0x0300, "0099": 0x0101 });
  });

  it("refuses malformed answers", () => {
    for (const bad of [
      null,
      "0x0630",
      [],
      [{ FwUpdate0004LatestVersion: "0x0630" }],
      {},
      { ApplicationLatestVersion: "2.2.1.2" }, // no controller line
      { FwUpdate0004LatestVersion: 0x0630 }, // a number, not Sony's string
      { FwUpdate0004LatestVersion: "6.30" },
      { FwUpdate0004LatestVersion: "0x630" },
      { FwUpdate0004LatestVersion: "0x0630", FwUpdate0044LatestVersion: "latest" }, // one unreadable line spoils it
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 1])),
    ]) {
      expect(parseOfficialInfo(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    }
  });
});

describe("comparing the controller with Sony's latest", () => {
  it("a DualSense on 6.30 is up to date (000E, which started at 6.33, can't be its line)", () => {
    expect(compareOfficial(0x0630, false, latest)).toEqual({ status: "current" });
  });

  it("an older DualSense gets the newer version", () => {
    expect(compareOfficial(0x0620, false, latest)).toEqual({ status: "newer", version: 0x0630 });
    expect(compareOfficial(0x0452, false, latest)).toEqual({ status: "newer", version: 0x0630 });
  });

  it("the newer hardware line (000E) is compared with its own latest", () => {
    expect(compareOfficial(0x0633, false, latest)).toEqual({ status: "newer", version: 0x0641 });
    expect(compareOfficial(0x0641, false, latest)).toEqual({ status: "current" });
  });

  it("the Edge is compared with the Edge's line only", () => {
    expect(compareOfficial(0x0217, true, latest)).toEqual({ status: "current" });
    expect(compareOfficial(0x0215, true, latest)).toEqual({ status: "newer", version: 0x0217 });
    // Above the Edge's latest though below the DualSense's: not a guess at "older".
    expect(compareOfficial(0x0300, true, latest)).toBeNull();
  });

  it("says nothing for a version newer than anything Sony lists", () => {
    expect(compareOfficial(0x0700, false, latest)).toBeNull();
    expect(compareOfficial(0x0642, false, latest)).toBeNull();
  });

  it("says nothing when the possible lines disagree", () => {
    // 6.35 could be 000E (latest 6.41) or a 0004/000B build Sony since replaced: unknowable here.
    const split = { "0004": 0x0640, "000B": 0x0630, "000E": 0x0641 };
    expect(compareOfficial(0x0635, false, split)).toBeNull();
    expect(compareOfficial(0x0620, false, split)).toBeNull();
  });

  it("says nothing for a model Sony's answer doesn't cover", () => {
    expect(compareOfficial(0x0200, true, { "0004": 0x0630 })).toBeNull();
  });

  it("says nothing for versions that aren't in Sony's format", () => {
    for (const v of [0, 0xffff, 0x10000, -1, 0x06a0, 0x063f, 0x0030, 1.5]) {
      expect(isComparableVersion(v), String(v)).toBe(false);
      expect(compareOfficial(v, false, latest)).toBeNull();
    }
    expect(isComparableVersion(0x0176)).toBe(true); // an Edge's 1.76
  });
});

const json = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("fetching Sony's info.json (main process)", () => {
  it("is a plain GET to Sony's host: no redirects, no credentials, a timeout", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await fetchOfficialFirmware(async (url, init) => {
      calls.push({ url, init });
      return json(SONY);
    });
    expect(result).toEqual(latest);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://fwupdater.dl.playstation.net/fwupdater/info.json");
    expect(calls[0].init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toBeUndefined();
  });

  it("refuses other hosts and schemes without fetching", async () => {
    let fetched = false;
    const spy = async () => {
      fetched = true;
      return json(SONY);
    };
    for (const url of [
      "http://fwupdater.dl.playstation.net/fwupdater/info.json",
      "https://evil.example/fwupdater/info.json",
      "https://fwupdater.dl.playstation.net.evil.example/info.json",
      "https://user@fwupdater.dl.playstation.net/info.json",
      "https://fwupdater.dl.playstation.net:8443/info.json",
    ]) {
      await expect(fetchOfficialFirmware(spy, url), url).rejects.toThrow("host not allowed");
    }
    expect(fetched).toBe(false);
  });

  it("refuses errors, oversized and unexpected answers", async () => {
    await expect(fetchOfficialFirmware(async () => json("nope", { status: 404 }))).rejects.toThrow("HTTP 404");
    const big = `{"FwUpdate0004LatestVersion":"0x0630","pad":"${"x".repeat(OFFICIAL_FIRMWARE_MAX_BYTES)}"}`;
    await expect(fetchOfficialFirmware(async () => json(big))).rejects.toThrow("too large");
    // A lying content-length is caught while reading.
    await expect(fetchOfficialFirmware(async () => json(big, { headers: { "content-length": "10" } }))).rejects.toThrow("too large");
    await expect(fetchOfficialFirmware(async () => json("<html>"))).rejects.toThrow();
    await expect(fetchOfficialFirmware(async () => json('{"FwUpdate0004LatestVersion":"soon"}'))).rejects.toThrow("unexpected answer");
  });
});

describe("the cached source", () => {
  function setup(auto: boolean) {
    let now = 1_000_000;
    let fetches = 0;
    let answer: () => Response = () => json(SONY);
    const source = new OfficialFirmwareSource(
      async () => {
        fetches++;
        return answer();
      },
      () => auto,
      () => now,
    );
    return {
      source,
      fetches: () => fetches,
      advance: (ms: number) => (now += ms),
      fail: () => (answer = () => json("", { status: 503 })),
    };
  }

  it("never touches the network with automatic checks off, unless asked", async () => {
    const s = setup(false);
    expect(await s.source.lookup(false)).toEqual({ latest: null, problem: "disabled" });
    expect(s.fetches()).toBe(0);
    expect(await s.source.lookup(true)).toEqual({ latest, problem: null });
    expect(s.fetches()).toBe(1);
  });

  it("caches for a day; Refresh refetches, but not more than once a minute", async () => {
    const s = setup(true);
    await s.source.lookup(false);
    s.advance(23 * 3600_000);
    await s.source.lookup(false);
    expect(s.fetches()).toBe(1);
    await s.source.lookup(true);
    expect(s.fetches()).toBe(2);
    s.advance(30_000);
    await s.source.lookup(true);
    expect(s.fetches()).toBe(2);
    s.advance(25 * 3600_000);
    await s.source.lookup(false);
    expect(s.fetches()).toBe(3);
  });

  it("shares one request between callers", async () => {
    const s = setup(true);
    await Promise.all([s.source.lookup(false), s.source.lookup(false), s.source.lookup(true)]);
    expect(s.fetches()).toBe(1);
  });

  it("offline: the last good answer, or nothing", async () => {
    const s = setup(true);
    s.fail();
    expect(await s.source.lookup(false)).toEqual({ latest: null, problem: "unavailable" });
    const t = setup(true);
    await t.source.lookup(false);
    t.fail();
    t.advance(2 * 24 * 3600_000);
    expect(await t.source.lookup(false)).toEqual({ latest, problem: null });
  });
});
