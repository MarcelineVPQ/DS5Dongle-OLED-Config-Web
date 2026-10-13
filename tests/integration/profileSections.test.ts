// @vitest-environment jsdom
// F21: the game page's "All settings" is the controller view's own sections
// with a game profile's draft (profileFields). Same ranges, steps, hints and
// validation as the live sections; edits go to the profile draft and never
// to the bridge (the dongle).
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { FEATURES2, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { DEFAULT_CONFIG, validateConfig, type ConfigBody } from "../../src/protocol/config";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import type { ProfileSettings } from "../../src/desktop/games/library";
import { settingsFrom } from "../../src/desktop/library/profileValues";
import { profileFields } from "../../src/desktop/library/profileFields";
import type { SectionFields } from "../../src/desktop/pages/sectionFields";
import { AutoHapticsSection, HapticsSection, MicSection, SpeakerSection } from "../../src/desktop/pages/SettingsPage";
import LightbarPage from "../../src/desktop/pages/LightbarPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: Segmented measures its row.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const CONFIG: ConfigBody = { ...DEFAULT_CONFIG, hapticsGain: 2, hapticsGainRight: 3, autoHapticsEnable: 2, autoHapticsGain: 120, speakerVolume: -6 };
const NORMAL = settingsFrom(CONFIG);

function fakeBridge(draft: ConfigBody) {
  const setDraftField = vi.fn();
  const gripTest = vi.fn(async () => undefined);
  const identity = { protoMajor: 1, protoMinor: 10, features2: FEATURES2.gripTest, controllerConnected: true } as unknown as BridgeIdentity;
  const bridge = { draft, config: draft, issues: validateConfig(draft), setDraftField, client: { splitHaptics: true, gripTest }, identity } as unknown as UseDs5BridgeResult;
  return { bridge, setDraftField, gripTest };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

function renderSections(bridge: UseDs5BridgeResult, fields?: SectionFields): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = { bridge, fields };
  act(() =>
    root!.render(
      createElement(
        Fragment,
        null,
        createElement(HapticsSection, props),
        createElement(AutoHapticsSection, props),
        createElement(SpeakerSection, props),
        createElement(LightbarPage, props),
        createElement(MicSection, props),
      ),
    ),
  );
  return container;
}

// Every control's constraints, as the user meets them.
const controls = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("input, button[role=switch], .dk-presets button, .dk-row")].map((c) =>
    c instanceof HTMLInputElement
      ? `${c.type}:${c.getAttribute("aria-label")}:${c.min}..${c.max}/${c.step}:${c.value}:${c.disabled}`
      : c.classList.contains("dk-row")
        ? `row:${c.className}`
        : `${c.tagName}:${c.textContent}:${c.getAttribute("aria-checked") ?? c.getAttribute("aria-pressed")}`,
  );
const hints = (el: HTMLElement) => [...el.querySelectorAll(".dk-hint")].map((h) => h.textContent);

function keyUp(input: HTMLInputElement, value: number) {
  act(() => {
    input.value = String(value);
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
}

describe("game page sections (profile draft)", () => {
  it("show the same controls, ranges, steps and hints as the live sections", () => {
    // A profile that changes every group (so no "normal" marks), against the
    // live sections showing those same values.
    const own: ProfileSettings = { ...NORMAL, hapticsGain: 4, autoHapticsGain: 50, speakerVolume: 3, lightbarMode: 6, lbFavR: [1, 2, 3, 4], btMicEnable: !NORMAL.btMicEnable, audioBufferLength: 32 };
    const live = renderSections(fakeBridge({ ...CONFIG, ...own } as ConfigBody).bridge);
    const liveControls = controls(live);
    const liveHints = hints(live).filter((h) => h !== i18n.t("desktop.grips.testHint"));
    act(() => root!.unmount());
    const profile = renderSections(
      fakeBridge(CONFIG).bridge,
      profileFields(CONFIG, NORMAL, own, () => undefined),
    );
    expect(liveControls.length).toBeGreaterThan(15);
    expect(controls(profile)).toEqual(liveControls);
    expect(hints(profile)).toEqual(liveHints);
  });

  it("uses the live speaker range (not a copy's -30 dB floor) and the live auto gain step", () => {
    const el = renderSections(
      fakeBridge(CONFIG).bridge,
      profileFields(CONFIG, NORMAL, { format: 2 }, () => undefined),
    );
    const speaker = el.querySelector<HTMLInputElement>('input[type=range][aria-label="Volume (Speaker for Controller)"]')!;
    expect([speaker.min, speaker.max, speaker.step]).toEqual(["-12", "12", "1"]);
    const gain = [...el.querySelectorAll<HTMLInputElement>("input[type=range]")].find((i) => i.max === "200")!;
    expect(gain.step).toBe("10");
  });

  it("edits the profile draft, never the dongle draft, and keeps only profile fields", () => {
    const onChange = vi.fn();
    const { bridge, setDraftField, gripTest } = fakeBridge(CONFIG);
    const el = renderSections(bridge, profileFields(CONFIG, NORMAL, { format: 2, speakerVolume: 3 }, onChange));
    keyUp(el.querySelector<HTMLInputElement>('input[type=range][aria-label="Volume (Speaker for Controller)"]')!, 9);
    expect(onChange).toHaveBeenLastCalledWith({ format: 2, speakerVolume: 9 });
    const rainbow = [...el.querySelectorAll<HTMLButtonElement>(".dk-presets button")].find((b) => b.textContent === "Rainbow")!;
    act(() => rainbow.click());
    expect(onChange).toHaveBeenLastCalledWith({ format: 2, speakerVolume: 9, lightbarMode: 6 });
    expect(setDraftField).not.toHaveBeenCalled();
    // The grip test acts on the controller now: live only.
    expect(el.textContent).not.toMatch(/Test left/i);
    expect(gripTest).not.toHaveBeenCalled();
  });

  it("marks the settings that use the normal value, not the game's own", () => {
    const el = renderSections(
      fakeBridge(CONFIG).bridge,
      profileFields(CONFIG, NORMAL, { format: 2, speakerVolume: 3 }, () => undefined),
    );
    const sub = (label: string) => el.querySelector(`input[aria-label="${label}"]`)?.closest(".dk-row")?.querySelector(".dk-sub")?.textContent ?? "";
    expect(sub("Volume (Speaker for Controller)")).not.toContain("Your normal setting");
    expect(sub("Vibration intensity (left)")).toContain("Your normal setting");
    expect(el.querySelectorAll("h2 .dk-chip")).toHaveLength(2); // lightbar mode + favorites
  });

  it("flags an out-of-range value like the live sections", () => {
    const el = renderSections(
      fakeBridge(CONFIG).bridge,
      profileFields(CONFIG, NORMAL, { format: 2, audioBufferLength: 200 }, () => undefined),
    );
    expect(el.querySelector('input[aria-label="Audio buffer length"]')?.closest(".dk-row")?.classList.contains("invalid")).toBe(true);
  });
});

describe("profileFields", () => {
  it("adds up several edits before the next render and drops non-profile fields", () => {
    const onChange = vi.fn();
    const f = profileFields(CONFIG, NORMAL, { format: 2 }, onChange);
    f.patch({ hapticsGain: 5 });
    f.patch({ hapticsGainRight: 4, inactiveTime: 30 });
    expect(onChange).toHaveBeenLastCalledWith({ format: 2, hapticsGain: 5, hapticsGainRight: 4 });
    expect(f.d.speakerVolume).toBe(-6);
    expect(f.normal!("speakerVolume")).toBe(true);
    expect(f.normal!("inactiveTime")).toBe(false);
  });
});
