// One HTTPS host-allowlist check for every URL the main process accepts:
// links handed to the system browser, update downloads, Sony's firmware list.
import { DOWNLOAD_HOSTS } from "../../src/update/manifest";

// HTTPS on its default port, a host from `hosts`, no user name or password.
export function isAllowedHttpsUrl(raw: string, hosts: ReadonlySet<string>): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && hosts.has(url.hostname) && url.port === "" && url.username === "" && url.password === "";
}

// Hosts the app may hand to the system browser. Anything else is dropped.
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["github.com", "marcelinevpq.github.io", "zacksly.itch.io", "42pixelstudios.com", "controller.dl.playstation.net"]);

export const isAllowedExternalUrl = (raw: string): boolean => isAllowedHttpsUrl(raw, ALLOWED_HOSTS);

// A manifest download: GitHub release assets only.
export const isAllowedDownloadUrl = (raw: string): boolean => isAllowedHttpsUrl(raw, DOWNLOAD_HOSTS);
