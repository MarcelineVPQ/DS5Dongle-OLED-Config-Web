// @vitest-environment jsdom
// Protocol 1.21 (DESIGN_FIRMWARE_IDENTITY §1.1): the board's own 0xEA report,
// announced by identity [49] bit 2, decoded with its bounds checked, and
// preferred over the board's name when the app decides which image fits.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { decodeFirmwareIdentity, Ds5BridgeClient, FEATURES4, FIRMWARE_IDENTITY_BYTES, REPORT } from "../../src/protocol/bridgeClient";
import { boardIdentity, identityFromFirmware, PICO2_W, type BoardIdentity } from "../../src/update/boardIdentity";
import type { DesktopApi, LatestFirmware } from "../../src/desktop/api";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { useFirmwareUpdate, type FirmwareUpdate } from "../../src/desktop/useUpdates";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;
// The firmware's layout (src/fw_identity.h): magic, layout 1, board type u16 LE, persona,
// personas, flash built / measured codes (4 KiB << n), chip, flags, display, displays, saved display.
const PICO2W_REPORT = [0x46, 0x49, 1, 1, 0, 0, 0x01, 0x0a, 0x0a, 1, 0x05, 1, 0x03, 1];

describe("0xEA firmware identity", () => {
  it("decodes every byte of the firmware's layout", () => {
    expect(decodeFirmwareIdentity(new Uint8Array(PICO2W_REPORT))).toEqual({
      boardType: 1,
      persona: 0,
      personas: 0x01,
      flashBuiltBytes: 4 * MB,
      flashMeasuredBytes: 4 * MB,
      chip: 1,
      radio: true,
      savedStateOff: false,
      displayRunning: true,
      display: 1,
      displays: 0x03,
      displaySaved: 1,
    });
    // Board type is little-endian; the flags' bits each on their own; unknown flash = null.
    const other = decodeFirmwareIdentity(new Uint8Array([0x46, 0x49, 1, 0x02, 0x01, 0, 0x01, 0x0a, 0, 2, 0x02, 0, 0x03, 0]))!;
    expect(other.boardType).toBe(0x0102);
    expect(other.flashMeasuredBytes).toBeNull();
    expect(other).toMatchObject({ chip: 2, radio: false, savedStateOff: true, displayRunning: false, display: 0, displaySaved: 0 });
    expect(decodeFirmwareIdentity(new Uint8Array([...PICO2W_REPORT.slice(0, 7), 0x09, 0x09, ...PICO2W_REPORT.slice(9)]))!.flashBuiltBytes).toBe(2 * MB);
  });

  it("refuses what isn't the layout: short, wrong magic, layout 0 (bounds checked)", () => {
    expect(decodeFirmwareIdentity(new Uint8Array(PICO2W_REPORT.slice(0, FIRMWARE_IDENTITY_BYTES - 1)))).toBeNull();
    expect(decodeFirmwareIdentity(new Uint8Array(0))).toBeNull();
    expect(decodeFirmwareIdentity(new Uint8Array([0x46, 0x48, ...PICO2W_REPORT.slice(2)]))).toBeNull();
    expect(decodeFirmwareIdentity(new Uint8Array([0x46, 0x49, 0, ...PICO2W_REPORT.slice(3)]))).toBeNull();
    // A longer, later layout still reads its first 14 bytes.
    expect(decodeFirmwareIdentity(new Uint8Array([...PICO2W_REPORT, 0x77]))?.boardType).toBe(1);
  });

  it("is read only when identity [49] bit 2 says so (protocol 1.21)", async () => {
    const old = new FakeDongle({ protoMinor: 20 });
    const oldClient = new Ds5BridgeClient(old);
    await oldClient.identity();
    expect(await oldClient.readFirmwareIdentity()).toBeNull();

    const dongle = new FakeDongle({ protoMinor: 21 });
    const client = new Ds5BridgeClient(dongle);
    const id = await client.identity();
    expect(id.protoMinor).toBe(21);
    expect(id.features4 & FEATURES4.firmwareIdentity).toBe(FEATURES4.firmwareIdentity);
    expect(id.features4 & FEATURES4.displayChoice).toBe(FEATURES4.displayChoice);
    const fw = await client.readFirmwareIdentity();
    expect(fw).toMatchObject({ boardType: 1, chip: 1, flashMeasuredBytes: 4 * MB, display: 1, displaySaved: 1 });
    expect(REPORT.firmwareIdentity).toBe(0xea);
  });

  it("maps to the feed's ids, measured flash first", () => {
    const fw = decodeFirmwareIdentity(new Uint8Array(PICO2W_REPORT))!;
    expect(identityFromFirmware(fw)).toEqual(PICO2_W);
    // The chip says 2 MB although the image was built for 4: the offer goes by the chip.
    expect(identityFromFirmware({ ...fw, flashMeasuredBytes: 2 * MB })).toEqual({ ...PICO2_W, flashBytes: 2 * MB });
    // Not measured: what the running image was built for.
    expect(identityFromFirmware({ ...fw, flashMeasuredBytes: null })).toEqual(PICO2_W);
    expect(identityFromFirmware({ ...fw, chip: 2 })).toEqual({ ...PICO2_W, chip: "rp2350b" });
    // Anything this app doesn't know: no identity, so nothing is offered.
    expect(identityFromFirmware({ ...fw, boardType: 0 })).toBeNull();
    expect(identityFromFirmware({ ...fw, chip: 0xff })).toBeNull();
    expect(identityFromFirmware({ ...fw, persona: 7 })).toBeNull();
    // Preferred over the name: a board named "Pico 2 W" whose 0xEA says RP2350B is that.
    expect(boardIdentity({ boardName: "Pico 2 W", protoMinor: 21 }, { ...fw, chip: 2 })?.chip).toBe("rp2350b");
    expect(boardIdentity({ boardName: "Pico 2 W", protoMinor: 21 }, null)).toEqual(PICO2_W);
  });
});

describe("the update offer uses 0xEA", () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("asks for the image of the board 0xEA describes, not its name", async () => {
    const asked: BoardIdentity[] = [];
    const answer: LatestFirmware = { version: "v0.9.5-oled-edition", source: "online", channel: "stable", sha256: "0".repeat(64), board: "pico2_w" };
    window.desktop = {
      latestFirmware: async (_asked: boolean, board: BoardIdentity) => {
        asked.push(board);
        return { latest: answer, problem: null };
      },
    } as unknown as DesktopApi;
    const firmwareIdentity = decodeFirmwareIdentity(new Uint8Array([...PICO2W_REPORT.slice(0, 8), 0x09, ...PICO2W_REPORT.slice(9)]));
    const bridge = { client: null, firmwareVersion: "v0.9.4-oled-edition", identity: { boardName: "Pico 2 W", protoMinor: 21 }, firmwareIdentity } as unknown as UseDs5BridgeResult;
    const out: { fw: FirmwareUpdate | null } = { fw: null };
    function Card() {
      const fw = useFirmwareUpdate(bridge, { phase: "idle" });
      useEffect(() => {
        out.fw = fw;
      });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(createElement(Card)));
    // A 2 MB chip measured at start-up: the lookup says so (main then offers nothing that needs 4 MB).
    expect(asked).toEqual([{ ...PICO2_W, flashBytes: 2 * MB }]);
  });
});
