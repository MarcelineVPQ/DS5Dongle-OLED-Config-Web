// @vitest-environment jsdom
// F21: the game page's "All settings" is the controller view's own sections
// with a game profile's draft (profileFields). Same ranges, steps, hints and
// validation as the live sections; edits go to the profile draft and never
// to the bridge (the dongle).
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { FEATURES2, FEATURES3, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { DEFAULT_CONFIG, validateConfig, type ConfigBody } from "../../src/protocol/config";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import type { ProfileSettings } from "../../src/desktop/games/library";
import { settingsFrom } from "../../src/desktop/library/profileValues";
import { profileFields } from "../../src/desktop/library/profileFields";
import type { SectionFields } from "../../src/desktop/pages/sectionFields";
import { AutoHapticsSection, HapticsSection, MicLevelSlider, MicSection, SpeakerSection, TriggerIntensitySection } from "../../src/desktop/pages/SettingsPage";
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

function fakeBridge(draft: ConfigBody, minor = 10, pcMicLevel: number | null = null) {
  const setDraftField = vi.fn();
  const gripTest = vi.fn(async () => undefined);
  const identity = {
    protoMajor: 1,
    protoMinor: minor,
    features2: FEATURES2.gripTest,
    features3: (minor >= 13 ? FEATURES3.configTail : 0) | (minor >= 16 ? FEATURES3.micLevel : 0),
    pcMicLevel,
    controllerConnected: true,
  } as unknown as BridgeIdentity;
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
        createElement(TriggerIntensitySection, props),
        createElement(SpeakerSection, props),
        createElement(LightbarPage, props),
        createElement(MicSection, props),
        // Live, the mic level sits under the Mic Test (PartPanel); a profile has it in MicSection.
        fields ? null : createElement(MicLevelSlider, props),
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

  it("protocol 1.13: a profile holds trigger reduction, speaker boost and the volume lock, not the dongle's audio routing", () => {
    const onChange = vi.fn();
    const live = renderSections(fakeBridge(CONFIG, 13).bridge);
    const label = (el: HTMLElement, l: string) => !!el.querySelector(`[aria-label="${l}"]`);
    for (const l of ["Weaker by", "Speaker boost", "Audio output", "Microphone used"]) expect(label(live, l), l).toBe(true);
    act(() => root!.unmount());
    const { bridge, setDraftField } = fakeBridge(CONFIG, 13);
    const el = renderSections(bridge, profileFields(CONFIG, NORMAL, { format: 2 }, onChange));
    for (const l of ["Weaker by", "Speaker boost"]) expect(label(el, l), l).toBe(true);
    for (const l of ["Audio output", "Microphone used"]) expect(label(el, l), l).toBe(false);
    keyUp(el.querySelector<HTMLInputElement>('input[type=range][aria-label="Weaker by"]')!, 4);
    expect(onChange).toHaveBeenLastCalledWith({ format: 2, triggerReduce: 4 });
    expect(setDraftField).not.toHaveBeenCalled();
  });

  it("protocol 1.16: the mic level is live and per game, and says when following the PC means silence", () => {
    const live = renderSections(fakeBridge(CONFIG, 16, 0).bridge);
    const slider = live.querySelector<HTMLInputElement>('input[type=range][aria-label="Microphone level"]')!;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(["0", "64", "1", "0"]);
    expect(live.textContent).toContain(i18n.t("desktop.settings.micLevelPcZero"));
    act(() => root!.unmount());
    // A level of its own (or a PC level above 0): no note.
    expect(renderSections(fakeBridge({ ...CONFIG, micLevel: 40 }, 16, 0).bridge).textContent).not.toContain(i18n.t("desktop.settings.micLevelPcZero"));
    act(() => root!.unmount());
    expect(renderSections(fakeBridge(CONFIG, 16, 0x40).bridge).textContent).not.toContain(i18n.t("desktop.settings.micLevelPcZero"));
    act(() => root!.unmount());
    const { bridge: b2, setDraftField: live2 } = fakeBridge(CONFIG, 16, 0x40);
    keyUp(renderSections(b2).querySelector<HTMLInputElement>('input[type=range][aria-label="Microphone level"]')!, 48);
    expect(live2).toHaveBeenLastCalledWith("micLevel", 48);
    act(() => root!.unmount());
    const onChange = vi.fn();
    const { bridge, setDraftField } = fakeBridge(CONFIG, 16, 0);
    const el = renderSections(bridge, profileFields(CONFIG, NORMAL, { format: 2 }, onChange));
    expect(el.textContent).not.toContain(i18n.t("desktop.settings.micLevelPcZero"));
    keyUp(el.querySelector<HTMLInputElement>('input[type=range][aria-label="Microphone level"]')!, 20);
    expect(onChange).toHaveBeenLastCalledWith({ format: 2, micLevel: 20 });
    expect(setDraftField).not.toHaveBeenCalled();
  });

  it("before protocol 1.16 the mic level says to update the firmware", () => {
    const el = renderSections(fakeBridge(CONFIG, 15).bridge);
    expect(el.querySelector('[aria-label="Microphone level"]')).toBeNull();
    expect(hints(el).filter((h) => /firmware/i.test(h ?? "")).length).toBeGreaterThan(0);
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
