// System tray: an icon that shows board/controller state, a status tooltip,
// and a menu for the things you'd reach for without opening the window, in
// the system's language (mainTranslator; the page's words by the same keys).
// Pattern from Sonata (apple-music-for-linux/main.js "tray" section).
import { join } from "node:path";
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import type { DesktopSettings, DeviceStatus, TrayCommand, UpdateState } from "../../src/desktop/api";
import type { MainTranslate } from "./mainText";

type TrayState = "ok" | "away" | "none";

export function trayState(status: DeviceStatus): TrayState {
  if (!status.dongle) return "none";
  return status.controller ? "ok" : "away";
}

const POWER_KEY: Record<NonNullable<DeviceStatus["power"]>, string> = {
  charging: "desktop.ctrlInfo.chargeState.charging",
  pluggedIn: "desktop.ctrlInfo.chargeState.pluggedIn",
  full: "desktop.ctrlInfo.chargeState.full",
};

// The status line (tooltip and the menu's first line), in the system's
// language: the board by name ({{deviceName}}), its firmware, the controller.
export function trayTooltip(status: DeviceStatus, t: MainTranslate): string {
  const board = t("desktop.tray.board", {}, status.board);
  if (!status.dongle) return [board, t("desktop.tray.notConnected")].join(" · ");
  const parts = [status.firmware ? `${board} ${status.firmware}` : board];
  if (!status.controller) return [...parts, t("desktop.tray.noController")].join(" · ");
  parts.push(t("desktop.tray.controller"), t("desktop.tray.slot", { slot: status.slot }));
  if (status.battery !== null) parts.push(t("desktop.tray.battery", { percent: status.battery }));
  if (status.power) parts.push(t(POWER_KEY[status.power]));
  return parts.join(" · ");
}

export interface TrayHandlers {
  toggleWindow: () => void;
  command: (command: TrayCommand) => void;
  setSetting: <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => void;
  // Windows only.
  createDesktopShortcut?: () => void;
  checkForUpdates: () => void;
  restartToUpdate: () => void;
  quit: () => void;
}

export class AppTray {
  private readonly tray: Tray;
  private status: DeviceStatus = { dongle: false, controller: false, slot: -1, firmware: null, power: null, battery: null, board: null };
  private state: TrayState | null = null;
  // Set once the renderer starts drawing the live icon; until then (and if a
  // drawn image fails to decode) the static per-state icons are used.
  private custom = false;
  private updateState: UpdateState = { phase: "idle" };
  // The system language's text (mainTranslator); until it's loaded the tray shows its icon only.
  private t: MainTranslate | null = null;

  constructor(
    private readonly resourcesDir: string,
    private readonly handlers: TrayHandlers,
    private settings: DesktopSettings,
  ) {
    this.tray = new Tray(this.icon("none")); // lifetime: NOT-WORTH — one tray per app; Electron removes it at quit
    this.tray.on("click", handlers.toggleWindow); // lifetime: NOT-WORTH — goes with the one tray, lives until quit
    this.refresh();
  }

  update(status: DeviceStatus): void {
    this.status = status;
    this.refresh();
  }

  updateSettings(settings: DesktopSettings): void {
    this.settings = settings;
    this.refresh();
  }

  setText(t: MainTranslate): void {
    this.t = t;
    this.refresh();
  }

  setCustomIcon(pngDataUrl: string): void {
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: 2, dataURL: pngDataUrl });
    if (image.isEmpty()) return;
    // macOS: the renderer drew a template image (black + alpha); the menu bar tints it.
    if (process.platform === "darwin") image.setTemplateImage(true);
    this.custom = true;
    this.tray.setImage(image);
  }

  // Every update state (a download reports progress every 150 ms): the menu
  // is rebuilt only when what it shows changes, an update ready or its version.
  updateUpdateState(state: UpdateState): void {
    const shown = (s: UpdateState) => (s.phase === "ready" ? s.version : null);
    const changed = shown(state) !== shown(this.updateState);
    this.updateState = state;
    if (changed) this.refresh();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private icon(state: TrayState) {
    // macOS: one template image (tools/prepare_tray_template.py) until the
    // renderer draws the live one with its state; the menu bar tints it.
    if (process.platform === "darwin") {
      const template = nativeImage.createFromPath(join(this.resourcesDir, "trayTemplate.png"));
      template.setTemplateImage(true);
      return template;
    }
    // nativeImage picks up the @2x file next to it for HiDPI trays.
    const size = process.platform === "win32" ? 32 : 22;
    return nativeImage.createFromPath(join(this.resourcesDir, `tray-${state}-${size}.png`));
  }

  private refresh(): void {
    const state = trayState(this.status);
    if (state !== this.state) {
      this.state = state;
      if (!this.custom) this.tray.setImage(this.icon(state));
    }
    const t = this.t;
    if (!t) return;
    this.tray.setToolTip(trayTooltip(this.status, t));
    // lifetime: OK — replaces the previous menu, which is then collected; rebuilt only when status/settings change
    this.tray.setContextMenu(Menu.buildFromTemplate(this.menu(t)));
  }

  private menu(t: MainTranslate): MenuItemConstructorOptions[] {
    const s = this.status;
    const h = this.handlers;
    const slots: MenuItemConstructorOptions[] = [0, 1, 2, 3].map((slot) => ({
      label: t("desktop.tray.slot", { slot }),
      type: "radio",
      checked: s.slot === slot,
      enabled: s.dongle,
      click: () => h.command({ type: "switchSlot", slot }),
    }));
    return [
      { label: t("desktop.tray.showHide"), click: h.toggleWindow },
      { type: "separator" },
      { label: trayTooltip(s, t), enabled: false },
      { label: t("desktop.overview.slot"), submenu: slots, enabled: s.dongle },
      { label: t("desktop.sections.diagnostics"), click: () => h.command({ type: "openPage", page: "diagnostics" }) },
      { type: "separator" },
      this.updateState.phase === "ready"
        ? { label: t("desktop.tray.restartToUpdate", { version: this.updateState.version }), click: h.restartToUpdate }
        : { label: t("desktop.setup.checkUpdates"), click: h.checkForUpdates },
      { type: "separator" },
      { label: t("desktop.live.closeToTray"), type: "checkbox", checked: this.settings.closeToTray, click: (item) => h.setSetting("closeToTray", item.checked) },
      { label: t("desktop.live.launchAtLogin"), type: "checkbox", checked: this.settings.launchAtLogin, click: (item) => h.setSetting("launchAtLogin", item.checked) },
      { label: t("desktop.live.startMinimized"), type: "checkbox", checked: this.settings.startMinimized, click: (item) => h.setSetting("startMinimized", item.checked) },
      { label: t("desktop.live.checkForUpdates"), type: "checkbox", checked: this.settings.checkForUpdates, click: (item) => h.setSetting("checkForUpdates", item.checked) },
      ...(h.createDesktopShortcut ? [{ label: t("desktop.tray.createShortcut"), click: h.createDesktopShortcut }] : []),
      { type: "separator" },
      { label: t("desktop.tray.quit"), click: h.quit },
    ];
  }
}
