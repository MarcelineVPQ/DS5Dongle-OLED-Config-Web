// The app's own menu, in place of Electron's default one. The default menu's
// shortcuts reload the page (Ctrl+R / ⌘R, F5: a reload mid firmware write
// leaves the board half-written and drops staged drafts), open DevTools in a
// stable release and zoom past the pinned 100 %. Windows and Linux get no menu
// (the bar was hidden anyway); macOS keeps its App, Edit (copy and paste in
// text fields) and Window menus, none of which reload, zoom or open DevTools.
import type { MenuItemConstructorOptions } from "electron";

export function appMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  return platform === "darwin" ? [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }] : null;
}

export type ShortcutInput = { type: string; key: string; code: string; control: boolean; meta: boolean; shift: boolean; alt: boolean };

// A key the page must never act on (the before-input-event guard, in case a
// menu or Chromium still maps it): "reload", "zoom", or "devTools" (opened
// only in dev builds, by index.ts). Anything else is the page's.
export function pageShortcut(input: ShortcutInput, mac: boolean): "reload" | "zoom" | "devTools" | null {
  if (input.type !== "keyDown") return null;
  const key = input.key.toLowerCase();
  if (key === "f5") return "reload";
  const mod = mac ? input.meta : input.control;
  if (!mod) return null;
  // By the key and by its place (⌥ changes the key ⌥⌘I types on a Mac).
  if (key === "r" || input.code === "KeyR") return "reload";
  if (["=", "+", "-", "0"].includes(key) || ["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"].includes(input.code)) return "zoom";
  if ((key === "i" || input.code === "KeyI") && (mac ? input.alt : input.shift)) return "devTools";
  return null;
}
