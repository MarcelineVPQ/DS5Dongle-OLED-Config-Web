// One version ordering (src/update/versionOrder.mjs) for the installed updater
// (src/update/manifest.ts isNewer), the release gate (tools/doc_gates.mjs) and,
// held to the same table here, the firmware repo's feed builder
// (tools/manifest_lib.mjs versionKey; read when DS5_FIRMWARE_REPO names its
// checkout, as in CI).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { compareVersions } from "../../src/update/versionOrder.mjs";
import { isNewer } from "../../src/update/manifest";
// @ts-expect-error -- a plain ESM tool script without types
import * as gates from "../../tools/doc_gates.mjs";

// The release formats both repos write, oldest first: X.Y.Z-dev.N before X.Y.Z.
const ORDER = ["0.7.0", "0.9.4", "0.9.5-dev.1", "0.9.5-dev.2", "0.9.5-dev.10", "0.9.5-dev.20", "0.9.5", "0.9.6-dev.1", "0.10.0", "1.0.0-dev.1", "1.0.0", "1.2.0", "10.0.0"];
const sign = (n: number) => Math.sign(n);

describe("the version ordering", () => {
  it("orders the release formats: dev builds before their release, numbers not text", () => {
    ORDER.forEach((a, i) => ORDER.forEach((b, j) => expect(compareVersions(a, b), `${a} vs ${b}`).toBe(sign(i - j) || 0)));
  });

  it("the updater reads tags and labels the same way, and never guesses", () => {
    expect(compareVersions("v0.9.5-dev.3-oled-edition", "0.9.5-dev.3")).toBe(0);
    expect(isNewer("v0.9.5-oled-edition", "v0.9.5-dev.20-oled-edition")).toBe(true);
    expect(isNewer("v0.9.5-dev.20-oled-edition", "v0.9.5-oled-edition")).toBe(false);
    expect(isNewer("0.9.5", "0.9.5")).toBe(false);
    expect(compareVersions("not a version", "0.9.5")).toBeNull();
    expect(isNewer("not a version", "0.9.5")).toBe(false);
  });

  it("the release gate uses the same function", () => {
    const { versionCmp } = gates as { versionCmp: (a: string, b: string) => number };
    ORDER.forEach((a, i) => ORDER.forEach((b, j) => expect(versionCmp(a, b), `${a} vs ${b}`).toBe(sign(i - j) || 0)));
  });

  const fwLib = process.env.DS5_FIRMWARE_REPO ? join(process.env.DS5_FIRMWARE_REPO, "tools", "manifest_lib.mjs") : null;
  // Skipped only when no firmware checkout is named; a named checkout without the file fails (CI names one).
  it.skipIf(!fwLib)("the firmware's feed builder orders the same table the same way", () => {
    expect(existsSync(fwLib!), `${fwLib} is missing`).toBe(true);
    // Plain Node imports the firmware's file (no bundler): its versionKey for every case.
    const script = `const { versionKey } = await import(${JSON.stringify(pathToFileURL(fwLib!).href)});
      console.log(JSON.stringify(${JSON.stringify(ORDER)}.map((v) => versionKey(v)?.map((n) => (n === Infinity ? "inf" : n)) ?? null)));`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const keys = (JSON.parse(run.stdout) as ((number | "inf")[] | null)[]).map((k) => k?.map((n) => (n === "inf" ? Infinity : n)) ?? null);
    const fwCmp = (x: number[], y: number[]) => {
      const k = x.findIndex((_, i) => x[i] !== y[i]);
      return k < 0 ? 0 : x[k] < y[k] ? -1 : 1;
    };
    keys.forEach((k, i) => expect(k, ORDER[i]).not.toBeNull());
    ORDER.forEach((a, i) => ORDER.forEach((b, j) => expect(fwCmp(keys[i]!, keys[j]!), `firmware: ${a} vs ${b}`).toBe(compareVersions(a, b))));
  });
});
