// What the Electron preload exposes as `window.desktop`. Absent in the browser
// build, so `isDesktop()` is the switch between the two targets.
export interface DesktopApi {
  platform: string;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop !== undefined;
}
