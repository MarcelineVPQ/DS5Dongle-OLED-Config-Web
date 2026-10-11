// Which firmware the app offers: the build bundled inside the app (every
// release ships with the firmware it was built and tested with, so a new
// dongle can be set up offline) or a newer one published in the update feed.
// The renderer never chooses; it asks for "the firmware" and gets the bytes,
// verified here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { FirmwareLookup } from "../../src/desktop/api";
import { isNewer, type Manifest } from "../../src/update/manifest";

export const FIRMWARE_MAX_BYTES = 8 * 1024 * 1024;

// resources/firmware/firmware.json, written by the release workflow.
const BundleInfo = z.object({
  version: z.string().max(64),
  file: z.string().regex(/^[\w.-]+\.uf2$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface Bundled {
  version: string;
  path: string;
  sha256: string;
}

export function readBundled(resourcesDir: string): Bundled | null {
  try {
    const dir = join(resourcesDir, "firmware");
    const info = BundleInfo.parse(JSON.parse(readFileSync(join(dir, "firmware.json"), "utf8")));
    return { version: info.version, path: join(dir, info.file), sha256: info.sha256 };
  } catch {
    return null; // development builds have no bundled firmware
  }
}

export function loadBundled(b: Bundled): Uint8Array {
  const bytes = new Uint8Array(readFileSync(b.path));
  if (bytes.byteLength > FIRMWARE_MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== b.sha256) {
    throw new Error("The firmware bundled with the app is damaged. Reinstall the app.");
  }
  return bytes;
}

type Published = NonNullable<Manifest["firmware"]>;

// The published firmware only when it is strictly newer than the bundled one.
export function choose(bundled: Bundled | null, published: Published | null): "bundled" | "online" | null {
  if (published && (!bundled || isNewer(published.version, bundled.version))) return "online";
  return bundled ? "bundled" : null;
}

export interface FirmwareSourceDeps {
  bundled: () => Bundled | null;
  // The feed, or why there's none: "unpublished" (nothing released yet) or "offline".
  manifest: () => Promise<{ manifest: Manifest | null; problem: FirmwareLookup["problem"] }>;
  downloadPublished: () => Promise<{ version: string; bytes: Uint8Array }>;
}

export async function latestFirmware(deps: FirmwareSourceDeps): Promise<FirmwareLookup> {
  const bundled = deps.bundled();
  const { manifest, problem } = await deps.manifest();
  const published = manifest?.firmware ?? null;
  const source = choose(bundled, published);
  if (source === "online") return { latest: { version: published!.version, notesUrl: published!.notes_url, source }, problem: null };
  if (source === "bundled") return { latest: { version: bundled!.version, source }, problem };
  return { latest: null, problem: problem ?? "unpublished" };
}

export async function firmwareBytes(deps: FirmwareSourceDeps): Promise<{ version: string; bytes: Uint8Array }> {
  const bundled = deps.bundled();
  const published = (await deps.manifest()).manifest?.firmware ?? null;
  const source = choose(bundled, published);
  if (source === "online") return deps.downloadPublished();
  if (source === "bundled") return { version: bundled!.version, bytes: loadBundled(bundled!) };
  throw new Error("No firmware is available: this build has none bundled and the update feed can't be reached.");
}
