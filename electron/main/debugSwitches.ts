// 2026-10-31 app review S1, the owner's choice (b): a released build refuses
// Chromium's remote debugging (--remote-debugging-port, and its pipe form
// --remote-debugging-pipe), which would let any local program drive the page
// and its window.desktop bridge. A dev-tools build (DS5_DEV_TOOLS=1 or
// X.Y.Z-dev.N, DEV_TOOLS_BUILT) and the unpackaged dev copy keep it: the
// test tools drive those through it (mac-smoke, tools/isolated.sh,
// tools/dev.sh, tools/budgets_vm.ps1, tools/sleep_wake_vm.mjs).
// --inspect, the main process's debugger, is the EnableNodeCliInspectArguments
// fuse, off in released builds (tools/inspect_fuse.mjs).
//
// Chromium reads these switches itself, before any window: the main script
// can't refuse them by ignoring them. refuseDebugSwitches.ts, index.ts's
// first import, checks them and quits (app.exit before the app is ready ends
// the process at once). By
// Electron's source the main script, ESM included, runs before Chromium
// starts its DevTools listener (PreMainMessageLoopRun), so the port should
// never open; that is read from the source, not yet measured on a packaged
// release build.
//
// What stays possible: a dev-channel (X.Y.Z-dev.N) build still accepts both,
// by design; a program that can start the app can start a dev-channel build
// or Electron itself instead, and one running as the same user has other ways
// in (the user's files, the AppImage on Linux, whose app.asar isn't
// integrity-checked). This stops a released build from offering a debugger
// to other local programs when started with the switch.
export const DEBUG_SWITCHES = ["remote-debugging-port", "remote-debugging-pipe"];

// The remote-debugging switch this start must refuse, or null: only a
// packaged build without the dev tools refuses one.
export function refusedDebugSwitch(hasSwitch: (name: string) => boolean, packaged: boolean, devTools: boolean): string | null {
  if (!packaged || devTools) return null;
  // loop: NOT-WORTH — N = 2 switches, once at start
  return DEBUG_SWITCHES.find((name) => hasSwitch(name)) ?? null;
}
