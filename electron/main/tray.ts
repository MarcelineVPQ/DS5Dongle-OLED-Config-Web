// System tray: an icon that shows dongle/controller state, a status tooltip,
// and a menu for the things you'd reach for without opening the window.
// Pattern from Sonata (apple-music-for-linux/main.js "tray" section).
import { join } from "node:path";
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import type { DesktopSettings, DeviceStatus, TrayCommand, UpdateState } from "../../src/desktop/api";

type TrayState = "ok" | "away" | "none";

export function trayState(status: DeviceStatus): TrayState {
  if (!status.dongle) return "none";
  return status.controller ? "ok" : "away";
}

const POWER_TEXT: Record<NonNullable<DeviceStatus["power"]>, string> = { charging: "charging", pluggedIn: "plugged in, not charging", full: "fully charged" };

export function trayTooltip(status: DeviceStatus): string {
  if (!status.dongle) return "DS5 Dongle OLED Edition: not connected";
  const battery = status.battery === null ? "" : `, battery ${status.battery}%${status.power ? ` ${POWER_TEXT[status.power]}` : ""}`;
  const controller = status.controller ? `controller connected (slot ${status.slot}${battery})` : "no controller (press PS)";
  return `DS5 Dongle OLED Edition${status.firmware ? ` ${status.firmware}` : ""}: ${controller}`;
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
  private status: DeviceStatus = { dongle: false, controller: false, slot: -1, firmware: null, power: null, battery: null };
  private state: TrayState | null = null;
  // Set once the renderer starts drawing the live icon; until then (and if a
  // drawn image fails to decode) the static per-state icons are used.
  private custom = false;
  private updateState: UpdateState = { phase: "idle" };

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

  setCustomIcon(pngDataUrl: string): void {
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: 2, dataURL: pngDataUrl });
    if (image.isEmpty()) return;
    // macOS: the renderer drew a template image (black + alpha); the menu bar tints it.
    if (process.platform === "darwin") image.setTemplateImage(true);
    this.custom = true;
    this.tray.setImage(image);
  }

  updateUpdateState(state: UpdateState): void {
    this.updateState = state;
    this.refresh();
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
    this.tray.setToolTip(trayTooltip(this.status));
    // lifetime: OK — replaces the previous menu, which is then collected; rebuilt only when status/settings change
    this.tray.setContextMenu(Menu.buildFromTemplate(this.menu()));
  }

  private menu(): MenuItemConstructorOptions[] {
    const s = this.status;
    const h = this.handlers;
    const slots: MenuItemConstructorOptions[] = [0, 1, 2, 3].map((slot) => ({
      label: `Slot ${slot}`,
      type: "radio",
      checked: s.slot === slot,
      enabled: s.dongle,
      click: () => h.command({ type: "switchSlot", slot }),
    }));
    return [
      { label: "Show / Hide", click: h.toggleWindow },
      { type: "separator" },
      { label: trayTooltip(s), enabled: false },
      { label: "Pairing slot", submenu: slots, enabled: s.dongle },
      { label: "Diagnostics", click: () => h.command({ type: "openPage", page: "diagnostics" }) },
      { type: "separator" },
      this.updateState.phase === "ready" ? { label: `Restart to update to ${this.updateState.version}`, click: h.restartToUpdate } : { label: "Check for updates", click: h.checkForUpdates },
      { type: "separator" },
      { label: "Close to tray", type: "checkbox", checked: this.settings.closeToTray, click: (item) => h.setSetting("closeToTray", item.checked) },
      { label: "Launch at login", type: "checkbox", checked: this.settings.launchAtLogin, click: (item) => h.setSetting("launchAtLogin", item.checked) },
      { label: "Start minimized", type: "checkbox", checked: this.settings.startMinimized, click: (item) => h.setSetting("startMinimized", item.checked) },
      { label: "Check for updates automatically", type: "checkbox", checked: this.settings.checkForUpdates, click: (item) => h.setSetting("checkForUpdates", item.checked) },
      ...(h.createDesktopShortcut ? [{ label: "Create desktop shortcut", click: h.createDesktopShortcut }] : []),
      { type: "separator" },
      { label: "Quit", click: h.quit },
    ];
  }
}
