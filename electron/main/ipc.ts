// IPC from the renderer. Every message is checked against its sender (our own
// window, on our own page) and its payload schema before anything acts on it.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import {
  ButtonLayoutSchema,
  GameKeySchema,
  LayoutIdSchema,
  LibraryFileSchema,
  MineSchema,
  ProfileSettingsSchema,
  type LibraryFile,
  type Mine,
  type ProfileSettings,
} from "../../src/desktop/games/library";
import type { MicTestResult } from "./audioTest";
import type { DevChannelPreview } from "../../src/desktop/api";
import { GAME_ACTIONS, type GameAction, type GameInfo } from "../../src/desktop/games/types";
import { z } from "zod";
import {
  IPC,
  type CloseLauncherResult,
  type DesktopSettings,
  type DeviceStatus,
  type GameBackup,
  type FirmwareHoldState,
  type FirmwareLookup,
  type OfficialFirmwareLookup,
  type ProtonInstallResult,
  type UndoResult,
  type UpdateState,
} from "../../src/desktop/api";
import type { ApplyResult, GamesReport, LauncherId } from "../../src/desktop/games/types";
import { BACKUP_ID } from "./games/backup";
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

// Games page: the renderer names fixes by id only (resolved against a fresh
// scan in the main process), never a path or a value.
export const FixIdsSchema = z
  .array(
    z
      .string()
      .max(200)
      // Same shapes games.ts builds (a test checks every id a scan produces passes).
      .regex(/^(steam|heroic|lutris)-[0-9a-f]{8}:(default|runner:[\w.-]+|input:\d+|env:[\w.-]+)$|^system:audio-(rule|profile):[0-9a-f]{8}$/),
  )
  .max(500);
export const BackupIdSchema = z.string().regex(BACKUP_ID);
export const LauncherSchema = z.enum(["steam", "heroic", "lutris", "gog", "epic"]);
// Games library: keys from the scan, a title for display, schema-checked data.
const TitleSchema = z.string().min(1).max(300);
export const SetProfileSchema = z.strictObject({ gameKey: GameKeySchema, title: TitleSchema, settings: ProfileSettingsSchema });
export const SetMineSchema = z.strictObject({ gameKey: GameKeySchema, title: TitleSchema, mine: MineSchema });
export const GameActionSchema = z.strictObject({ gameKey: GameKeySchema, action: z.enum(GAME_ACTIONS) });
export const RestoreSchema = LibraryFileSchema.shape.restore.unwrap().nullable();
export const SetLayoutSchema = z.strictObject({ id: LayoutIdSchema, name: ButtonLayoutSchema.shape.name, table: ButtonLayoutSchema.shape.table, extra: ButtonLayoutSchema.shape.extra });

