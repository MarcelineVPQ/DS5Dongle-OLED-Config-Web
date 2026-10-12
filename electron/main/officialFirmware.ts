// Sony's official controller firmware versions (src/protocol/officialFirmware.ts),
// fetched by the main process: one host, HTTPS, a plain GET with no
// cookies or identifiers, a timeout and a size cap, validated, and cached for a
// day. It runs only when "Check for updates automatically" is on or the user
// asks (Refresh on the Controller info card); the page never reaches the
// network. Nothing is downloaded from Sony but this small JSON file.
import { OFFICIAL_FIRMWARE_URL, parseOfficialInfo, type OfficialFirmware } from "../../src/protocol/officialFirmware";
import type { OfficialFirmwareLookup } from "../../src/desktop/api";

export const OFFICIAL_FIRMWARE_HOSTS: ReadonlySet<string> = new Set(["fwupdater.dl.playstation.net"]);
export const OFFICIAL_FIRMWARE_MAX_BYTES = 16 * 1024;
export const OFFICIAL_FIRMWARE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// A manual check refetches, but not more than once a minute.
const FORCE_MIN_AGE_MS = 60_000;

export function isAllowedOfficialFirmwareUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && OFFICIAL_FIRMWARE_HOSTS.has(url.hostname) && url.port === "" && url.username === "" && url.password === "";
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// The body, at most `max` bytes (a bigger answer is refused, not truncated).
async function readCapped(response: Response, max: number): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > max) throw new Error("too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => undefined);
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function fetchOfficialFirmware(fetch: Fetch, url = OFFICIAL_FIRMWARE_URL): Promise<OfficialFirmware> {
  if (!isAllowedOfficialFirmwareUrl(url)) throw new Error("host not allowed");
  const response = await fetch(url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = parseOfficialInfo(JSON.parse(await readCapped(response, OFFICIAL_FIRMWARE_MAX_BYTES)) as unknown);
  if (!parsed) throw new Error("unexpected answer");
  return parsed;
}

export class OfficialFirmwareSource {
  private cached: { at: number; latest: OfficialFirmware } | null = null;
  private pending: Promise<OfficialFirmwareLookup> | null = null;

  constructor(
    private readonly fetch: Fetch,
    private readonly allowedAutomatically: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  // `asked`: the user pressed Refresh / Check (allowed even with automatic
  // checks off, and refetches unless the last answer is under a minute old).
  lookup(asked: boolean): Promise<OfficialFirmwareLookup> {
    const age = this.cached ? this.now() - this.cached.at : Infinity;
    if (this.cached && age < (asked ? FORCE_MIN_AGE_MS : OFFICIAL_FIRMWARE_TTL_MS)) return Promise.resolve({ latest: this.cached.latest, problem: null });
    if (!asked && !this.allowedAutomatically()) return Promise.resolve({ latest: null, problem: "disabled" });
    this.pending ??= fetchOfficialFirmware(this.fetch)
      .then((latest): OfficialFirmwareLookup => {
        this.cached = { at: this.now(), latest };
        return { latest, problem: null };
      })
      // Offline or an answer we don't understand: the last good answer if
      // there is one, otherwise the card shows nothing.
      .catch((): OfficialFirmwareLookup => (this.cached ? { latest: this.cached.latest, problem: null } : { latest: null, problem: "unavailable" }))
      .finally(() => (this.pending = null));
    return this.pending;
  }
}
