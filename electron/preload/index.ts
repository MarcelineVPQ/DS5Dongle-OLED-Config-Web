// Sandboxed preload: the renderer's only door to the main process. It exposes a
// fixed, typed object (src/desktop/api.ts) with one function per IPC channel and
// never hands the page the IPC object itself. Device access does not go through
// here: the page uses WebUSB, which the main process limits to the dongle and
// the RP2350 boot device.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type DesktopApi, type TrayCommand, type UpdateState } from "../../src/desktop/api";
import type { DesktopPalette } from "../../src/desktop/theme/desktopPalette";

const api: DesktopApi = {
  platform: process.platform,
  reportStatus: (status) => ipcRenderer.send(IPC.reportStatus, status),
  setTrayIcon: (pngDataUrl) => ipcRenderer.send(IPC.setTrayIcon, pngDataUrl),
  onTrayCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: TrayCommand) => listener(command);
    ipcRenderer.on(IPC.trayCommand, handler);
    return () => ipcRenderer.removeListener(IPC.trayCommand, handler);
  },
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSetting: (key, value) => ipcRenderer.invoke(IPC.setSetting, { key, value }),
  usbAccessInstalled: () => ipcRenderer.invoke(IPC.usbAccessInstalled),
  setupUsbAccess: () => ipcRenderer.invoke(IPC.setupUsbAccess),
  appVersion: ipcRenderer.sendSync(IPC.appVersion) as string,
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  restartToUpdate: () => ipcRenderer.send(IPC.restartToUpdate),
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on(IPC.updateState, handler);
    return () => ipcRenderer.removeListener(IPC.updateState, handler);
  },
  latestFirmware: () => ipcRenderer.invoke(IPC.latestFirmware),
  downloadFirmware: () => ipcRenderer.invoke(IPC.downloadFirmware),
  getDesktopPalette: () => ipcRenderer.invoke(IPC.getDesktopPalette),
  firmwareChangelog: () => ipcRenderer.invoke(IPC.firmwareChangelog),
  onDesktopPalette: (listener) => {
    const handler = (_event: IpcRendererEvent, palette: DesktopPalette | null) => listener(palette);
    ipcRenderer.on(IPC.desktopPalette, handler);
    return () => ipcRenderer.removeListener(IPC.desktopPalette, handler);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
