// @vitest-environment jsdom
// The board held by another program (a second copy of the app, a browser tab
// with a WebUSB page; on Windows maybe the driver): WebUSB's claimInterface
// fails with "Unable to claim interface". The app says so in plain words,
// names the holder where the main process can (Linux), offers Retry, and
// connects by itself once the other program lets go. Against the simulated
// board (dev builds), with its dongle held by "another program".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BoardHolder } from "../../src/desktop/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

beforeAll(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  Object.defineProperty(navigator, "usb", { configurable: true, value: Object.assign(new EventTarget(), { getDevices: async () => [] }) });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterAll(() => {
  delete (navigator as { usb?: unknown }).usb;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  localStorage.clear();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const text = () => container.textContent ?? "";

async function start(opts: { platform: string; holders: BoardHolder[]; lng?: string }) {
  localStorage.setItem("ds5.dev.simulated", "1");
  const boardHolders = vi.fn(async () => opts.holders);
  vi.stubGlobal(
    "desktop",
    new Proxy({ platform: opts.platform, boardHolders } as Record<string, unknown>, {
      get: (t, p: string) => (/^on[A-Z]/.test(p) ? () => () => undefined : p in t ? t[p] : () => Promise.resolve({})),
    }),
  );
  vi.resetModules();
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage(opts.lng ?? "en");
  const { useDs5Bridge, BUSY_RETRY_MS } = await import("../../src/hooks/useDs5Bridge");
  const BoardBusyNotice = (await import("../../src/desktop/BoardBusyNotice")).default;
  const { simulatedBoard } = await import("../../src/desktop/devPreview");
  const dongle = simulatedBoard()!.dongle()!;
  dongle.heldByOther = true; // another program has it before the app starts
  const seen: { connected: boolean; error: string | null } = { connected: false, error: null };
  function App() {
    const bridge = useDs5Bridge();
    seen.connected = bridge.isConnected;
    seen.error = bridge.error;
    return createElement(BoardBusyNotice, { busy: bridge.busy, onRetry: bridge.retryBusy });
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(App)));
  await advance(50);
  return { dongle, seen, boardHolders, BUSY_RETRY_MS, t: (k: string, o?: Record<string, unknown>) => i18n.t(k, o) };
}

describe("the board held by another program", () => {
  it("names the holder (Linux), keeps the raw error out, and connects by itself once it's free", async () => {
    const { dongle, seen, boardHolders, BUSY_RETRY_MS, t } = await start({ platform: "linux", holders: [{ pid: 4242, name: "chrome", kind: "browser" }] });
    expect(seen.connected).toBe(false);
    expect(seen.error).toBeNull(); // no "Unable to claim interface"
    expect(text()).toContain(t("desktop.boardBusy.title"));
    expect(text()).toContain("In use by: chrome (a browser tab).");
    expect(text()).toContain(t("desktop.boardBusy.closeIt"));
    expect(text()).not.toMatch(/claim|dongle/i);
    expect(boardHolders).toHaveBeenCalledTimes(1);

    // Still held: the next tries fail quietly, the notice stays, the holder isn't looked up again.
    await advance(BUSY_RETRY_MS * 2 + 100);
    expect(seen.connected).toBe(false);
    expect(text()).toContain(t("desktop.boardBusy.title"));
    expect(boardHolders).toHaveBeenCalledTimes(1);

    // The other program lets go: the next try connects, the notice goes.
    dongle.heldByOther = false;
    await advance(BUSY_RETRY_MS + 500);
    expect(seen.connected).toBe(true);
    expect(container.querySelector('[data-testid="board-busy"]')).toBeNull();
  });

  it("Retry tries now; with no holder named, it says who usually holds it", async () => {
    const { dongle, seen, t } = await start({ platform: "darwin", holders: [] });
    expect(text()).toContain(t("desktop.boardBusy.suspects"));
    expect(text()).not.toContain(t("desktop.boardBusy.windowsDriver"));
    dongle.heldByOther = false;
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(t("desktop.boardBusy.retry")))!;
    act(() => retry.click());
    await advance(50); // well before the automatic retry
    expect(seen.connected).toBe(true);
    expect(text()).toBe("");
  });

  it("names another copy of the app, and on Windows mentions the driver, in German", async () => {
    const { t } = await start({ platform: "win32", holders: [{ pid: 7, name: "ds5-dongle-configurator", kind: "app" }], lng: "de" });
    expect(text()).toContain(t("desktop.boardBusy.heldBy", { names: t("desktop.boardBusy.kind.app") }));
    expect(text()).toContain("eine andere Kopie dieser App");
    expect(text()).toContain(t("desktop.boardBusy.windowsDriver"));
    expect(text()).not.toContain("⟦");
  });
});
