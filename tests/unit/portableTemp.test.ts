// Windows portable exe: which leftover folders in Temp the app removes on start.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEFTOVER_MIN_AGE_MS, findLeftovers, pruneUnpackLeftovers } from "../../electron/main/portableTemp";

const EXE = "DS5 Dongle OLED Edition Configurator.exe";
const OWN = "3KgzTJvivbEvEDytYNRMYP50llq";
const NOW = Date.now();
const OLD = (NOW - LEFTOVER_MIN_AGE_MS - 60_000) / 1000;

let temp: string;
const file = (...parts: string[]) => {
  mkdirSync(join(temp, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(temp, ...parts), "x");
};
const age = (...parts: string[]) => utimesSync(join(temp, ...parts), OLD, OLD);
// An unpacked copy of the app, and the launcher's NSIS folder holding one.
const unpack = (name: string) => {
  file(name, EXE);
  file(name, "resources", "app.asar");
};
const nsis = (name: string) => {
  file(name, "app-64.7z");
  file(name, "7z-out", EXE);
};

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "ds5-portable-temp-"));
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe("portable leftovers in Temp", () => {
  it("finds old unpacked copies and NSIS folders of this app, not the running copy", () => {
    unpack(OWN);
    unpack("3KfewjYWfn6W58O8fai27u0RDUN");
    nsis("nsa4FED.tmp");
    for (const dir of [OWN, "3KfewjYWfn6W58O8fai27u0RDUN", "nsa4FED.tmp", "nsa4FED.tmp/7z-out"]) age(dir);
    expect(findLeftovers(temp, join(temp, OWN), EXE, NOW).sort()).toEqual([join(temp, "3KfewjYWfn6W58O8fai27u0RDUN"), join(temp, "nsa4FED.tmp")]);
  });

  it("leaves other apps' folders and anything touched in the last minutes alone", () => {
    file("nsb1234.tmp", "app-64.7z"); // another installer's NSIS folder (no copy of this app)
    file("nsc1234.tmp", "7z-out", "Other App.exe");
    file("0123456789abcdefghijABCDEFG", "other.exe"); // a 27-character folder that isn't ours
    file("Some Folder", EXE); // not a launcher's folder name
    nsis("nsd1234.tmp"); // a second start unpacking right now
    unpack("3KhhhhhhhhhhhhhhhhhhhhhhhhH"); // fresh too
    for (const dir of ["nsb1234.tmp", "nsc1234.tmp", "nsc1234.tmp/7z-out", "0123456789abcdefghijABCDEFG", "Some Folder"]) age(dir);
    expect(findLeftovers(temp, join(temp, OWN), EXE, NOW)).toEqual([]);
  });

  it("removes them, and only them", async () => {
    unpack(OWN);
    unpack("3KfewjYWfn6W58O8fai27u0RDUN");
    nsis("nsa4FED.tmp");
    file("nsb1234.tmp", "app-64.7z");
    for (const dir of [OWN, "3KfewjYWfn6W58O8fai27u0RDUN", "nsa4FED.tmp", "nsa4FED.tmp/7z-out", "nsb1234.tmp"]) age(dir);
    const removed = await pruneUnpackLeftovers(join(temp, OWN, EXE), NOW);
    expect(removed.length).toBe(2);
    expect(existsSync(join(temp, "3KfewjYWfn6W58O8fai27u0RDUN"))).toBe(false);
    expect(existsSync(join(temp, "nsa4FED.tmp"))).toBe(false);
    expect(existsSync(join(temp, OWN, EXE))).toBe(true);
    expect(existsSync(join(temp, "nsb1234.tmp"))).toBe(true);
  });

  it("finds nothing when Temp can't be read", () => {
    expect(findLeftovers(join(temp, "missing"), join(temp, OWN), EXE, NOW)).toEqual([]);
  });
});
