// @vitest-environment jsdom
// Error pass batch E3 (docs/ERROR_PASS_2026-10.md): the main process and the
// protocol code used to put English on screen whatever the language (USB
// setup, the Windows repair, Proton install, Undo, scan and board errors, the
// start-failure dialog). They now send keyed text (src/errorText.ts), which
// the page says in the user's language. Each test fails the call and checks
// the words on screen, in German.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { causeText, shownText } from "../../src/desktop/shownError";
import { errorText, KeyedError, keyedText, translateKeyed } from "../../src/errorText";
import UsbAccessSetup from "../../src/desktop/UsbAccessSetup";
import GamesPage from "../../src/desktop/pages/GamesPage";
import { mainText } from "../../electron/main/mainText";
import { DeviceGoneError, ReportStalledError } from "../../src/protocol/transport";
import { fakeBridge } from "../support/gamePage";
import { homeDesktop, homeLibrary, homeReport } from "../support/gamesHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const de = (key: string, params: Record<string, unknown> = {}) => i18n.t(key, { ...params, lng: "de", interpolation: { escapeValue: false } });

describe("keyed text", () => {
  it("survives a value with brackets and a cause inside a message", () => {
    const inner = keyedText("desktop.errors.main.downloadHttp", { status: 503 });
    const text = keyedText("desktop.usbAccess.result.failed", { detail: `odd ⟧ value ${inner}` });
    const seen: Array<[string, Record<string, string | number>]> = [];
    const out = translateKeyed(`before ${text} after`, (key, params) => (seen.push([key, params]), `<${key}>`));
    expect(out).toBe("before <desktop.usbAccess.result.failed> after");
    expect(seen).toEqual([
      ["desktop.errors.main.downloadHttp", { status: 503 }],
      ["desktop.usbAccess.result.failed", { detail: "odd ⟧ value <desktop.errors.main.downloadHttp>" }],
    ]);
  });

  it("a main-process error over IPC is said in the user's language", () => {
    const thrown = new KeyedError("desktop.errors.main.diskSpace", { dir: "/home/me/.steam", gb: 2 });
    const overIpc = new Error(`Error invoking remote method 'desktop:install-proton': Error: ${errorText(thrown)}`);
    expect(causeText(overIpc)).toBe(de("desktop.errors.main.diskSpace", { dir: "/home/me/.steam", gb: 2 }));
    expect(causeText(overIpc)).toContain("Nicht genug Speicherplatz");
  });

  it("a board error from the protocol code is said in the user's language", () => {
    expect(causeText(new KeyedError("desktop.errors.board.noOledKeys"))).toBe(de("desktop.errors.board.noOledKeys"));
    expect(causeText(new KeyedError("desktop.errors.board.protocol", { have: "2.0", need: "1.x" }))).toContain("2.0");
  });

  it("the transport's own errors (the board gone, a refused report) are said in the user's language", () => {
    expect(causeText(new DeviceGoneError())).toBe(de("desktop.errors.usb.gone"));
    expect(causeText(new ReportStalledError(0xf6))).toBe(de("desktop.errors.board.stalled", { report: "0xF6" }));
    expect(causeText(new KeyedError("desktop.errors.board.normalNotRestored"))).toBe(de("desktop.errors.board.normalNotRestored"));
    // loop: test — 2 errors
    for (const e of [new DeviceGoneError(), new ReportStalledError(0xf6)]) expect(causeText(e)).not.toMatch(/Your board|refused report/);
  });

  it("WebUSB's English errors are said by kind", () => {
    expect(causeText(new DOMException("Unable to claim interface.", "NetworkError"))).toBe(de("desktop.errors.usb.network"));
    expect(causeText(new DOMException("Access denied.", "SecurityError"))).toBe(de("desktop.errors.usb.security"));
  });

  it("every key the main process or the protocol code sends is in all 7 languages", () => {
    const files = (dir: string): string[] =>
      // loop: test — the source tree
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
    const keys = new Set<string>();
    // loop: test — every source file
    for (const file of [...files("src"), ...files("electron")]) for (const m of readFileSync(file, "utf8").matchAll(/(?:KeyedError|keyedText)\(\s*"([\w.]+)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(40);
    // loop: test — 7 locales
    for (const lng of ["en", "de", "es", "fr", "ja", "pt-BR", "zh-CN"]) {
      const strings = JSON.parse(readFileSync(`src/i18n/locales/${lng}.json`, "utf8")) as Record<string, unknown>;
      const missing = [...keys].filter((k) => typeof k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], strings) !== "string");
      expect(missing, lng).toEqual([]);
    }
  });
});

describe("on screen, in German", () => {
  it("Set up USB access: a failed setup", async () => {
    vi.stubGlobal("desktop", {
      platform: "linux",
      usbAccessInstalled: () => Promise.resolve(false),
      setupUsbAccess: () => Promise.resolve({ ok: false, message: keyedText("desktop.usbAccess.result.noUdevadm") }),
    });
    act(() => root.render(createElement(UsbAccessSetup)));
    await settle();
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(container.textContent).toContain(de("desktop.usbAccess.result.noUdevadm"));
    expect(container.textContent).not.toContain("isn't installed");
  });

  it("Games → Undo that fails with the main process's error", async () => {
    const report = homeReport("healthy");
    const base = homeDesktop("healthy", [], report) as Record<string, unknown>;
    const overrides: Record<string, unknown> = { gamesUndo: () => Promise.resolve({ ok: false, error: keyedText("desktop.errors.main.alreadyUndone") }) };
    vi.stubGlobal("desktop", new Proxy(overrides, { get: (t, p: string) => (p in t ? t[p] : base[p]) }));
    act(() =>
      root.render(
        createElement(GamesPage, {
          allowed: true,
          onAllowedChange: () => undefined,
          bridge: fakeBridge(),
          profiles: { library: homeLibrary(report.games), setLibrary: () => undefined, running: null } as never,
        }),
      ),
    );
    await settle();
    await settle();
    const head = container.querySelector<HTMLButtonElement>('[data-section="history"] .dk-sec-toggle')!;
    if (head.getAttribute("aria-expanded") !== "true") act(() => head.click());
    const history = container.querySelector('[data-section="history"] .dk-sec-body')!;
    act(() => [...history.querySelectorAll("button")].find((b) => b.textContent === de("desktop.games.undoShort"))!.click());
    await settle();
    await settle();
    expect(container.textContent).toContain(de("desktop.errors.main.alreadyUndone"));
    expect(container.textContent).not.toContain("⟦");
  });

  it("an app update that fails says why in the user's language", () => {
    const detail = `${keyedText("desktop.errors.main.downloadStalled")} ${keyedText("desktop.update.untouched")}`;
    expect(shownText(detail)).toBe(`${de("desktop.errors.main.downloadStalled")} ${de("desktop.update.untouched")}`);
  });
});

describe("the start-failure dialog (main process, no page)", () => {
  it("is in the system's language, with the cause translated too", async () => {
    const text = await mainText(keyedText("desktop.errors.main.startFailed", { detail: keyedText("desktop.errors.main.bundledDamaged") }), "de-DE");
    expect(text).toBe(de("desktop.errors.main.startFailed", { detail: de("desktop.errors.main.bundledDamaged") }));
  });

  it("falls back to English for a language the app doesn't have, and fills the board's name", async () => {
    expect(await mainText(keyedText("desktop.errors.main.startFailed", { detail: "EACCES" }), "ko")).toBe(i18n.t("desktop.errors.main.startFailed", { lng: "en", detail: "EACCES" }));
    expect(await mainText(keyedText("desktop.usbAccess.result.done"), "en-US")).toBe(
      "USB access is set up for this app and your games. If the app still can't reach your board, unplug it and plug it back in.",
    );
    expect(await mainText(keyedText("desktop.errors.board.short"), "fr")).toMatch(/^Ta carte a envoyé/);
  });
});
