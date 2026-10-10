import { Activity, Cpu, Gamepad2, Gauge, HardDriveDownload, Lightbulb, Link2, type LucideIcon, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../components/LanguageToggle";
import RemapEditor from "../components/RemapEditor";
import ThemeToggle from "../components/ThemeToggle";
import { useDs5Bridge, type UseDs5BridgeResult } from "../hooks/useDs5Bridge";
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
  render: (bridge: UseDs5BridgeResult) => JSX.Element;
}

const APPLY_DEBOUNCE_MS = 150;

export default function DesktopApp() {
  const { t } = useTranslation();
  const bridge = useDs5Bridge();
  const [page, setPage] = useState<PageId>("settings");

  const pages: PageDef[] = [
    { id: "overview", label: t("desktop.nav.overview", "Overview"), icon: Gauge, render: (b) => <OverviewPage bridge={b} /> },
    { id: "settings", label: t("desktop.nav.settings", "Settings"), icon: SlidersHorizontal, render: (b) => <SettingsPage bridge={b} /> },
    { id: "lightbar", label: t("desktop.nav.lightbar", "Lightbar"), icon: Lightbulb, render: (b) => <LightbarPage bridge={b} /> },
    { id: "remap", label: t("desktop.nav.remap", "Remap"), icon: Gamepad2, render: (b) => <RemapEditor client={b.client} /> },
    { id: "slots", label: t("desktop.nav.slots", "Pairing slots"), icon: Link2, render: (b) => <SlotsPage bridge={b} /> },
    { id: "triggers", label: t("desktop.nav.triggers", "Trigger test"), icon: Activity, render: (b) => <TriggersPage bridge={b} /> },
    { id: "diagnostics", label: t("desktop.nav.diagnostics", "Diagnostics"), icon: Cpu, render: (b) => <DiagnosticsPage bridge={b} /> },
    { id: "firmware", label: t("desktop.nav.firmware", "Firmware"), icon: HardDriveDownload, render: (b) => <FirmwarePage bridge={b} /> },
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
            current.render(bridge)
          ) : (
            <div className="dk-empty">
              <div>
                <strong>{t("desktop.empty.title", "Plug in the DS5 Dongle")}</strong>
                {t("desktop.empty.body", "It connects automatically. Needs OLED Edition firmware v0.8 or newer.")}
                {!bridge.supported && <div className="dk-bad">{t("statusText.webusbUnavailable")}</div>}
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
