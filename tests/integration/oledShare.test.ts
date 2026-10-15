// @vitest-environment jsdom
// Share your OLED on the Pico 2 W page (OledShare.tsx): Save PNG and Copy
// hand the main process a real PNG, Record GIF keeps only the mirror frames
// that changed and stops by itself at 10 s, and every failure is shown in
// plain words on the bar's status line (the error pass).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { BAD_REQUEST, type DesktopApi } from "../../src/desktop/api";
import type { OledFrame } from "../../src/protocol/bridgeClient";
import { GIF_MAX_MS, ShareTooBig, encodeShare, hasMagic } from "../../src/oled/oledShare";

// The worker isn't in jsdom: encode on the spot (the same function the worker runs).
const encode = vi.fn(encodeShare);
vi.mock("../../src/desktop/dongle/shareEncode", () => ({ encodeOffThread: (req: Parameters<typeof encodeShare>[0]) => encode(req) }));
const { default: OledShare } = await import("../../src/desktop/dongle/OledShare");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = (seed: number, contrast = 255): OledFrame => ({ power: "on", screen: 0, contrast, seq: seed, pixels: Uint8Array.from({ length: 1024 }, (_, i) => (i * 7 + seed) & 0xff) });

let container: HTMLDivElement;
let root: Root;
let saveOledImage: ReturnType<typeof vi.fn<DesktopApi["saveOledImage"]>>;
let copyOledImage: ReturnType<typeof vi.fn<DesktopApi["copyOledImage"]>>;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  encode.mockImplementation(encodeShare);
  saveOledImage = vi.fn<DesktopApi["saveOledImage"]>(() => Promise.resolve({ saved: true, name: "ds5-oled.png" }));
  copyOledImage = vi.fn<DesktopApi["copyOledImage"]>(() => Promise.resolve());
  window.desktop = { saveOledImage, copyOledImage } as unknown as DesktopApi;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.desktop;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const render = (f: OledFrame | null) => act(() => root.render(createElement(OledShare, { frame: f })));
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(label))!;
const click = async (label: string) => {
  await act(async () => {
    button(label).click();
    await new Promise((r) => setTimeout(r, 0));
  });
};
// Encoding (zlib on a stream) takes a few turns: wait until the bar isn't busy.
const settle = async () => {
  // loop: test — short turns until the encode and save settle (≤ 3 s)
  for (let i = 0; i < 300 && (i === 0 || statusText() === i18n.t("desktop.oledShare.working")); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
};
const statusText = () => container.querySelector(".oled-share-status")?.textContent ?? "";

describe("Share your OLED", () => {
  it("Share opens the bar; Save PNG sends a real PNG (4x, framed by default) and says where", async () => {
    render(frame(1));
    expect(container.querySelector(".oled-share")).toBeNull();
    await click("Share");
    expect(button("Share").getAttribute("aria-expanded")).toBe("true");
    expect(statusText()).toBe("596 × 296");
    await click("Save PNG");
    await settle();
    expect(saveOledImage).toHaveBeenCalledTimes(1);
    const { kind, bytes } = saveOledImage.mock.calls[0][0];
    expect(kind).toBe("png");
    expect(hasMagic(bytes, "png")).toBe(true);
    expect(encode.mock.calls[0][0]).toMatchObject({ kind: "png", scale: 4, framed: true });
    expect(statusText()).toBe(i18n.t("desktop.oledShare.saved", { name: "ds5-oled.png" }));
  });

  it("the size and frame choices reach the encoder; a cancelled dialog says nothing", async () => {
    saveOledImage.mockResolvedValue({ saved: false });
    render(frame(1));
    await click("Share");
    await click("8×");
    act(() => container.querySelector<HTMLInputElement>(".oled-share-frame input")!.click());
    expect(statusText()).toBe("1024 × 512");
    await click("Save PNG");
    await settle();
    expect(encode.mock.calls[0][0]).toMatchObject({ kind: "png", scale: 8, framed: false });
    expect(statusText()).toBe("1024 × 512");
  });

  it("Copy puts a PNG on the clipboard; a failure is shown in plain words", async () => {
    render(frame(1));
    await click("Share");
    await click("Copy");
    await settle();
    expect(hasMagic(copyOledImage.mock.calls[0][0], "png")).toBe(true);
    expect(statusText()).toBe(i18n.t("desktop.oledShare.copied"));
    copyOledImage.mockRejectedValueOnce(new Error("Error invoking remote method 'desktop:copy-oled-image': Error: The picture couldn't be read for the clipboard"));
    await click("Copy");
    await settle();
    expect(statusText()).toContain(i18n.t("desktop.oledShare.errors.copy", { reason: "The picture couldn't be read for the clipboard" }));
  });

  it("a refused or failed save says so plainly", async () => {
    saveOledImage.mockRejectedValueOnce(new Error(`Error invoking remote method 'desktop:save-oled-image': Error: ${BAD_REQUEST}`));
    render(frame(1));
    await click("Share");
    await click("Save PNG");
    await settle();
    expect(statusText()).toContain(i18n.t("desktop.oledShare.errors.save", { reason: i18n.t("desktop.errors.badRequest").replace(/\.$/, "") }));
    expect(statusText()).not.toMatch(/DS5_BAD_REQUEST|dongle/i);
  });

  it("a file over its cap says to pick a smaller size", async () => {
    encode.mockRejectedValueOnce(new ShareTooBig(8 * 1024 * 1024));
    render(frame(1));
    await click("Share");
    await click("Save PNG");
    await settle();
    expect(statusText()).toContain(i18n.t("desktop.oledShare.errors.tooBig", { mb: 8 }));
    expect(saveOledImage).not.toHaveBeenCalled();
  });

  it("nothing to share without a picture: the actions wait for the screen", async () => {
    render(null);
    await click("Share");
    expect(button("Save PNG").disabled).toBe(true);
    expect(button("Copy").disabled).toBe(true);
    expect(button("Record GIF").disabled).toBe(true);
    expect(statusText()).toBe(i18n.t("desktop.oledShare.noPicture"));
  });

  it("Record GIF keeps only changed pictures, shows it's recording, and saves a GIF on Stop", async () => {
    render(frame(1));
    await click("Share");
    await click("Record GIF");
    expect(container.querySelector(".oled-share-rec")?.textContent).toBe(i18n.t("desktop.oledShare.recording", { s: 0, max: 10, n: 1 }));
    expect(button("Share").disabled).toBe(true);
    render(frame(2));
    render({ ...frame(2), seq: 99 }); // same picture, new frame counter: not a frame
    render(frame(3, 63));
    expect(container.querySelector(".oled-share-rec")?.textContent).toContain("3 frames");
    await click("Stop and save");
    await settle();
    const req = encode.mock.calls[0][0];
    expect(req.kind).toBe("gif");
    expect(req.kind === "gif" && req.frames.length).toBe(3);
    const { kind, bytes } = saveOledImage.mock.calls[0][0];
    expect(kind).toBe("gif");
    expect(hasMagic(bytes, "gif")).toBe(true);
    expect(container.querySelector(".oled-share-rec")).toBeNull();
  });

  it("stops by itself at 10 s; Cancel throws the recording away", async () => {
    render(frame(1));
    await click("Share");
    vi.useFakeTimers();
    act(() => button("Record GIF").click());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(container.querySelector(".oled-share-rec")?.textContent).toBe(i18n.t("desktop.oledShare.recording", { s: 3, max: 10, n: 1 }));
    await act(() => vi.advanceTimersByTimeAsync(GIF_MAX_MS));
    expect(container.querySelector(".oled-share-rec")).toBeNull();
    expect(encode).toHaveBeenCalledTimes(1);
    const req = encode.mock.calls[0][0];
    expect(req.kind === "gif" && req.frames.reduce((n, f) => n + f.ms, 0)).toBe(GIF_MAX_MS);

    act(() => button("Record GIF").click());
    act(() => button("Cancel").click());
    await act(() => vi.advanceTimersByTimeAsync(GIF_MAX_MS + 1000));
    expect(encode).toHaveBeenCalledTimes(1);
  });
});
