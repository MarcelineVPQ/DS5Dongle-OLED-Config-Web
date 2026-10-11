// Sandboxed preload: the renderer's only door to the main process. It exposes a
// fixed, typed object (src/desktop/api.ts) with one function per IPC channel and
// never hands the page the IPC object itself. Device access does not go through
// here: the page uses WebUSB, which the main process limits to the dongle and
// the RP2350 boot device.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type DesktopApi, type ProtonProgress, type TrayCommand, type UpdateState } from "../../src/desktop/api";
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
  onWindowVisible: (listener) => {
    const handler = (_event: IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on(IPC.windowVisible, handler);
    return () => ipcRenderer.removeListener(IPC.windowVisible, handler);
  },
  gamesScan: () => ipcRenderer.invoke(IPC.gamesScan),
  gamesApply: (fixIds) => ipcRenderer.invoke(IPC.gamesApply, fixIds),
  gamesUndo: (backupId) => ipcRenderer.invoke(IPC.gamesUndo, backupId),
  gamesBackups: () => ipcRenderer.invoke(IPC.gamesBackups),
  closeLauncher: (launcher) => ipcRenderer.invoke(IPC.closeLauncher, launcher),
  installProton: () => ipcRenderer.invoke(IPC.installProton),
  onProtonProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: ProtonProgress) => listener(progress);
    ipcRenderer.on(IPC.protonProgress, handler);
    return () => ipcRenderer.removeListener(IPC.protonProgress, handler);
  },
  gamesDetails: () => ipcRenderer.invoke(IPC.gamesDetails),
  gamesRunning: () => ipcRenderer.invoke(IPC.gamesRunning),
  onRunningGame: (listener) => {
    const handler = (_event: IpcRendererEvent, key: string | null) => listener(key);
    ipcRenderer.on(IPC.runningGame, handler);
    return () => ipcRenderer.removeListener(IPC.runningGame, handler);
  },
  libraryGet: () => ipcRenderer.invoke(IPC.libraryGet),
  librarySetProfile: (update) => ipcRenderer.invoke(IPC.librarySetProfile, update),
  libraryDeleteProfile: (gameKey) => ipcRenderer.invoke(IPC.libraryDeleteProfile, gameKey),
  librarySetMine: (update) => ipcRenderer.invoke(IPC.librarySetMine, update),
  librarySetRestore: (restore) => ipcRenderer.invoke(IPC.librarySetRestore, restore),
  gameAction: (update) => ipcRenderer.invoke(IPC.gameAction, update),
  micTest: () => ipcRenderer.invoke(IPC.micTest),
  gameArtColor: (gameKey) => ipcRenderer.invoke(IPC.gameArtColor, gameKey),
  onMicLevel: (listener) => {
    const handler = (_event: IpcRendererEvent, level: number) => listener(level);
    ipcRenderer.on(IPC.micLevel, handler);
    return () => ipcRenderer.removeListener(IPC.micLevel, handler);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
