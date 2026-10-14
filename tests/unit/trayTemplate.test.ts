// macOS: the menu-bar icon is a template image (black + alpha, tinted by the
// menu bar), both the start-up image and the live one the renderer draws.
// Other systems keep the colored per-state icons.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const images: { path?: string; template: boolean }[] = [];
const fakeImage = (path?: string) => {
  const img = { path, template: false, isEmpty: () => false, addRepresentation: () => undefined, setTemplateImage: (on: boolean) => (img.template = on) };
  images.push(img);
  return img;
};
const setImage = vi.fn();
vi.mock("electron", () => ({
  Tray: class {
    on() {}
    setImage = setImage;
    setToolTip() {}
    setContextMenu() {}
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: (p: string) => fakeImage(p), createEmpty: () => fakeImage() },
}));

const realPlatform = process.platform;
const onPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, "platform", { value: p, configurable: true });
afterEach(() => {
  onPlatform(realPlatform);
  images.length = 0;
  setImage.mockClear();
});

const handlers = { toggleWindow: () => undefined, command: () => undefined, setSetting: () => undefined, checkForUpdates: () => undefined, restartToUpdate: () => undefined, quit: () => undefined };
const settings = { closeToTray: true, launchAtLogin: false, startMinimized: false, checkForUpdates: true } as never;

async function makeTray() {
  const { AppTray } = await import("../../electron/main/tray");
  return new AppTray("/res", handlers, settings);
}

describe("the tray icon", () => {
  it("macOS: starts with the template image and marks the live one as a template", async () => {
    onPlatform("darwin");
    const tray = await makeTray();
    expect(images[0]).toMatchObject({ path: join("/res", "trayTemplate.png"), template: true });
    tray.setCustomIcon("data:image/png;base64,AAAA");
    expect(images.at(-1)).toMatchObject({ path: undefined, template: true });
  });

  it("Linux and Windows: the colored per-state icons, never a template", async () => {
    onPlatform("linux");
    const tray = await makeTray();
    expect(images[0]).toMatchObject({ path: join("/res", "tray-none-22.png"), template: false });
    tray.setCustomIcon("data:image/png;base64,AAAA");
    expect(images.at(-1)!.template).toBe(false);
  });

  it("the template files are in resources/ (tools/prepare_tray_template.py)", () => {
    for (const f of ["trayTemplate.png", "trayTemplate@2x.png"]) expect(existsSync(new URL(`../../resources/${f}`, import.meta.url))).toBe(true);
  });
});
