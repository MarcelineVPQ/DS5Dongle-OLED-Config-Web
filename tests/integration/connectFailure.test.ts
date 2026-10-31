// @vitest-environment jsdom
// A connect that fails (bug hunt C3): the app lets go of the board in every
// failure, not only when another program holds it, so nothing stays claimed;
// a passing error (the board slow to answer) is tried once more, quietly; a
// protocol mismatch is not tried again. Against the simulated board.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SimulatedDongle } from "../../src/protocol/simulatedDongle";

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

// The app's bridge against the simulated board, after `prepare` set up how its firmware misbehaves.
async function start(prepare: (dongle: SimulatedDongle, KeyedError: typeof import("../../src/errorText").KeyedError) => void) {
  localStorage.setItem("ds5.dev.simulated", "1");
  vi.stubGlobal(
    "desktop",
    new Proxy({ platform: "linux" } as Record<string, unknown>, {
      get: (t, p: string) => (/^on[A-Z]/.test(p) ? () => () => undefined : p in t ? t[p] : () => Promise.resolve({})),
    }),
  );
  vi.resetModules();
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  const { KeyedError } = await import("../../src/errorText");
  const { useDs5Bridge } = await import("../../src/hooks/useDs5Bridge");
  const { simulatedBoard } = await import("../../src/desktop/devPreview");
  const dongle = simulatedBoard()!.dongle()!;
  const opens = { count: 0 };
  const open = dongle.open.bind(dongle);
  dongle.open = () => {
    opens.count++;
    return open();
  };
  prepare(dongle, KeyedError);
  const seen: { connected: boolean; error: string | null } = { connected: false, error: null };
  function App() {
    const bridge = useDs5Bridge();
    seen.connected = bridge.isConnected;
    seen.error = bridge.error;
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(App)));
  await advance(1000);
  return { dongle, seen, opens, t: (k: string, o?: Record<string, unknown>) => i18n.t(k, o) };
}

// The settings read (0xF7) answers `fail` for its first `times` calls.
function failConfigRead(dongle: SimulatedDongle, fail: () => Error, times: number) {
  const getReport = dongle.getReport.bind(dongle);
  let left = times;
  dongle.getReport = (id, length) => (id === 0xf7 && left-- > 0 ? Promise.reject(fail()) : getReport(id, length));
}

describe("a connect that fails", () => {
  it("a board slow to answer once: tried again quietly, and it connects with no error", async () => {
    const { dongle, seen, opens } = await start((d, KeyedError) => failConfigRead(d, () => new KeyedError("desktop.errors.board.timeout"), 1));
    expect(seen.connected).toBe(true);
    expect(seen.error).toBeNull();
    expect(opens.count).toBe(2);
    expect(dongle.isOpen).toBe(true);
  });

  it("a board that stays slow: one retry only, then the error, and the board isn't left claimed", async () => {
    const { dongle, seen, opens, t } = await start((d, KeyedError) => failConfigRead(d, () => new KeyedError("desktop.errors.board.timeout"), 5));
    expect(seen.connected).toBe(false);
    expect(seen.error).toBe(t("desktop.errors.board.timeout"));
    expect(opens.count).toBe(2);
    expect(dongle.isOpen).toBe(false);
  });

  it("a protocol mismatch: not tried again, the board let go, the error says to update", async () => {
    const { dongle, seen, opens, t } = await start((d) => {
      const getReport = d.getReport.bind(d);
      d.getReport = async (id, length) => {
        const out = await getReport(id, length);
        if (id === 0xf1) out[4] = 2; // protocol 2.x
        return out;
      };
    });
    expect(seen.connected).toBe(false);
    expect(seen.error).toContain("2.");
    expect(seen.error).toBe(t("desktop.errors.board.protocol", { have: `2.${21}`, need: "1.x", interpolation: { escapeValue: false } }));
    expect(opens.count).toBe(1);
    expect(dongle.isOpen).toBe(false);
  });
});
