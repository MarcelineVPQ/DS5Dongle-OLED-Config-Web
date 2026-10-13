// @vitest-environment jsdom
// The microphone test records with PipeWire's tools (electron/main/audioTest.ts),
// so it only works on Linux: the card shows there and nowhere else, instead of
// a Test microphone button that can only fail on Windows and macOS.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { MicTest } from "../../src/desktop/live/PartPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

function render(platform: string) {
  vi.stubGlobal("desktop", { platform, onMicLevel: () => () => undefined, micTest: () => Promise.resolve({ ok: true, peak: 0.5 }) });
  act(() => root!.render(createElement(MicTest)));
}

describe("microphone test card", () => {
  it("shows on Linux", () => {
    render("linux");
    expect(container!.querySelector("h2")?.textContent).toBe(i18n.t("desktop.audioTest.micTitle"));
    expect(container!.querySelector("button")?.textContent).toContain(i18n.t("desktop.audioTest.micButton"));
  });

  for (const platform of ["win32", "darwin"]) {
    it(`is not shown on ${platform}`, () => {
      render(platform);
      expect(container!.childElementCount).toBe(0);
    });
  }
});
