import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TRUSTED_KEYS, feedSignedBy } from "../../electron/main/feedSignature";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, pub: publicKey.export({ format: "der", type: "spki" }).toString("base64") };
}
const signed = (text: string, key: ReturnType<typeof keypair>["privateKey"]) => sign(null, Buffer.from(text), key).toString("base64");

describe("update feed signature", () => {
  const feed = JSON.stringify({ app: { version: "0.8.1", platforms: {} } }, null, 1) + "\n";

  it("accepts the exact bytes signed by a trusted key", () => {
    const k = keypair();
    expect(feedSignedBy(feed, signed(feed, k.privateKey), [k.pub])).toBe(true);
  });

  it("refuses a feed changed after signing, even by one byte", () => {
    const k = keypair();
    const sig = signed(feed, k.privateKey);
    expect(feedSignedBy(feed.replace("0.8.1", "0.8.2"), sig, [k.pub])).toBe(false);
    expect(feedSignedBy(feed + " ", sig, [k.pub])).toBe(false);
  });

  it("refuses a signature from a key it doesn't trust", () => {
    const k = keypair();
    const other = keypair();
    expect(feedSignedBy(feed, signed(feed, other.privateKey), [k.pub])).toBe(false);
  });

  it("refuses garbage and empty signatures", () => {
    const k = keypair();
    expect(feedSignedBy(feed, "", [k.pub])).toBe(false);
    expect(feedSignedBy(feed, "not base64 at all!", [k.pub])).toBe(false);
    expect(feedSignedBy(feed, Buffer.alloc(64).toString("base64"), [k.pub])).toBe(false);
  });

  it("checks every key in the list (key rotation)", () => {
    const old = keypair();
    const next = keypair();
    expect(feedSignedBy(feed, signed(feed, next.privateKey), [old.pub, next.pub])).toBe(true);
  });

  it("ships at least one well-formed trusted key", () => {
    expect(TRUSTED_KEYS.length).toBeGreaterThan(0);
    for (const k of TRUSTED_KEYS) expect(Buffer.from(k, "base64").length).toBe(44); // Ed25519 SPKI
  });
});
