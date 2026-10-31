// The update feed (latest.json, latest-dev.json) is signed: the developer
// signs the exact bytes on their own PC as the last release step, with an
// Ed25519 key that exists only there (never in CI or on GitHub; owner
// decision 2026-10-31), and publishes the signature beside it as
// latest.json.sig (base64). The app refuses a feed that no trusted key
// signed, and every download in it is pinned by size and SHA-256, so a
// compromised GitHub account, CI job or mirror can't write a feed that
// points installed apps at a different update, firmware or Proton build.
// What it doesn't cover: anyone holding the key (that PC), and an old or
// other-channel feed signed earlier, served again (the feed carries no
// channel binding or expiry yet). TRUSTED_KEYS is a list so the key can be
// rotated: ship the new key in one release, start signing with it in the next.
import { createPublicKey, verify } from "node:crypto";

// base64 SPKI DER (`openssl pkey -pubout -outform DER | base64`).
export const TRUSTED_KEYS = [
  "MCowBQYDK2VwAyEAwWS0P/N3k+Q5v2FDPRNLNu6HDg83IIJ/Atgp8t7zJtU=", // 2026-10, ~/.config/ds5-release on the developer's PC
];

export function feedSignedBy(text: string, signatureB64: string, keys: readonly string[]): boolean {
  const signature = Buffer.from(signatureB64.trim(), "base64");
  if (signature.length !== 64) return false;
  // loop: NOT-WORTH — N = 1 trusted key (2 during a rotation)
  return keys.some((k) => {
    try {
      const key = createPublicKey({ key: Buffer.from(k, "base64"), format: "der", type: "spki" });
      return verify(null, Buffer.from(text, "utf8"), key, signature);
    } catch {
      // error: NOT-WORTH — a key that can't be read verifies nothing: the update is refused as unsigned, which the banner says
      return false;
    }
  });
}
