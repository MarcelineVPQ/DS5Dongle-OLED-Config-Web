// @vitest-environment jsdom
// One GPU crash turned hardware acceleration off for good, without a word
// (bug hunt A4, 0.9.5). Now it takes a second crash in the same run, and the
// page says so, with Turn back on.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { gpuCrashWatcher } from "../../electron/main/gpuCrash";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("turns hardware acceleration off on the second GPU crash of a run, not the first", () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let on = true;
  const turnOff = vi.fn(() => (on = false));
  const crashed = gpuCrashWatcher(() => on, turnOff);
  crashed({ type: "GPU", reason: "clean-exit" });
  crashed({ type: "GPU", reason: "killed" });
  crashed({ type: "Utility", reason: "crashed" });
  crashed({ type: "GPU", reason: "crashed" });
  expect(turnOff).not.toHaveBeenCalled();
  crashed({ type: "GPU", reason: "crashed" });
  expect(turnOff).toHaveBeenCalledTimes(1);
  crashed({ type: "GPU", reason: "crashed" }); // already off
  expect(turnOff).toHaveBeenCalledTimes(1);
});

let GpuNotice: typeof import("../../src/desktop/GpuNotice").default;
beforeAll(async () => {
  await (await import("../../src/i18n")).default.changeLanguage("en");
  GpuNotice = (await import("../../src/desktop/GpuNotice")).default;
});
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  vi.unstubAllGlobals();
});

it("the page says it was turned off, and Turn back on turns it on", async () => {
  let turnedOff: (() => void) | null = null;
  const setSetting = vi.fn(() => Promise.resolve({}));
  vi.stubGlobal("desktop", {
    onGpuTurnedOff: (listener: () => void) => {
      turnedOff = listener;
      return () => (turnedOff = null);
    },
    setSetting,
  });
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(createElement(GpuNotice)));
  expect(container.textContent).toBe("");
  await act(async () => turnedOff?.());
  expect(container.textContent).toContain("Hardware acceleration was turned off after a graphics crash");
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Turn back on")!;
  await act(async () => button.click());
  expect(setSetting).toHaveBeenCalledWith("hardwareAcceleration", true);
  expect(container.textContent).toContain("Hardware acceleration is back on from the next start.");
});
