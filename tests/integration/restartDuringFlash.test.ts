// @vitest-environment jsdom
// While firmware is written, the app update's "Restart now" waits (the main
// process holds restart and quit too; tests/unit/firmwareHold.test.ts), and
// every firmware write reports itself to the main process.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import type { DesktopApi, FirmwareHoldState } from "../../src/desktop/api";
import UpdateBanners from "../../src/desktop/UpdateBanners";
import { whileWriting } from "../../src/desktop/firmwareUpdate";
import type { FirmwareUpdate } from "../../src/desktop/useUpdates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  delete window.desktop;
});

function fakeDesktop(initial: FirmwareHoldState) {
  let listener: ((s: FirmwareHoldState) => void) | null = null;
  const desktop = {
    restartToUpdate: vi.fn(),
    setFirmwareWriting: vi.fn(),
    getFirmwareHold: () => Promise.resolve(initial),
    onFirmwareHold: (l: (s: FirmwareHoldState) => void) => {
      listener = l;
      return () => (listener = null);
    },
  };
  window.desktop = desktop as unknown as DesktopApi;
  return { desktop, push: (s: FirmwareHoldState) => act(() => listener?.(s)) };
}

const fw = { state: { phase: "idle" }, available: false, latest: null, dismiss: () => undefined } as unknown as FirmwareUpdate;

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(UpdateBanners, { app: { phase: "ready", version: "9.9.9" }, fw, onShowFirmware: () => undefined, onFirmwareChanges: () => undefined })));
  return () => [...container!.querySelectorAll("button")].find((b) => b.textContent === "Restart now")!;
}

describe("Restart now while firmware is written", () => {
  it("is disabled with the reason while writing, and enabled again after", async () => {
    await i18n.changeLanguage("en");
    const { desktop, push } = fakeDesktop({ writing: true, restartQueued: false, quitQueued: false });
    const restart = await render();
    expect(restart().disabled).toBe(true);
    expect(restart().title).toBe("Wait for the firmware update to finish.");
    expect(container!.textContent).toContain("Wait for the firmware update to finish.");

    push({ writing: true, restartQueued: false, quitQueued: true });
    expect(container!.textContent).toContain("The app closes when the firmware update finishes");
    expect(container!.textContent).not.toContain("dongle");

    push({ writing: false, restartQueued: false, quitQueued: false });
    expect(restart().disabled).toBe(false);
    expect(restart().title).toBe("");
    act(() => restart().click());
    expect(desktop.restartToUpdate).toHaveBeenCalledOnce();
  });

  it("every firmware write tells the main process when it starts and ends, even when it fails", async () => {
    const { desktop } = fakeDesktop({ writing: false, restartQueued: false, quitQueued: false });
    await whileWriting(async () => expect(desktop.setFirmwareWriting).toHaveBeenLastCalledWith(true));
    expect(desktop.setFirmwareWriting).toHaveBeenLastCalledWith(false);
    await expect(whileWriting(() => Promise.reject(new Error("unplugged")))).rejects.toThrow("unplugged");
    expect(desktop.setFirmwareWriting.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
