// The update feed (latest.json) is signed: CI signs the exact bytes with an
// Ed25519 key that only exists as a GitHub Actions secret, and publishes the
// signature beside it as latest.json.sig (base64). The app refuses a feed
// that no trusted key signed, so a compromised GitHub account or a tampered
// mirror can't point installed apps at a malicious update, firmware or
// Proton build. TRUSTED_KEYS is a list so the key can be rotated: ship the
// new key in one release, start signing with it in the next.
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
