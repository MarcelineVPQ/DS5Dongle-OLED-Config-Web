// @vitest-environment jsdom
// Several boards on one PC (1, 2 or 20), against simulated boards: each has
// its own board id (protocol 1.20) and, like boards paired to one DualSense,
// every other one has the same USB serial. The app shows the last board used
// (else the first), flashes its "THIS ONE" screen, lists every board in the
// rail's stack (three rows, the rest in a searchable list), switches on a
// click, and a firmware update writes only the bootloader of the board it
// rebooted, never a guess.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PicoflashHandle } from "../../src/flash";

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
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = null;
  container?.remove();
  localStorage.clear();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

// `boards` simulated boards (the first plus extras), the app's hook and its rail.
async function start(boards: number, lastBoardId?: string) {
  localStorage.setItem("ds5.dev.simulated", "1");
  localStorage.setItem("ds5.dev.simExtraBoards", String(boards - 1));
  if (lastBoardId) localStorage.setItem("ds5.lastBoardId", lastBoardId);
  vi.stubGlobal(
    "desktop",
    new Proxy({ platform: "linux" } as Record<string, unknown>, {
      get: (t, p: string) => (/^on[A-Z]/.test(p) ? () => () => undefined : p in t ? t[p] : () => Promise.resolve({})),
    }),
  );
  vi.resetModules();
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  const { useDs5Bridge } = await import("../../src/hooks/useDs5Bridge");
  const AppRail = (await import("../../src/desktop/AppRail")).default;
  const devPreview = await import("../../src/desktop/devPreview");
  const sims = [devPreview.simulatedBoard()!.dongle()!, ...devPreview.extraSimulatedBoards()];
  const seen: { bridge: ReturnType<typeof useDs5Bridge> | null } = { bridge: null };
  function App() {
    const bridge = useDs5Bridge();
    seen.bridge = bridge;
    return createElement(AppRail, {
      active: "controller",
      onSelect: () => undefined,
      gamesSupported: false,
      reminders: {},
      connected: bridge.isConnected,
      connecting: false,
      firmware: bridge.firmwareVersion,
      deviceLabel: bridge.deviceLabel,
      device: "Pico 2 W",
      boards: bridge.boards,
      currentBoard: bridge.currentBoard,
      onBoard: (key: string) => void bridge.selectBoard(key),
    });
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(App)));
  await advance(200);
  return { sims, seen, devPreview, t: (k: string, o?: Record<string, unknown>) => i18n.t(k, o) };
}

const rows = () => [...container.querySelectorAll<HTMLButtonElement>(".rail-board")];

describe("several boards", () => {
  it("two boards with the same controller (same serial): two rows, told apart by board id; the first is shown and flashes", async () => {
    const { sims, seen } = await start(2);
    expect(sims[0].serial).toBe(sims[1].serial); // the controller's MAC
    expect(sims[0].boardId).not.toBe(sims[1].boardId);
    const bridge = seen.bridge!;
    expect(bridge.isConnected).toBe(true);
    expect(bridge.boards).toHaveLength(2);
    expect(new Set(bridge.boards.map((b) => b.boardId)).size).toBe(2);
    expect(bridge.currentBoard).toBe("sim-0");
    expect(sims[0].identifies).toEqual([30]); // the board now in use says so on its OLED
    expect(sims[1].identifies).toEqual([]);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].getAttribute("aria-current")).toBe("true");
    expect(rows()[1].getAttribute("aria-current")).toBeNull();
    expect(container.textContent).toContain("2 boards connected");
    expect(localStorage.getItem("ds5.lastBoardId")).toBe(sims[0].boardId);
  });

  it("shows the last board used when it's there", async () => {
    const { devPreview, seen, sims } = await start(3, "E66141030000" + "0002");
    expect(seen.bridge!.currentBoard).toBe("sim-2");
    expect(seen.bridge!.identity?.boardId).toBe(devPreview.simBoardId(2));
    expect(sims[2].identifies).toEqual([30]);
  });

  it("a click on another row switches to it and flashes it; on the board in use it only flashes", async () => {
    const { seen, sims } = await start(2);
    await act(async () => rows()[1].click());
    await advance(200);
    expect(seen.bridge!.currentBoard).toBe("sim-1");
    expect(seen.bridge!.identity?.boardId).toBe(sims[1].boardId);
    expect(sims[1].identifies).toEqual([30]);
    expect(localStorage.getItem("ds5.lastBoardId")).toBe(sims[1].boardId);
    const current = rows().find((r) => r.getAttribute("aria-current") === "true")!;
    await act(async () => current.click());
    await advance(100);
    expect(seen.bridge!.currentBoard).toBe("sim-1");
    expect(sims[1].identifies).toEqual([30, 30]);
  });

  it("20 boards: three rows, the rest in a searchable list; picking one there switches to it", async () => {
    const { seen, sims, devPreview } = await start(20);
    expect(seen.bridge!.boards).toHaveLength(20);
    expect(rows()).toHaveLength(3);
    // jsdom hides a [popover] element from focus (no Popover API): leave the attribute off, as accordion.test.ts does.
    const set = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
      if (name !== "popover") set.call(this, name, value);
    });
    const more = container.querySelector<HTMLButtonElement>(".rail-boards-more")!;
    expect(more.textContent).toContain("17 more…");
    await act(async () => more.click());
    const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items()).toHaveLength(20);
    expect(document.activeElement?.getAttribute("type")).toBe("search"); // the search field takes the keyboard
    const search = document.querySelector<HTMLInputElement>(".rail-boards-search")!;
    const want = devPreview.simBoardId(13);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, want.slice(-4));
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(items()).toHaveLength(1);
    await act(async () => items()[0].click());
    await advance(300);
    expect(seen.bridge!.currentBoard).toBe("sim-13");
    expect(sims[13].identifies).toEqual([30]);
    // The board in use stays among the rows.
    expect(rows().some((r) => r.getAttribute("aria-current") === "true")).toBe(true);
  });

  it("the simulated board is marked as simulated, never a green check", async () => {
    const { t } = await start(2);
    expect(rows()[0].textContent).toContain(t("desktop.boards.simulated"));
    expect(rows()[0].classList.contains("sim")).toBe(true);
    expect(rows()[0].textContent).not.toContain("✓");
  });

  it("one real-looking board: the single status line, as before (no stack)", async () => {
    localStorage.setItem("ds5.dev.simulated", "0");
    vi.resetModules();
    const AppRail = (await import("../../src/desktop/AppRail")).default;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const one = [
      {
        key: "usb-0",
        kind: "usb" as const,
        reach: "ok" as const,
        boardId: "X",
        serial: "S",
        name: "Pico 2 W",
        version: "v",
        slot: 0,
        controllerConnected: true,
        model: null,
        colorwayCode: null,
        identifies: true,
      },
    ];
    act(() =>
      root!.render(
        createElement(AppRail, {
          active: "controller",
          onSelect: () => undefined,
          gamesSupported: false,
          reminders: {},
          connected: true,
          connecting: false,
          firmware: "v",
          deviceLabel: "",
          device: "Pico 2 W",
          boards: one,
          currentBoard: "usb-0",
          onBoard: () => undefined,
        }),
      ),
    );
    expect(rows()).toHaveLength(0);
    expect(container.querySelector('.rail-status[role="status"]')).not.toBeNull();
  });
});

