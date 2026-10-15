// @vitest-environment jsdom
// The OLED mirror on the Pico 2 W page: read every 100 ms while shown, but
// the canvas repaints only when the picture changes (power, screen, contrast
// or the 1024 image bytes). The firmware's frame counter alone (it resends
// an unchanged frame every 20th flush) is not a change.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { OLED_MIRROR_BYTES, type Ds5Transport } from "../../src/protocol/transport";
import DongleConsole, { useOledFrame, type OledFrameState } from "../../src/desktop/dongle/DongleConsole";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};

// A board whose mirror answer the test sets: [power, screen, contrast, seq, 1024 pixels].
const report = new Uint8Array(OLED_MIRROR_BYTES);
const transport: Ds5Transport = {
  getReport: (id: number, length: number) => Promise.resolve(id === 0xef ? report.slice(0, length) : new Uint8Array(length)),
  setReport: () => Promise.resolve(),
} as unknown as Ds5Transport;
const client = new Ds5BridgeClient(transport);

let identity: BridgeIdentity;
let state: OledFrameState;
let container: HTMLDivElement;
let root: Root;
const putImageData = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage("en");
  identity = await new Ds5BridgeClient(new FakeDongle()).identity();
  report.fill(0);
  report.set([0, 2, 0xff, 0]);
  // loop: test — a stripe pattern
  for (let i = 0; i < 1024; i++) report[4 + i] = i % 2 ? 0xaa : 0x55;
  putImageData.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Page() {
  const frame = useOledFrame(client, true);
  // lifetime: OK — test probe: hands the hook's state to the test
  useEffect(() => {
    state = frame;
  }, [frame]);
  return createElement(DongleConsole, { client, identity, controllerOn: true, frame, keys: { supported: false, press: null } });
}
const advance = async (ms: number) => {
  // loop: test — 50 ms steps, so each read settles
  for (let t = 0; t < ms; t += 50) await act(() => vi.advanceTimersByTimeAsync(50));
};

describe("the OLED mirror repaints only on a change", () => {
  it("readOledFrame(last) gives back the same frame for the same picture, even with a new frame counter", async () => {
    const a = await client.readOledFrame();
    report[3] = 7; // a resend: only the counter moved
    expect(await client.readOledFrame(a)).toBe(a);
    report[2] = 0x80; // contrast
    const b = await client.readOledFrame(a);
    expect(b).not.toBe(a);
    expect(b!.contrast).toBe(0x80);
  });

  it("identical frames don't repaint the canvas; a changed frame does, once", async () => {
    vi.useFakeTimers();
    act(() => root.render(createElement(Page)));
    await advance(200);
    expect(putImageData).toHaveBeenCalled();
    const painted = putImageData.mock.calls.length;
    const changes = state.changes;
    const frame = state.frame;
    // A second of the same picture (with resends bumping the counter): no repaint, no change counted.
    // loop: test — 10 reads
    for (let i = 0; i < 10; i++) {
      report[3] = (report[3] + 1) & 0xff;
      await advance(100);
    }
    expect(putImageData).toHaveBeenCalledTimes(painted);
    expect(state.changes).toBe(changes);
    expect(state.frame).toBe(frame);
    // One pixel byte changes: one repaint, one change.
    report[4 + 500] ^= 0xff;
    await advance(300);
    expect(putImageData).toHaveBeenCalledTimes(painted + 1);
    expect(state.changes).toBe(changes + 1);
    expect(state.frame).not.toBe(frame);
    // The power state changes: another.
    report[0] = 1;
    await advance(300);
    expect(putImageData).toHaveBeenCalledTimes(painted + 2);
  });
});
