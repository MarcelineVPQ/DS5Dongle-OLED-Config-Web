// The update feed: one latest.json for the app and the firmware (ADR-0003).
// Served from raw.githubusercontent.com (no API rate limit, indifferent to
// prerelease flags). Every download carries its full URL and SHA-256; the
// client never builds a URL and never installs without a matching checksum.
import { z } from "zod";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters");

// Our Proton builds are named GE-Proton<version>-DualSense. The manifest, the
// installer and the Games scanner all use this one rule to recognise them.
export const PROTON_NAME = /^GE-Proton[\w.-]*DualSense$/;

// Newer of two of our build names ("GE-Proton11-10-DualSense" > "GE-Proton11-7-DualSense").
export const compareProtonNames = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export const Download = z.object({
  url: z.string().url(),
  size: z.number().int().positive(),
  sha256: Sha256,
});
export type Download = z.infer<typeof Download>;

export const Manifest = z.object({
  // Only "stable" exists today; an opt-in development channel can be added later.
  channel: z.string().max(32).optional(),
  app: z.object({
    version: z.string(),
    notes_url: z.string().url().optional(),
    platforms: z.object({
      linux: Download.optional(),
      windows: Download.optional(),
      macos: Download.optional(),
    }),
  }),
  firmware: z
    .object({
      version: z.string(),
      notes_url: z.string().url().optional(),
      uf2: Download,
    })
    .optional(),
  // Our GE-Proton DualSense build, installed by the Games page (Linux).
  proton: z
    .object({
      name: z.string().regex(PROTON_NAME, "proton name must be a GE-Proton<version>-DualSense folder name"),
      notes_url: z.string().url().optional(),
      tarball: Download,
    })
    .optional(),
});
export type Manifest = z.infer<typeof Manifest>;

// `v0.8.0-oled-edition`, `0.8.0`, `0.7.0-vendor` -> [0, 8, 0]. Anything after
// the first "-" is a channel label, not part of the ordering. Returns null for
// anything else; callers treat null as "can't tell", never as "newer".
export function parseVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  const dash = s.indexOf("-");
  if (dash !== -1) s = s.slice(0, dash);
  const parts = s.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

// A development build's number: "0.9.1-dev.3", "v0.9.1-dev.3-oled-edition"
// -> 3; null for a stable version.
export function devNumber(raw: string | null | undefined): number | null {
  const m = /-dev\.(\d+)(?:-|$)/.exec(raw?.trim() ?? "");
  return m ? Number(m[1]) : null;
}

// Strictly newer only. Equal is not newer, and an unparseable version on
// either side is not newer: an updater that can't read a version must do
// nothing rather than risk moving someone backwards. Development builds come
// before their release: 0.9.1-dev.1 < 0.9.1-dev.2 < 0.9.1.
export function isNewer(remote: string | null | undefined, local: string | null | undefined): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  if (!r || !l) return false;
  for (let i = 0; i < 3; i++) if (r[i] !== l[i]) return r[i] > l[i];
  const rd = devNumber(remote);
  const ld = devNumber(local);
  if (rd === null) return ld !== null; // a release is newer than its development builds
  return ld !== null && rd > ld;
}

// The same version, development number included.
// "v0.9.2-oled-edition" -> "0.9.2", "v0.9.3-dev.1-oled-edition" -> "0.9.3-dev.1":
// for buttons and short labels (the full tag is shown next to them).
export function shortVersion(raw: string | null | undefined): string {
  const v = parseVersion(raw);
  if (!v) return raw ?? "";
  const dev = devNumber(raw);
  return `${v.join(".")}${dev === null ? "" : `-dev.${dev}`}`;
}

export const sameVersion = (a: string | null | undefined, b: string | null | undefined) => !!parseVersion(a) && !isNewer(a, b) && !isNewer(b, a);

// Hosts a manifest download may point at: GitHub release assets and the
// redirect targets GitHub serves them from.
export const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

export function isAllowedDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && DOWNLOAD_HOSTS.has(url.hostname) && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