export interface IpcHandlers {
  gamesDetails: () => Record<string, GameInfo>;
  gamesRunning: () => string | null;
  libraryGet: () => LibraryFile;
  librarySetProfile: (u: { gameKey: string; title: string; settings: ProfileSettings }) => LibraryFile;
  libraryDeleteProfile: (gameKey: string) => LibraryFile;
  librarySetMine: (u: { gameKey: string; title: string; mine: Mine }) => LibraryFile;
  librarySetRestore: (r: LibraryFile["restore"] | null) => LibraryFile;
  librarySetLayout: (u: { id: string; name: string; table: number[]; extra?: number[] }) => LibraryFile;
  libraryDeleteLayout: (id: string) => LibraryFile;
  gameAction: (u: { gameKey: string; action: GameAction }) => Promise<boolean>;
  micTest: () => Promise<MicTestResult>;
  gameArtColor: (gameKey: string) => string | null;
  isTrusted: (sender: WebContents, frameUrl: string) => boolean;
  onStatus: (status: DeviceStatus) => void;
  onTrayIcon: (pngDataUrl: string) => void;
  getSettings: () => DesktopSettings;
  setSetting: <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => DesktopSettings;
  usbAccessInstalled: () => boolean;
  setupUsbAccess: () => Promise<{ ok: boolean; message: string }>;
  repairWindowsUsb: () => Promise<{ ok: boolean; message: string }>;
  appVersion: () => string;
  checkForUpdates: () => Promise<UpdateState>;
  getUpdateState: () => UpdateState;
  installUpdate: () => Promise<UpdateState>;
  backToStable: () => Promise<UpdateState>;
  devChannelPreview: () => Promise<DevChannelPreview | null>;
  restartToUpdate: () => void;
  latestFirmware: () => Promise<FirmwareLookup>;
  officialControllerFirmware: (asked: boolean) => Promise<OfficialFirmwareLookup>;
  downloadFirmware: () => Promise<{ version: string; bytes: Uint8Array }>;
  setFirmwareWriting: (writing: boolean) => void;
  getFirmwareHold: () => FirmwareHoldState;
  getDesktopPalette: () => Promise<unknown>;
  firmwareChangelog: () => Promise<string>;
  gamesScan: () => Promise<GamesReport>;
  gamesApply: (fixIds: string[]) => Promise<ApplyResult>;
  gamesUndo: (backupId: string) => Promise<UndoResult>;
  gamesBackups: () => GameBackup[];
  closeLauncher: (launcher: LauncherId) => Promise<CloseLauncherResult>;
  installProton: () => Promise<ProtonInstallResult>;
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
  invoke(IPC.backToStable, h.backToStable);
  invoke(IPC.devChannelPreview, h.devChannelPreview);
  invoke(IPC.latestFirmware, h.latestFirmware);
  invoke(IPC.downloadFirmware, h.downloadFirmware);
  invoke(IPC.getDesktopPalette, h.getDesktopPalette);
  invoke(IPC.firmwareChangelog, h.firmwareChangelog);

  invoke(IPC.getFirmwareHold, h.getFirmwareHold);
  ipcMain.on(IPC.setFirmwareWriting, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = z.boolean().safeParse(raw);
    if (parsed.success) h.setFirmwareWriting(parsed.data);
  });

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

  ipcMain.handle(IPC.repairWindowsUsb, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.repairWindowsUsb();
  });

  invoke(IPC.gamesScan, h.gamesScan);
  invoke(IPC.gamesBackups, h.gamesBackups);
  invoke(IPC.installProton, h.installProton);
  const invokeWith = <T>(channel: string, schema: z.ZodType<T>, run: (value: T) => unknown) =>
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return run(schema.parse(raw));
    });
  invokeWith(IPC.gamesApply, FixIdsSchema, h.gamesApply);
  invokeWith(IPC.gamesUndo, BackupIdSchema, h.gamesUndo);
  invokeWith(IPC.closeLauncher, LauncherSchema, h.closeLauncher);
  invoke(IPC.gamesDetails, h.gamesDetails);
  invoke(IPC.gamesRunning, h.gamesRunning);
  invoke(IPC.libraryGet, h.libraryGet);
  invokeWith(IPC.librarySetProfile, SetProfileSchema, h.librarySetProfile);
  invokeWith(IPC.libraryDeleteProfile, GameKeySchema, h.libraryDeleteProfile);
  invokeWith(IPC.librarySetMine, SetMineSchema, h.librarySetMine);
  invokeWith(IPC.librarySetRestore, RestoreSchema, h.librarySetRestore);
  invokeWith(IPC.librarySetLayout, SetLayoutSchema, h.librarySetLayout);
  invokeWith(IPC.libraryDeleteLayout, LayoutIdSchema, h.libraryDeleteLayout);
  invokeWith(IPC.gameAction, GameActionSchema, h.gameAction);
  invoke(IPC.micTest, h.micTest);
  invokeWith(IPC.gameArtColor, GameKeySchema, h.gameArtColor);
  invokeWith(IPC.officialControllerFirmware, z.boolean(), h.officialControllerFirmware);

  ipcMain.handle(IPC.setSetting, (event, raw: unknown) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    const { key, value } = SettingUpdate.parse(raw);
    return h.setSetting(key, value);
  });
}
