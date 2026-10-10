// IPC from the renderer. Every message is checked against its sender (our own
// window, on our own page) and its payload schema before anything acts on it.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { z } from "zod";
import { IPC, type DesktopSettings, type DeviceStatus, type LatestFirmware, type UpdateState } from "../../src/desktop/api";
import { SettingUpdate } from "./settings";

export const DeviceStatusSchema = z.strictObject({
  dongle: z.boolean(),
  controller: z.boolean(),
  slot: z.number().int().min(-1).max(3),
  firmware: z.string().max(64).nullable(),
  charging: z.boolean(),
  battery: z.number().int().min(0).max(100).nullable(),
});

// A small PNG only: data URL, base64 alphabet, size-capped.
export const TrayIconSchema = z
  .string()
  .max(256 * 1024)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);

export interface IpcHandlers {
  isTrusted: (sender: WebContents, frameUrl: string) => boolean;
  onStatus: (status: DeviceStatus) => void;
  onTrayIcon: (pngDataUrl: string) => void;
  getSettings: () => DesktopSettings;
  setSetting: <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => DesktopSettings;
  usbAccessInstalled: () => boolean;
  setupUsbAccess: () => Promise<{ ok: boolean; message: string }>;
  appVersion: () => string;
  checkForUpdates: () => Promise<UpdateState>;
  getUpdateState: () => UpdateState;
  installUpdate: () => Promise<UpdateState>;
  restartToUpdate: () => void;
  latestFirmware: () => Promise<LatestFirmware | null>;
  downloadFirmware: () => Promise<{ version: string; bytes: Uint8Array }>;
  getDesktopPalette: () => Promise<unknown>;
  firmwareChangelog: () => Promise<string>;
}

export function registerIpc(h: IpcHandlers): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => h.isTrusted(event.sender, event.senderFrame?.url ?? "");

  ipcMain.on(IPC.reportStatus, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = DeviceStatusSchema.safeParse(raw);
    if (parsed.success) h.onStatus(parsed.data);
  });

  ipcMain.on(IPC.setTrayIcon, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = TrayIconSchema.safeParse(raw);
    if (parsed.success) h.onTrayIcon(parsed.data);
  });

  ipcMain.handle(IPC.getSettings, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.getSettings();
  });

  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = trusted(event) ? h.appVersion() : "";
  });

  const invoke = (channel: string, run: () => unknown) =>
    ipcMain.handle(channel, (event) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return run();
    });
  invoke(IPC.checkForUpdates, h.checkForUpdates);
  invoke(IPC.getUpdateState, h.getUpdateState);
  invoke(IPC.installUpdate, h.installUpdate);
  invoke(IPC.latestFirmware, h.latestFirmware);
  invoke(IPC.downloadFirmware, h.downloadFirmware);
  invoke(IPC.getDesktopPalette, h.getDesktopPalette);
  invoke(IPC.firmwareChangelog, h.firmwareChangelog);

  ipcMain.on(IPC.restartToUpdate, (event) => {
    if (trusted(event)) h.restartToUpdate();
  });

  ipcMain.handle(IPC.usbAccessInstalled, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.usbAccessInstalled();
  });

  ipcMain.handle(IPC.setupUsbAccess, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.setupUsbAccess();
  });

  ipcMain.handle(IPC.setSetting, (event, raw: unknown) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    const { key, value } = SettingUpdate.parse(raw);
    return h.setSetting(key, value);
  });
}
