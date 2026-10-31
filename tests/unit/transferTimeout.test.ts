// 2026-10-31 app review S3: a control transfer the board never answers fails
// after TRANSFER_TIMEOUT_MS with the plain-words timeout, and the next request
// isn't stuck behind it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSFER_TIMEOUT_MS, WebUsbTransport } from "../../src/protocol/webUsbTransport";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function device(answer: () => Promise<USBInTransferResult>): USBDevice {
  return {
    vendorId: 0x054c,
    productId: 0x0ce6,
    opened: true,
    configuration: { interfaces: [{ interfaceNumber: 3, alternates: [{ interfaceClass: 0xff }] }] },
    configurations: [],
    open: async () => undefined,
    selectConfiguration: async () => undefined,
    claimInterface: async () => undefined,
    controlTransferIn: answer,
  } as unknown as USBDevice;
}

describe("USB control transfers have a deadline", () => {
  it("a transfer that never settles fails with the timeout, and the queue moves on", async () => {
    let calls = 0;
    const transport = new WebUsbTransport(
      device(() => (++calls === 1 ? new Promise<USBInTransferResult>(() => undefined) : Promise.resolve({ status: "ok", data: new DataView(new Uint8Array([7]).buffer) } as USBInTransferResult))),
    );
    const first = transport.getReport(0xf1, 63);
    const firstFailed = expect(first).rejects.toMatchObject({ key: "desktop.errors.board.timeout" });
    const second = transport.getReport(0xf1, 63);
    await vi.advanceTimersByTimeAsync(TRANSFER_TIMEOUT_MS);
    await firstFailed;
    await expect(second).resolves.toEqual(new Uint8Array([7]));
  });
});
