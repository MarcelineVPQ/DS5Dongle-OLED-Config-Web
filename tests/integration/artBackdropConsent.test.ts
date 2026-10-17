// @vitest-environment jsdom
// The Controller page's game-art background follows Games consent.
//   - Games not allowed: no request for game art at all (the main process
//     refused it and logged an error at every page load: 0.9.5-dev.18 RC test,
//     Linux and Windows), and no warning in the page; colors only.
//   - Consent given mid-session (Games' consent card, App settings → Privacy):
//     the art loads without a reload; taken back: colors only again.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let allowed: boolean;
let gamesDetails: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  window.localStorage.clear();
  window.localStorage.setItem("ds5.background", "art");
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  allowed = false;
  // Like the main process: refused without consent.
  gamesDetails = vi.fn(() =>
    allowed
      ? Promise.resolve({ "steam-1:steam:1": { art: ["hero"], lastPlayed: 2 }, "steam-1:steam:2": { art: ["hero"], lastPlayed: 1 } })
      : Promise.reject(new Error("⟦desktop.errors.main.gamesNotAllowed⟧")),
  );
  vi.stubGlobal("desktop", {
    platform: "linux",
    getSettings: () => Promise.resolve({ hardwareAcceleration: false, gamesScanAllowed: allowed }),
    setSetting: (key: string, value: boolean) => {
      if (key === "gamesScanAllowed") allowed = value;
      return Promise.resolve();
    },
    onWindowVisible: () => () => undefined,
    gamesDetails,
    gamesRunning: () => Promise.resolve(null),
    onRunningGame: () => () => undefined,
  });
  warn = vi.spyOn(console, "warn");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  warn.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function mount() {
  const { default: ArtBackdrop } = await import("../../src/desktop/live/ArtBackdrop");
  act(() => root.render(createElement(ArtBackdrop, { colors: null })));
  await advance(50);
  return () => container.querySelector<HTMLElement>(".art-bd")!;
}

describe("the game-art background and Games consent", () => {
  it("doesn't ask for game art (and logs nothing) while Games isn't allowed", async () => {
    const bd = await mount();
    await advance(70_000); // past every retry the first scan would get
    expect(gamesDetails).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(bd().classList.contains("blobs")).toBe(true);
    expect(container.querySelector(".art-bd-layer:not(.art-bd-swirl)")).toBeNull();
  });

  it("loads the art once consent is given, without a reload, and drops it when it's taken back", async () => {
    const bd = await mount();
    const { setGamesAllowed } = await import("../../src/desktop/games/consent");
    await act(() => setGamesAllowed(true));
    await advance(50);
    expect(gamesDetails).toHaveBeenCalledTimes(1);
    expect(bd().classList.contains("blobs")).toBe(false);
    expect(container.querySelectorAll(".art-bd-layer:not(.art-bd-swirl)")).toHaveLength(2);
    await act(() => setGamesAllowed(false));
    await advance(50);
    expect(bd().classList.contains("blobs")).toBe(true);
    expect(container.querySelector(".art-bd-layer:not(.art-bd-swirl)")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("asks at once when Games was already allowed at start", async () => {
    allowed = true;
    const bd = await mount();
    expect(gamesDetails).toHaveBeenCalledTimes(1);
    expect(bd().classList.contains("blobs")).toBe(false);
  });
});
