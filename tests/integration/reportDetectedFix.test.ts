// @vitest-environment jsdom
// Your report's Controller detected: Fail points to Setup's fix when there is
// one (Turn off Steam Input, the standard gamepad): visible state, no hidden
// trick (Marcy, 2026-10-17, from Assetto Corsa Rally inside gamescope).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import GamePage from "../../src/desktop/library/GamePage";
import type { Fix, GameEntry } from "../../src/desktop/games/types";
import type { GameRecord } from "../../src/desktop/games/library";
import { fakeBridge, fakeDesktop, gamesReport, ghostrunner, GHOSTRUNNER_INFO, HDR_READY } from "../support/gamePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const inputOff = (game: GameEntry): Fix => ({
  id: `${game.key.replace(/:steam:\d+$/, "")}:input:${game.id}`,
  kind: "steam-input-off",
  launcher: "steam",
  label: { key: "label.steamInput", params: { game: game.title } },
  why: { key: "why.steamInputNotDetected", params: { game: game.title } },
  files: ["~/.local/share/Steam/userdata/1/config/localconfig.vdf"],
  recommended: true,
});
const record = (fail: boolean): GameRecord => ({ title: "Ghostrunner", mine: fail ? { report: { schemaVersion: 1, results: { "controller-detected": { result: "fail" } } } } : {} });

function render(game: GameEntry, rec: GameRecord) {
  vi.stubGlobal("desktop", fakeDesktop("linux"));
  act(() =>
    root.render(
      createElement(GamePage, {
        game,
        info: GHOSTRUNNER_INFO,
        record: rec,
        running: false,
        report: gamesReport(game, HDR_READY),
        bridge: fakeBridge(),
        onLibrary: () => undefined,
        onRescan: () => undefined,
      }),
    ),
  );
  const head = container.querySelector<HTMLButtonElement>('[data-section="report"] .dk-sec-toggle')!;
  if (head.getAttribute("aria-expanded") !== "true") act(() => head.click());
  return container.querySelector<HTMLElement>('[data-section="report"] [data-feature="controller-detected"]')!;
}

describe("Controller detected: Fail and Setup's fix", () => {
  it("names the fix under the row", () => {
    const game = ghostrunner();
    const withFix = { ...game, fixes: [inputOff(game)] };
    const row = render(withFix, record(true));
    expect(row.textContent).toContain(i18n.t("desktop.library.sheetDetectedFix", { fix: "Turn Steam Input off for Ghostrunner" }));
  });

  it("says nothing without a fix, or without the Fail", () => {
    const game = ghostrunner();
    expect(render({ ...game, fixes: [] }, record(true)).textContent).not.toContain("Setup has a fix");
    act(() => root.unmount());
    root = createRoot(container);
    expect(render({ ...game, fixes: [inputOff(game)] }, record(false)).textContent).not.toContain("Setup has a fix");
  });
});
