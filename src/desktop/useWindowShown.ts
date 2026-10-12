// Is the app actually on screen? The page is visible and (desktop) the window
// isn't hidden in the tray or minimized. Chromium alone doesn't report the
// tray case: the main process keeps `backgroundThrottling: false` (the tray
// needs unthrottled timers), so `document.hidden` stays false there and the
// main process sends its own window-visible signal instead.
//
// One shared store for the whole app (one IPC listener), so a component that
// mounts while the window is hidden starts out paused too. Everything that
// only feeds the UI (animations, live readouts, UI-only polls) stops while
// this is false; what the tray, game profiles and saved-state sync need keeps
// running (see useDs5Bridge).
import { useSyncExternalStore } from "react";

let windowShown = true;
let pageVisible = typeof document === "undefined" || document.visibilityState === "visible";
let focused = typeof document === "undefined" || document.hasFocus();
const listeners = new Set<() => void>();
let wired = false;

const notify = () => listeners.forEach((l) => l());

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.desktop?.onWindowVisible((shown) => {
    windowShown = shown;
    notify();
  });
  document.addEventListener("visibilitychange", () => {
    pageVisible = document.visibilityState === "visible";
    notify();
  });
  window.addEventListener("focus", () => {
    focused = true;
    notify();
  });
  window.addEventListener("blur", () => {
    focused = false;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

wire();

export const isWindowShown = (): boolean => windowShown && pageVisible;

// True while the window is on screen (not minimized, not in the tray).
export function useWindowShown(): boolean {
  return useSyncExternalStore(subscribe, isWindowShown, () => true);
}

// True while the window has the keyboard focus (on screen but behind another
// window: false). Decorative animations slow down then.
export function useWindowFocused(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => focused,
    () => true,
  );
}
