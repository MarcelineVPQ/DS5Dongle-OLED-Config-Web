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
import type { DevChannelPreview } from "../../src/desktop/api";
import { GAME_ACTIONS, type GameAction, type GameInfo } from "../../src/desktop/games/types";
import { z } from "zod";
import {
  IPC,
  type DesktopSettings,
  type DeviceStatus,
  type GameBackup,
  type FirmwareHoldState,
  type FirmwareDownload,
  type FirmwareLookup,
  type LatestFirmware,
  type OfficialFirmwareLookup,
  type ProtonInstallResult,
  type UndoResult,
  type UpdateState,
} from "../../src/desktop/api";
import type { ApplyResult, GamesReport, LauncherId, RestartList } from "../../src/desktop/games/types";
import { BACKUP_ID } from "./games/backup";
import { SettingUpdate } from "./settings";

export const DeviceStatusSchema = z.strictObject({
  dongle: z.boolean(),
  controller: z.boolean(),
  slot: z.number().int().min(-1).max(3),
  firmware: z.string().max(64).nullable(),
  power: z.enum(["charging", "pluggedIn", "full"]).nullable(),
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
      .regex(/^(steam|heroic|lutris)-[0-9a-f]{8}:(default|runner:[\w.-]+|input:\d+|env:[\w.-]+|xinput:[\w.-]+|hdr:[\w.-]+|mode:[\w.-]+)$|^system:audio-(rule|profile|volume):[0-9a-f]{8}$/),
  )
  .max(500);
// The firmware the user confirmed (latestFirmware's `latest`, sent back).
export const ShownFirmwareSchema = z.strictObject({
  version: z.string().max(64),
  notesUrl: z.string().max(2048).optional(),
  source: z.enum(["bundled", "online"]),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  channel: z.enum(["stable", "dev"]).optional(),
});
export const BackupIdSchema = z.string().regex(BACKUP_ID);
// The running launchers the page said it will close and reopen for the change.
const RestartSchema = z.array(z.enum(["steam", "heroic", "lutris"])).max(3);
export const ApplyRequestSchema = z.strictObject({ fixIds: FixIdsSchema, restart: RestartSchema });
export const UndoRequestSchema = z.strictObject({ backupId: BackupIdSchema, restart: RestartSchema });
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
  devChannelPreview: (asked: boolean) => Promise<DevChannelPreview | null>;
  restartToUpdate: () => void;
  latestFirmware: (asked: boolean) => Promise<FirmwareLookup>;
  officialControllerFirmware: (asked: boolean) => Promise<OfficialFirmwareLookup>;
  downloadFirmware: (shown: LatestFirmware) => Promise<FirmwareDownload>;
  setFirmwareWriting: (writing: boolean) => void;
  getFirmwareHold: () => FirmwareHoldState;
  getDesktopPalette: () => Promise<unknown>;
  firmwareChangelog: () => Promise<string>;
  gamesScan: () => Promise<GamesReport>;
  gamesApply: (request: { fixIds: string[]; restart: RestartList }) => Promise<ApplyResult>;
  gamesUndo: (request: { backupId: string; restart: RestartList }) => Promise<UndoResult>;
  gamesBackups: () => GameBackup[];
  gamesRunningLaunchers: () => Promise<LauncherId[]>;
  installProton: () => Promise<ProtonInstallResult>;
}

export function registerIpc(h: IpcHandlers): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => h.isTrusted(event.sender, event.senderFrame?.url ?? "");

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.on(IPC.reportStatus, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = DeviceStatusSchema.safeParse(raw);
    if (parsed.success) h.onStatus(parsed.data);
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.on(IPC.setTrayIcon, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = TrayIconSchema.safeParse(raw);
    if (parsed.success) h.onTrayIcon(parsed.data);
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.handle(IPC.getSettings, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.getSettings();
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = trusted(event) ? h.appVersion() : "";
  });

  const invoke = (channel: string, run: () => unknown) =>
    // lifetime: NOT-WORTH — one handler per channel, registered once by registerIpc(), lives until quit
    ipcMain.handle(channel, (event) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return run();
    });
  invoke(IPC.checkForUpdates, h.checkForUpdates);
  invoke(IPC.getUpdateState, h.getUpdateState);
  invoke(IPC.installUpdate, h.installUpdate);
  invoke(IPC.backToStable, h.backToStable);
  invoke(IPC.getDesktopPalette, h.getDesktopPalette);
  invoke(IPC.firmwareChangelog, h.firmwareChangelog);

  invoke(IPC.getFirmwareHold, h.getFirmwareHold);
  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.on(IPC.setFirmwareWriting, (event, raw: unknown) => {
    if (!trusted(event)) return;
    const parsed = z.boolean().safeParse(raw);
    if (parsed.success) h.setFirmwareWriting(parsed.data);
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.on(IPC.restartToUpdate, (event) => {
    if (trusted(event)) h.restartToUpdate();
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.handle(IPC.usbAccessInstalled, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.usbAccessInstalled();
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.handle(IPC.setupUsbAccess, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.setupUsbAccess();
  });

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.handle(IPC.repairWindowsUsb, (event) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return h.repairWindowsUsb();
  });

  invoke(IPC.gamesScan, h.gamesScan);
  invoke(IPC.gamesBackups, h.gamesBackups);
  invoke(IPC.gamesRunningLaunchers, h.gamesRunningLaunchers);
  invoke(IPC.installProton, h.installProton);
  const invokeWith = <T>(channel: string, schema: z.ZodType<T>, run: (value: T) => unknown) =>
    // lifetime: NOT-WORTH — one handler per channel, registered once by registerIpc(), lives until quit
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return run(schema.parse(raw));
    });
  invokeWith(IPC.gamesApply, ApplyRequestSchema, h.gamesApply);
  invokeWith(IPC.gamesUndo, UndoRequestSchema, h.gamesUndo);
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
  invokeWith(IPC.gameArtColor, GameKeySchema, h.gameArtColor);
  invokeWith(IPC.officialControllerFirmware, z.boolean(), h.officialControllerFirmware);
  invokeWith(IPC.devChannelPreview, z.boolean(), h.devChannelPreview);
  invokeWith(IPC.latestFirmware, z.boolean(), h.latestFirmware);
  invokeWith(IPC.downloadFirmware, ShownFirmwareSchema, h.downloadFirmware);

  // lifetime: NOT-WORTH — registered once by registerIpc(), lives until quit
  ipcMain.handle(IPC.setSetting, (event, raw: unknown) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    const { key, value } = SettingUpdate.parse(raw);
    return h.setSetting(key, value);
  });
}
