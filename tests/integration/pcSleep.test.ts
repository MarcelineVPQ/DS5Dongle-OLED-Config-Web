// @vitest-environment jsdom
// Dongle -> PC sleep (protocol 1.14): two switches over identity [47]. A flip
// is staged like every other board setting (IA audit Q1): nothing is written
// until the save bar's Save, which writes the whole bit set with 0xF6 0x17;
// Revert drops the change.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { POWER_FLAGS, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { PcSleepSection } from "../../src/desktop/pages/SettingsPage";
import { BoardDraftsProvider, useBoardDrafts, type BoardDrafts } from "../../src/desktop/live/boardDrafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

const seen: { drafts: BoardDrafts | null } = { drafts: null };
// Hands the drafts out after each render (a callback defined outside the component).
const keep = (d: BoardDrafts) => {
  seen.drafts = d;
};
function Probe() {
  const d = useBoardDrafts();
  // lifetime: OK — acquires nothing (hands the drafts to the test)
  useEffect(() => keep(d));
  return null;
}

function render(powerFlags: number | null, setPowerFlags: (bits: number) => Promise<boolean>) {
  // A board with no remap, calibration or curves to read: only the PC sleep bits matter here.
  const client = { readRemap: () => Promise.resolve(null), readRemapExtra: () => Promise.resolve(null) };
  const bridge = { client, operation: null, identity: { powerFlags } as unknown as BridgeIdentity, setPowerFlags } as unknown as UseDs5BridgeResult;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(BoardDraftsProvider, { bridge }, createElement(PcSleepSection, { bridge }), createElement(Probe))));
  return () => [...container!.querySelectorAll<HTMLButtonElement>("button[role=switch]")];
}

describe("PC sleep options (Dongle page)", () => {
  it("shows the dongle's bits with Sony's wording; a flip is staged, Save writes the whole set", async () => {
    await i18n.changeLanguage("en");
    const setPowerFlags = vi.fn(() => Promise.resolve(true));
    const switches = render(POWER_FLAGS.sleepControllerOff, setPowerFlags);
    const [off, wake] = switches();
    expect(off.getAttribute("aria-label")).toBe("Turn off the controller when the PC sleeps");
    expect(wake.getAttribute("aria-label")).toBe("Wake the PC with the PS button");
    expect(container!.textContent).toContain('"DS5 Dongle Wake Keyboard"');
    expect([off.getAttribute("aria-checked"), wake.getAttribute("aria-checked")]).toEqual(["true", "false"]);
    // No "saved at once" line: the bar is where it's saved.
    expect(container!.textContent).not.toContain("right away");

    act(() => switches()[1].click());
    expect(setPowerFlags).not.toHaveBeenCalled();
    expect(switches()[1].getAttribute("aria-checked")).toBe("true");
    expect(seen.drafts!.staged).toBe(true);
    await act(async () => void (await seen.drafts!.saveStaged()));
    expect(setPowerFlags).toHaveBeenCalledWith(POWER_FLAGS.sleepControllerOff | POWER_FLAGS.psWakesPc);
  });

  it("Revert drops a staged flip; flipping back to the board's bits stages nothing", async () => {
    const setPowerFlags = vi.fn(() => Promise.resolve(true));
    const switches = render(POWER_FLAGS.sleepControllerOff, setPowerFlags);
    act(() => switches()[0].click());
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(seen.drafts!.staged).toBe(true);
    act(() => seen.drafts!.revertStaged());
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    expect(seen.drafts!.staged).toBe(false);
    act(() => switches()[0].click());
    act(() => switches()[0].click());
    expect(seen.drafts!.staged).toBe(false);
    expect(setPowerFlags).not.toHaveBeenCalled();
  });

  it("asks for a firmware update when the dongle has no PC sleep options", () => {
    const switches = render(null, vi.fn());
    expect(switches()).toHaveLength(0);
    expect(container!.querySelector(".dk-hint")?.textContent).toBe(i18n.t("desktop.settings.needsFirmware"));
  });
});
