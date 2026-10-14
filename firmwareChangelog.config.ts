// The firmware's CHANGELOG.md, bundled into the app at build time like the
// app's own CHANGELOG and docs/PROTON_CHANGELOG.md (a `?raw` import, so About
// → Firmware changes needs no network). The file lives once, in the firmware
// repo; nothing copies it into this repo. Where the build finds it:
//   1. resources/firmware/CHANGELOG.md: the release workflow (firmware repo,
//      .github/workflows/release.yml) puts it there with the firmware it
//      bundles (gitignored, like the UF2);
//   2. $DS5_FIRMWARE_DIR/CHANGELOG.md, else ../DS5Dongle/CHANGELOG.md: a
//      local checkout of the firmware repo next to this one (dev builds);
//   3. otherwise a short note that this build has none (CI checks, tests).
// A release sets DS5_REQUIRE_FIRMWARE_CHANGELOG=1: without 1. or 2. its build
// fails instead of shipping the note. Shared by electron.vite.config.ts and
// vitest.config.ts (the `@firmware-changelog` alias).
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// A regex: a string alias would not match "@firmware-changelog?raw".
export const FIRMWARE_CHANGELOG_ALIAS = /^@firmware-changelog(?=\?|$)/;
export const FIRMWARE_CHANGELOG_MISSING = "src/desktop/about/firmwareChangelogMissing.md";

export function firmwareChangelogPath(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [resolve(root, "resources/firmware/CHANGELOG.md"), ...(env.DS5_FIRMWARE_DIR ? [resolve(env.DS5_FIRMWARE_DIR, "CHANGELOG.md")] : []), resolve(root, "../DS5Dongle/CHANGELOG.md")];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  if (env.DS5_REQUIRE_FIRMWARE_CHANGELOG === "1") throw new Error(`The firmware CHANGELOG.md to bundle wasn't found (looked in ${candidates.join(", ")}).`);
  return resolve(root, FIRMWARE_CHANGELOG_MISSING);
}