describe("a firmware update with several boards in BOOTSEL", () => {
  const fake = (serial: string): PicoflashHandle => ({
    getTarget: () => ({ toString: () => "RP2350" }),
    getUsbDeviceInfo: () => ({ vendorId: 0x2e8a, productId: 0x000f, serialNumber: serial }),
    isConnected: () => false,
    connect: async () => undefined,
    disconnect: async () => undefined,
    flashEraseAndWrite: async () => undefined,
    rebootRp2350: async () => undefined,
  });

  it("takes the rebooted board's bootloader by its id, with 19 others already in BOOTSEL", async () => {
    await start(1);
    const flash = await import("../../src/flash");
    const others = Array.from({ length: 19 }, (_, i) => fake(`AAAA0000000000${i.toString(16).padStart(2, "0")}`));
    vi.spyOn(flash.PicoflashAPI, "getDevices").mockResolvedValue(others);
    const { waitForBootloader } = await import("../../src/desktop/firmwareUpdate");
    const { simulatedBoard } = await import("../../src/desktop/devPreview");
    const sim = simulatedBoard()!;
    const before = new Set(others.map((o) => o.getUsbDeviceInfo().serialNumber));
    act(() => sim.enterBootsel());
    const found = waitForBootloader(sim.boardId, before, 5000);
    await advance(3000);
    expect((await found).getUsbDeviceInfo().serialNumber).toBe(sim.boardId);
  });

  it("several new ones it can't tell apart: stops with the keyed message, writes nothing", async () => {
    await start(1);
    const flash = await import("../../src/flash");
    const { waitForBootloader, onlyBootloader } = await import("../../src/desktop/firmwareUpdate");
    const { simulatedBoard } = await import("../../src/desktop/devPreview");
    simulatedBoard()!.set("away"); // the simulated one isn't in BOOTSEL
    vi.spyOn(flash.PicoflashAPI, "getDevices").mockResolvedValue([fake("AAAA000000000001"), fake("BBBB000000000002")]);
    await expect(waitForBootloader("E66141030000FFFF", new Set(), 2000)).rejects.toMatchObject({ key: "desktop.firmware.severalBootsel" });
    await expect(onlyBootloader(null)).rejects.toMatchObject({ key: "desktop.firmware.severalBootsel" });
    await expect(onlyBootloader("BBBB000000000002")).resolves.toMatchObject({}); // identified by id: fine
    vi.spyOn(flash.PicoflashAPI, "getDevices").mockResolvedValue([fake("AAAA000000000001")]);
    expect((await onlyBootloader(null)).getUsbDeviceInfo().serialNumber).toBe("AAAA000000000001"); // only one: it
  });
});
