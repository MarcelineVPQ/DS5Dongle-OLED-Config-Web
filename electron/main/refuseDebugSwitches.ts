// index.ts's first import: a released build started with Chromium's remote
// debugging switch quits before anything else runs (debugSwitches.ts says
// what that closes and what stays possible). Its own module so it runs before
// every other module of the main process, and so the rule itself
// (refusedDebugSwitch) is tested without Electron. Nothing is open or being
// written yet, so quitting here skips nothing (no firmware hold, no settings).
import { app } from "electron";
import { refusedDebugSwitch } from "./debugSwitches";
import { DEV_TOOLS_BUILT } from "./devTools";

const refused = refusedDebugSwitch((name) => app.commandLine.hasSwitch(name), app.isPackaged, DEV_TOOLS_BUILT);
if (refused) {
  // error: LOGGED-OK — a developer's switch, never one the app, its installers or its updater pass; the app quits before it has a window to say it in
  console.error(`--${refused} is refused by released builds; quitting. Dev-tools builds (DS5_DEV_TOOLS=1, X.Y.Z-dev.N) accept it.`);
  // Before the app is ready, app.exit ends the process at once.
  app.exit(1);
}
