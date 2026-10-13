// @vitest-environment jsdom
// Dongle -> PC sleep (protocol 1.14): two switches over identity [47]; each
// flip writes the whole bit set with 0xF6 0x17 and stays busy until the
// dongle has saved it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { POWER_FLAGS, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { PcSleepSection } from "../../src/desktop/pages/SettingsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

function render(powerFlags: number | null, setPowerFlags: (bits: number) => Promise<boolean>) {
  const bridge = { client: {}, operation: null, identity: { powerFlags } as unknown as BridgeIdentity, setPowerFlags } as unknown as UseDs5BridgeResult;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(PcSleepSection, { bridge })));
  return [...container.querySelectorAll<HTMLButtonElement>("button[role=switch]")];
}

describe("PC sleep options (Dongle page)", () => {
  it("shows the dongle's bits with Sony's wording and writes the whole set", async () => {
    await i18n.changeLanguage("en");
    let finish = (_: boolean) => {};
    const setPowerFlags = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const [off, wake] = render(POWER_FLAGS.sleepControllerOff, setPowerFlags);
    expect(off.getAttribute("aria-label")).toBe("Turn off the controller when the PC sleeps");
    expect(wake.getAttribute("aria-label")).toBe("Wake the PC with the PS button");
    expect(container!.textContent).toContain('"DS5 Dongle Wake Keyboard"');
    expect([off.getAttribute("aria-checked"), wake.getAttribute("aria-checked")]).toEqual(["true", "false"]);

    act(() => wake.click());
    expect(setPowerFlags).toHaveBeenCalledWith(POWER_FLAGS.sleepControllerOff | POWER_FLAGS.psWakesPc);
    // Busy until the dongle has it, like a BusyButton.
    expect(wake.getAttribute("aria-busy")).toBe("true");
    expect(wake.disabled).toBe(true);
    expect(container!.querySelector(".dk-btn-spinner")).not.toBeNull();
    await act(async () => finish(true));
    expect(wake.getAttribute("aria-busy")).toBeNull();
    expect(wake.disabled).toBe(false);
    expect(container!.querySelector(".dk-btn-spinner")).toBeNull();

    act(() => off.click());
    expect(setPowerFlags).toHaveBeenLastCalledWith(0);
  });

  it("asks for a firmware update when the dongle has no PC sleep options", () => {
    const switches = render(null, vi.fn());
    expect(switches).toHaveLength(0);
    expect(container!.querySelector(".dk-hint")?.textContent).toBe(i18n.t("desktop.settings.needsFirmware"));
  });
});
