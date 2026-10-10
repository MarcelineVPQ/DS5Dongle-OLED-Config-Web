// Hosts the app may hand to the system browser. Anything else is dropped.
const ALLOWED_HOSTS = new Set(["github.com", "marcelinevpq.github.io", "zacksly.itch.io"]);

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname) && url.username === "" && url.password === "";
}
