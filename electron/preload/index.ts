// Sandboxed preload: the renderer's only door to the main process. It exposes a
// fixed, typed object (src/desktop/api.ts), never ipcRenderer itself. Device
// access does not go through here: the page uses WebUSB, which the main process
// limits to the dongle and the RP2350 boot device.
import { contextBridge } from "electron";
import type { DesktopApi } from "../../src/desktop/api";

const api: DesktopApi = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld("desktop", api);
