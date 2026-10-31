// The app and the firmware speak the same protocol version (CLAUDE.md:
// protocol changes land in the firmware first, then the client, the simulated
// board and the tests). The firmware's src/cmd.h is read only when
// DS5_FIRMWARE_REPO names its checkout (CI names one; a checkout next to this
// one may be on any branch).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ds5BridgeClient, PROTOCOL_MINOR_KNOWN, SUPPORTED_PROTO_MAJOR } from "../../src/protocol/bridgeClient";
import { SimulatedDongle } from "../../src/protocol/simulatedDongle";

const cmdH = process.env.DS5_FIRMWARE_REPO ? join(process.env.DS5_FIRMWARE_REPO, "src", "cmd.h") : null;
const define = (text: string, name: string) => Number(new RegExp(`^#define\\s+${name}\\s+(\\d+)\\b`, "m").exec(text)?.[1]);

describe("the protocol version", () => {
  it.skipIf(!cmdH)("the app knows the firmware's current protocol (src/cmd.h)", () => {
    expect(existsSync(cmdH!), `${cmdH} is missing`).toBe(true);
    const text = readFileSync(cmdH!, "utf8");
    expect(define(text, "PICO_PROTO_MAJOR"), "PICO_PROTO_MAJOR").toBe(SUPPORTED_PROTO_MAJOR);
    expect(define(text, "PICO_PROTO_MINOR"), "PICO_PROTO_MINOR: teach the app (bridgeClient.ts PROTOCOL_MINOR_KNOWN, the simulated board, tests) the new minor").toBe(PROTOCOL_MINOR_KNOWN);
  });

  it("the simulated board speaks the newest minor the app knows unless a test pins an older one", async () => {
    const id = await new Ds5BridgeClient(new SimulatedDongle()).identity();
    expect([id.protoMajor, id.protoMinor]).toEqual([SUPPORTED_PROTO_MAJOR, PROTOCOL_MINOR_KNOWN]);
  });
});
