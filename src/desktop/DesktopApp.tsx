import { Activity, Cpu, Gamepad2, Gauge, HardDriveDownload, Lightbulb, Link2, type LucideIcon, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../components/LanguageToggle";
import RemapEditor from "../components/RemapEditor";
import ThemeToggle from "../components/ThemeToggle";
import { useDs5Bridge, type UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { renderTrayIcon } from "./tray/trayIcon";
import UpdateBanners from "./UpdateBanners";
import UsbAccessSetup from "./UsbAccessSetup";
import { useAppUpdate, useFirmwareUpdate, type FirmwareUpdate } from "./useUpdates";
import { usePoll } from "./usePoll";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import FirmwarePage from "./pages/FirmwarePage";
import LightbarPage from "./pages/LightbarPage";
import OverviewPage from "./pages/OverviewPage";
import SettingsPage from "./pages/SettingsPage";
import SlotsPage from "./pages/SlotsPage";
import TriggersPage from "./pages/TriggersPage";
import "./desktop.css";

type PageId = "overview" | "settings" | "lightbar" | "remap" | "slots" | "triggers" | "diagnostics" | "firmware";

interface PageDef {
  id: PageId;
  label: string;
  icon: LucideIcon;
  render: (bridge: UseDs5BridgeResult, fw: FirmwareUpdate) => JSX.Element;
}

const APPLY_DEBOUNCE_MS = 150;

export default function DesktopApp() {
  const { t } = useTranslation();
  const bridge = useDs5Bridge();
  const appUpdate = useAppUpdate();
  const fw = useFirmwareUpdate(bridge, appUpdate);
  const [page, setPage] = useState<PageId>("settings");

  const pages: PageDef[] = [
    { id: "overview", label: t("desktop.nav.overview", "Overview"), icon: Gauge, render: (b) => <OverviewPage bridge={b} /> },
    { id: "settings", label: t("desktop.nav.settings", "Settings"), icon: SlidersHorizontal, render: (b) => <SettingsPage bridge={b} /> },
    { id: "lightbar", label: t("desktop.nav.lightbar", "Lightbar"), icon: Lightbulb, render: (b) => <LightbarPage bridge={b} /> },
    { id: "remap", label: t("desktop.nav.remap", "Remap"), icon: Gamepad2, render: (b) => <RemapEditor client={b.client} /> },
    { id: "slots", label: t("desktop.nav.slots", "Pairing slots"), icon: Link2, render: (b) => <SlotsPage bridge={b} /> },
    { id: "triggers", label: t("desktop.nav.triggers", "Trigger test"), icon: Activity, render: (b) => <TriggersPage bridge={b} /> },
    { id: "diagnostics", label: t("desktop.nav.diagnostics", "Diagnostics"), icon: Cpu, render: (b) => <DiagnosticsPage bridge={b} /> },
    { id: "firmware", label: t("desktop.nav.firmware", "Firmware"), icon: HardDriveDownload, render: (b, f) => <FirmwarePage bridge={b} fw={f} /> },
  ];
  const current = pages.find((p) => p.id === page) ?? pages[0];

  // Edits apply to the dongle's RAM as you make them (debounced), so every
  // change is heard and felt immediately. Saving to flash is a separate step.
  const { isDirty, issues, operation, applyConfig } = bridge;
  useEffect(() => {
    if (!isDirty || issues.length > 0 || operation) return;
    const timer = setTimeout(() => void applyConfig(), APPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isDirty, issues.length, operation, applyConfig]);

  const connected = bridge.isConnected;
  const busy = bridge.operation !== null;

  // Keep the tray icon/menu in step with the device, even while the window is
  // hidden (the window keeps running in the background for exactly this).
  const client = bridge.client;
  const liveIdentity = usePoll(() => client!.identity(), 2000, Boolean(client)).value;
  const firmware = bridge.firmwareVersion;
  const controllerOn = Boolean(connected && liveIdentity?.controllerConnected);
  const charging = controllerOn && Boolean(liveIdentity?.charging);
  const battery = controllerOn ? (liveIdentity?.battery ?? null) : null;
  const lightbar = controllerOn ? (liveIdentity?.lightbar ?? null) : null;
  const lightbarKey = lightbar ? lightbar.join(",") : "";
  useEffect(() => {
    window.desktop?.reportStatus({
      dongle: connected,
      controller: controllerOn,
      slot: connected && liveIdentity ? liveIdentity.currentSlot : -1,
      firmware: connected ? firmware : null,
      charging,
      battery,
    });
  }, [connected, controllerOn, liveIdentity, firmware, charging, battery]);

  // Redraw the tray icon only when something it shows changes.
  useEffect(() => {
    if (!window.desktop) return;
    const rgb = lightbarKey ? (lightbarKey.split(",").map(Number) as [number, number, number]) : null;
    let cancelled = false;
    void renderTrayIcon({ dot: !connected ? "none" : controllerOn ? "ok" : "away", lightbar: rgb, charging })
      .then((png) => !cancelled && window.desktop?.setTrayIcon(png))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connected, controllerOn, charging, lightbarKey]);

  useEffect(
    () =>
      window.desktop?.onTrayCommand((command) => {
        if (command.type === "openPage") {
          if (pages.some((p) => p.id === command.page)) setPage(command.page as PageId);
        } else if (command.type === "switchSlot") {
          void client?.switchSlot(command.slot).catch(() => undefined);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pages is rebuilt every render; ids never change
    [client],
  );

  return (
    <div className="dk">
      <aside className="dk-side">
        <div className="dk-brand">
          DS5 Dongle
          <small>{t("desktop.brandSub", "OLED Edition configurator")}</small>
        </div>
        {pages.map((p) => (
          <button type="button" key={p.id} className={`dk-nav-item${p.id === page ? " active" : ""}`} aria-current={p.id === page ? "page" : undefined} onClick={() => setPage(p.id)}>
            <p.icon size={15} />
            {p.label}
          </button>
        ))}
        <div className="dk-side-foot">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </aside>

      <div className="dk-main">
        <header className="dk-top">
          <h1>{current.label}</h1>
          <span className="dk-spacer" />
          {connected ? (
            <span className="dk-chip ok" title={bridge.deviceLabel}>
              <span className="dot" />
              {t("desktop.status.connected", "Dongle connected")}
              {bridge.firmwareVersion ? ` · ${bridge.firmwareVersion}` : ""}
            </span>
          ) : (
            <span className="dk-chip warn">
              <span className="dot" />
              {bridge.operation === "connecting" ? t("statusText.connecting") : t("desktop.status.waiting", "Waiting for the dongle…")}
            </span>
          )}
        </header>

        <main className="dk-body">
          <UpdateBanners app={appUpdate} fw={fw} onShowFirmware={() => setPage("firmware")} />
          {bridge.error && (
            <div className="dk-notice error" role="alert">
              <span>{bridge.error}</span>
              <span className="dk-spacer" />
              <button type="button" className="dk-btn" onClick={bridge.clearError}>
                {t("notice.dismiss")}
              </button>
            </div>
          )}
          {connected ? (
            current.render(bridge, fw)
          ) : (
            <div className="dk-empty">
              <div>
                <strong>{t("desktop.empty.title", "Plug in the DS5 Dongle")}</strong>
                {t("desktop.empty.body", "It connects automatically. Needs OLED Edition firmware v0.8 or newer.")}
                {!bridge.supported && <div className="dk-bad">{t("statusText.webusbUnavailable")}</div>}
                <UsbAccessSetup compact />
              </div>
            </div>
          )}
        </main>

        <footer className="dk-bar">
          <span className="dk-bar-note">
            {busy
              ? t(`statusText.${bridge.operation}`)
              : bridge.hasUnsavedChanges
                ? t("desktop.bar.unsaved", "Applied to the dongle, not saved yet: changes are lost when it powers off.")
                : connected
                  ? t("desktop.bar.saved", "All changes saved on the dongle.")
                  : ""}
          </span>
          <span className="dk-spacer" />
          <button type="button" className="dk-btn" disabled={!connected || busy || !bridge.hasUnsavedChanges} onClick={() => void bridge.revertToSaved()}>
            {t("desktop.bar.revert", "Revert")}
          </button>
          <button type="button" className="dk-btn primary" disabled={!connected || busy || !bridge.hasUnsavedChanges || bridge.isDirty} onClick={() => void bridge.saveToFlash()}>
            {t("desktop.bar.save", "Save to dongle")}
          </button>
        </footer>
      </div>
    </div>
  );
}
