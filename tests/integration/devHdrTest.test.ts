// @vitest-environment jsdom
// Lifetime pass batch 4: the Developer card's HDR test asks for a WebGPU
// device per mount; it is destroyed when the test unmounts (also when it
// arrives after the unmount), not left to garbage collection.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/i18n";
import HdrTest from "../../src/desktop/dev/HdrTest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeGpu(gate?: Promise<void>) {
  const destroy = vi.fn();
  const device = {
    destroy,
    createCommandEncoder: () => ({ beginRenderPass: () => ({ end() {} }), finish: () => ({}) }),
    queue: { submit() {} },
  };
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter: async () => ({ requestDevice: async () => (await gate, device) }) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) } as unknown as RenderingContext);
  return destroy;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { gpu?: unknown }).gpu;
});

describe("the dev HDR test's WebGPU device", () => {
  it("is destroyed on unmount", async () => {
    const destroy = fakeGpu();
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(createElement(HdrTest)));
    expect(destroy).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("is destroyed when it arrives after the unmount", async () => {
    let open!: () => void;
    const destroy = fakeGpu(new Promise<void>((r) => (open = r)));
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(HdrTest)));
    act(() => root.unmount());
    await act(async () => open());
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
