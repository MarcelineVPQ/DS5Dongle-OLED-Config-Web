// Sandboxed preload: the renderer's only door to the main process. It exposes a
// fixed, typed object (src/desktop/api.ts) with one function per IPC channel and
// never hands the page the IPC object itself. Device access does not go through
// here: the page uses WebUSB, which the main process limits to the dongle and
// the RP2350 boot device.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type DesktopApi, type FirmwareHoldState, type ProtonProgress, type TrayCommand, type UpdateState } from "../../src/desktop/api";
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
  repairWindowsUsb: () => ipcRenderer.invoke(IPC.repairWindowsUsb),
  appVersion: ipcRenderer.sendSync(IPC.appVersion) as string,
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  backToStable: () => ipcRenderer.invoke(IPC.backToStable),
  devChannelPreview: () => ipcRenderer.invoke(IPC.devChannelPreview),
  restartToUpdate: () => ipcRenderer.send(IPC.restartToUpdate),
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on(IPC.updateState, handler);
    return () => ipcRenderer.removeListener(IPC.updateState, handler);
  },
  latestFirmware: () => ipcRenderer.invoke(IPC.latestFirmware),
  officialControllerFirmware: (asked) => ipcRenderer.invoke(IPC.officialControllerFirmware, asked),
  downloadFirmware: () => ipcRenderer.invoke(IPC.downloadFirmware),
  setFirmwareWriting: (writing) => ipcRenderer.send(IPC.setFirmwareWriting, writing),
  getFirmwareHold: () => ipcRenderer.invoke(IPC.getFirmwareHold),
  onFirmwareHold: (listener) => {
    const handler = (_event: IpcRendererEvent, state: FirmwareHoldState) => listener(state);
    ipcRenderer.on(IPC.firmwareHold, handler);
    return () => ipcRenderer.removeListener(IPC.firmwareHold, handler);
  },
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
  gamesApply: (request) => ipcRenderer.invoke(IPC.gamesApply, request),
  gamesUndo: (request) => ipcRenderer.invoke(IPC.gamesUndo, request),
  gamesBackups: () => ipcRenderer.invoke(IPC.gamesBackups),
  gamesRunningLaunchers: () => ipcRenderer.invoke(IPC.gamesRunningLaunchers),
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
  librarySetLayout: (layout) => ipcRenderer.invoke(IPC.librarySetLayout, layout),
  libraryDeleteLayout: (id) => ipcRenderer.invoke(IPC.libraryDeleteLayout, id),
  gameAction: (update) => ipcRenderer.invoke(IPC.gameAction, update),
  gameArtColor: (gameKey) => ipcRenderer.invoke(IPC.gameArtColor, gameKey),
};

contextBridge.exposeInMainWorld("desktop", api);
