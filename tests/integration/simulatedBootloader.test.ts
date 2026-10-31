// @vitest-environment jsdom
// The app's firmware update and first-time setup, end to end, against the
// simulated board (dev builds): the firmware card's offer → Update → the
// progress in the banner → waiting for the board → done with the version the
// new firmware reports; and every failure path in plain words. The board runs
// the same code the Developer card's "Simulated board" uses (one fake).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rp2350Uf2 } from "../support/uf2";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const NEW = "v0.9.5-oled-edition+0.abc1234";
let root: Root | null = null;
let container: HTMLDivElement;
let i18nNow: typeof import("../../src/i18n").default;

beforeAll(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_DEV_TOOLS", "1");
  // WebUSB present (the setup screen looks for a Pico only where it can).
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

// The main process as far as firmware goes: it offers 0.9.5 (bundled) and
// hands over `file` when asked for it.
function fakeDesktop(file: Uint8Array) {
  const known: Record<string, unknown> = {
    platform: "linux",
    getUpdateState: async () => ({ phase: "idle" }),
    getFirmwareHold: async () => ({ writing: false, restartQueued: false, quitQueued: false }),
    setFirmwareWriting: vi.fn(),
    latestFirmware: async () => ({ latest: { version: "0.9.5", source: "bundled" }, problem: null }),
    downloadFirmware: async (shown: { version: string }) => ({ ok: true, version: shown.version, bytes: file }),
    checkForUpdates: async () => ({ phase: "up-to-date", version: "0.9.5" }),
  };
  return new Proxy(known, {
    get: (t, p: string) => (/^on[A-Z]/.test(p) ? () => () => undefined : p in t ? t[p] : () => Promise.resolve({})),
  });
}

// A fresh app (module graph, simulated board from these Developer settings),
// rendered as DesktopApp composes the update UI: the banners on top; the
// Pico page's firmware card while the board is connected, nothing mid-update,
// and the setup screen otherwise.
async function start(opts: { board?: "dongle" | "bootsel"; version?: string; fault?: string; file?: Uint8Array } = {}) {
  localStorage.setItem("ds5.dev.simulated", "1");
  localStorage.setItem("ds5.dev.simSpeed", "normal");
  if (opts.board) localStorage.setItem("ds5.dev.simBoard", opts.board);
  if (opts.version !== undefined) localStorage.setItem("ds5.dev.simVersion", opts.version);
  if (opts.fault) localStorage.setItem("ds5.dev.simFault", opts.fault);
  vi.stubGlobal("desktop", fakeDesktop(opts.file ?? rp2350Uf2(NEW)));
  vi.resetModules();
  const i18n = (await import("../../src/i18n")).default;
  await i18n.changeLanguage("en");
  i18nNow = i18n;
  const { useDs5Bridge } = await import("../../src/hooks/useDs5Bridge");
  const { useAppUpdate, useFirmwareUpdate } = await import("../../src/desktop/useUpdates");
  const UpdateBanners = (await import("../../src/desktop/UpdateBanners")).default;
  const FirmwarePage = (await import("../../src/desktop/pages/FirmwarePage")).default;
  const SetupScreen = (await import("../../src/desktop/SetupScreen")).default;
  const Toasts = (await import("../../src/desktop/Toasts")).default;
  const { simulatedBoard } = await import("../../src/desktop/devPreview");
  function App() {
    const bridge = useDs5Bridge();
    const app = useAppUpdate();
    const fw = useFirmwareUpdate(bridge, app);
    const updating = fw.state.phase === "running" || fw.state.phase === "verifying" || fw.state.phase === "notStarted";
    return createElement(
      "div",
      null,
      createElement(UpdateBanners, { app, fw, onShowFirmware: () => undefined, onFirmwareChanges: () => undefined }),
      bridge.isConnected ? createElement(FirmwarePage, { bridge, fw }) : updating ? null : createElement(SetupScreen, { supported: bridge.supported }),
      createElement(Toasts),
    );
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(App)));
  await advance(1500);
  return simulatedBoard()!;
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const text = () => container.textContent ?? "";
function press(label: RegExp) {
  const b = [...container.querySelectorAll<HTMLButtonElement>("button")].find((x) => label.test(x.textContent?.trim() ?? ""));
  if (!b) throw new Error(`no ${label} button in: ${text()}`);
  act(() => b.click());
}
const update = () => {
  press(/^Update to 0\.9\.5$/);
  press(/^Install 0\.9\.5 now$/);
};
// What the app says, every 25 ms (each step its own act, so effects run as
// they would), until `until` shows up or `ms` pass.
async function watch(until: RegExp, ms = 30_000): Promise<string[]> {
  const seen: string[] = [];
  for (let t = 0; t < ms && !until.test(text()); t += 25) {
    await advance(25);
    if (seen.at(-1) !== text()) seen.push(text());
  }
  return seen;
}

describe("a firmware update against the simulated board", () => {
  it("runs from the card's offer through the progress to done, with the version the new firmware reports", async () => {
    const board = await start();
    expect(text()).toContain("v0.9.4-oled-edition");
    update();
    const seen = await watch(/Firmware updated to/);
    const said = seen.join("\n");
    expect(said).toContain("Waiting for the bootloader");
    // The progress moves in steps (64 KB pieces after the first sector; that
    // sector, written last, is a short final step at 98 % that may be too
    // brief to be seen).
    const pcts = [...said.matchAll(/ignore the RP2350 drive if it pops up (\d+)%/g)].map((m) => Number(m[1]));
    expect(pcts.slice(0, 4)).toEqual([0, 25, 50, 75]);
    expect(pcts.slice(4).every((p) => p === 98)).toBe(true);
    expect(said).toContain("Waiting for your board: press the PS button");
    expect(text()).toContain(`Firmware updated to ${NEW}.`);
    // The board came back with its controller already connected: a plain
    // confirmation, never "press PS" (not even for a moment).
    await advance(25);
    expect([...seen, text()].join("\n")).not.toContain("Press the PS button to reconnect");
    // Back on the card: the new version, nothing more to install.
    expect(text()).toContain(NEW);
    expect(text()).toContain("Up to date");
    // Remembered across the board's restarts and the app's.
    expect(board.version).toBe(NEW);
    expect(localStorage.getItem("ds5.dev.simVersion")).toBe(NEW);
    expect(localStorage.getItem("ds5.dev.simBoard")).toBe("dongle");
  });

  it("a write error partway: the plain-words error, then the setup screen installs it again", async () => {
    const board = await start({ fault: "write50" });
    update();
    await watch(/stopped before it finished/);
    expect(text()).toContain("The firmware update stopped before it finished, so your board is waiting in BOOTSEL mode with no firmware running.");
    expect(text()).not.toMatch(/dongle|LIBUSB/i);
    // Left in BOOTSEL with nothing to run: the setup screen offers the install.
    await advance(2000);
    expect(board.state).toBe("bootsel");
    expect(board.version).toBeNull();
    expect(text()).toContain("A Pico is ready to set up");
    board.fault = "";
    press(/^Install the firmware$/);
    await watch(/Now pair your controller/);
    expect(text()).toContain("Firmware 0.9.5 installed. Now pair your controller");
    await watch(new RegExp(NEW.replace(/[.+]/g, "\\$&")));
    expect(board.version).toBe(NEW);
  });

  it("a board that comes back with another version says so in the user's language", async () => {
    await start({ file: rp2350Uf2("v0.9.3-oled-edition+0.def5678") });
    update();
    await act(() => i18nNow.changeLanguage("de"));
    await watch(/Nach dem Neustart/);
    expect(text()).toContain(i18nNow.t("desktop.firmware.wrongVersion", { installed: "v0.9.3-oled-edition+0.def5678", expected: "0.9.5" }));
    expect(text()).not.toContain("came back reporting");
    await act(() => i18nNow.changeLanguage("en"));
  });

  it("a board that never shows up in BOOTSEL: the plain-words error after the wait", async () => {
    await start({ fault: "noBootsel" });
    update();
    await watch(/didn't show up in BOOTSEL/, 25_000);
    expect(text()).toContain("Your board didn't show up in BOOTSEL mode. Unplug it, hold its BOOTSEL button while plugging it back in, and try again.");
  });

  it("a board that doesn't come back after the update: keeps waiting and asks for the PS button", async () => {
    const board = await start({ fault: "noReturn" });
    update();
    await watch(/Waiting for your board/);
    await advance(46_000);
    expect(text()).toContain("Flashed. Press the PS button on the controller: your board comes back once a controller connects.");
    // The PS button (Developer card: Running firmware): it comes back with the new version.
    act(() => board.set("dongle"));
    await watch(/Firmware updated to/);
    expect(text()).toContain(`Firmware updated to ${NEW}.`);
    expect(text()).not.toContain("Press the PS button to reconnect");
  });

  it("back on USB before its controller: asks for the PS button until a controller connects, then confirms and clears", async () => {
    const board = await start({ fault: "noReturn" });
    update();
    await watch(/Waiting for your board/);
    await advance(46_000);
    // The board is back, its controller not (yet) connected.
    act(() => {
      board.set("dongle");
      board.dongle()!.controllerConnected = false;
    });
    await watch(/Press the PS button to reconnect/);
    expect(text()).toContain(`Firmware updated to ${NEW}. Press the PS button to reconnect the controller.`);
    // The controller connects: no more "press PS", a confirmation that clears itself.
    board.dongle()!.controllerConnected = true;
    await watch(/^(?![\s\S]*Press the PS button to reconnect)/);
    expect(text()).not.toContain("Press the PS button to reconnect");
    expect(container.querySelector(".dk-toast")?.textContent).toContain(`Firmware updated to ${NEW}.`);
    await advance(30_000);
    expect(text()).not.toContain("Firmware updated to");
  });

  it("an image that won't start (Developer card): says plainly the firmware didn't start, and Install again installs it", async () => {
    const board = await start({ fault: "noStart" });
    update();
    const seen = await watch(/didn't start/, 10_000);
    // Said within seconds of the restart, never the long wait and the PS button.
    expect(seen.join("\n")).not.toContain("Flashed. Press the PS button");
    expect(text()).toContain("The new firmware didn't start: your board came back in BOOTSEL mode, still waiting for firmware. Keep it plugged in and install it again.");
    expect(text()).not.toMatch(/dongle/i);
    expect(board.state).toBe("bootsel");
    // The banner's Install again is the one offer (the setup screen's stays out of the way).
    expect(text()).not.toContain("A Pico is ready to set up");
    // A good image this time (Developer card: no failure): it installs and the board comes back with it.
    board.fault = "";
    press(/^Install again$/);
    await watch(/Firmware updated to/);
    expect(text()).toContain(`Firmware updated to ${NEW}.`);
    expect(board.state).toBe("dongle");
    expect(board.version).toBe(NEW);
  });

  it("an image that won't start, installed again and still not starting: says so again", async () => {
    await start({ fault: "noStart" });
    update();
    await watch(/didn't start/, 10_000);
    press(/^Install again$/);
    await watch(/Waiting for your board/);
    expect(text()).not.toContain("didn't start");
    await watch(/didn't start/, 10_000);
    expect(text()).toContain("The new firmware didn't start");
  });

  it("the wrong file (another chip's UF2): refused in plain words, the board untouched", async () => {
    const board = await start({ file: rp2350Uf2(NEW, { family: "rp2040" }) });
    update();
    await watch(/isn't firmware for/);
    expect(text()).toContain("This file isn't firmware for your board (it's for another chip, or damaged), so nothing was written.");
    expect(board.state).toBe("dongle");
    expect(board.version).toBe("v0.9.4-oled-edition+12.a1b2c3d.dirty+simulated");
  });

  it("an image the boot ROM won't start (no IMAGE_DEF): the board stays in BOOTSEL, and setup says the firmware didn't start", async () => {
    const board = await start({ board: "bootsel", version: "", file: rp2350Uf2(NEW, { imageDef: false }) });
    press(/^Install the firmware$/);
    const seen = await watch(/didn't start/, 6000);
    expect(seen.join("\n")).toContain("Firmware 0.9.5 installed");
    expect(board.state).toBe("bootsel");
    expect(text()).toContain("A Pico is ready to set up");
    expect(text()).toContain("The new firmware didn't start: your board came back in BOOTSEL mode");
    // Offered again, under its own name.
    press(/^Install again$/);
    await watch(/Installing the firmware/, 2000);
    expect(text()).not.toContain("didn't start");
    await watch(/didn't start/, 6000);
    expect(text()).toContain("The new firmware didn't start");
    expect(board.state).toBe("bootsel");
  });
});

describe("first-time setup against a blank simulated Pico", () => {
  it("finds the Pico, installs the bundled firmware with progress, and the board connects with it", async () => {
    const board = await start({ board: "bootsel", version: "" });
    expect(text()).toContain("A Pico is ready to set up");
    expect(text()).toContain("Install firmware 0.9.5, included with this app");
    press(/^Install the firmware$/);
    const seen = await watch(/Now pair your controller/);
    expect(seen.join("\n")).toContain("Installing the firmware…");
    expect(container.querySelector("progress")).toBeNull();
    // Never "ready to set up" again while the flashed Pico restarts.
    const after = await watch(/Up to date/);
    expect(after.join("\n")).not.toContain("A Pico is ready to set up");
    expect(text()).toContain(NEW);
    expect(board.state).toBe("dongle");
  });
});
