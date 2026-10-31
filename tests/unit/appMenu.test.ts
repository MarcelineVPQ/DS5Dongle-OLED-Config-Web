import { describe, expect, it } from "vitest";
import { appMenuTemplate, pageShortcut, type ShortcutInput } from "../../electron/main/appMenu";

const key = (k: string, code: string, mods: Partial<ShortcutInput> = {}): ShortcutInput => ({ type: "keyDown", key: k, code, control: false, meta: false, shift: false, alt: false, ...mods });

describe("app menu (no reload, zoom or DevTools items)", () => {
  it("Windows and Linux get no menu; macOS gets App, Edit and Window only", () => {
    expect(appMenuTemplate("linux")).toBeNull();
    expect(appMenuTemplate("win32")).toBeNull();
    const roles = JSON.stringify(appMenuTemplate("darwin"));
    expect(roles).toBe(JSON.stringify([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
    for (const banned of ["reload", "forceReload", "toggleDevTools", "zoomIn", "zoomOut", "resetZoom", "viewMenu"]) expect(roles).not.toContain(banned);
  });
});

describe("page shortcut guard", () => {
  it("refuses reload, zoom and DevTools keys on Windows and Linux", () => {
    expect(pageShortcut(key("r", "KeyR", { control: true }), false)).toBe("reload");
    expect(pageShortcut(key("R", "KeyR", { control: true, shift: true }), false)).toBe("reload");
    expect(pageShortcut(key("F5", "F5"), false)).toBe("reload");
    expect(pageShortcut(key("F5", "F5", { control: true }), false)).toBe("reload");
    for (const [k, code] of [
      ["=", "Equal"],
      ["+", "Equal"],
      ["-", "Minus"],
      ["0", "Digit0"],
      ["+", "NumpadAdd"],
    ])
      expect(pageShortcut(key(k, code, { control: true }), false), k).toBe("zoom");
    expect(pageShortcut(key("I", "KeyI", { control: true, shift: true }), false)).toBe("devTools");
  });

  it("uses ⌘ (and ⌥⌘I) on macOS", () => {
    expect(pageShortcut(key("r", "KeyR", { meta: true }), true)).toBe("reload");
    expect(pageShortcut(key("=", "Equal", { meta: true }), true)).toBe("zoom");
    expect(pageShortcut(key("ˆ", "KeyI", { meta: true, alt: true }), true)).toBe("devTools");
    expect(pageShortcut(key("r", "KeyR", { control: true }), true)).toBeNull();
  });

  it("leaves every other key to the page (Ctrl+B pins the rail, typing, key-up)", () => {
    expect(pageShortcut(key("b", "KeyB", { control: true }), false)).toBeNull();
    expect(pageShortcut(key("r", "KeyR"), false)).toBeNull();
    expect(pageShortcut(key("i", "KeyI", { control: true }), false)).toBeNull();
    expect(pageShortcut({ ...key("r", "KeyR", { control: true }), type: "keyUp" }, false)).toBeNull();
  });
});
