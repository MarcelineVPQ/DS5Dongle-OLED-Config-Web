import { Gamepad2, Info, Joystick, type LucideIcon, Settings2, ToggleLeft, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../components/LanguageToggle";
import ThemeToggle from "../components/ThemeToggle";
import { useDs5Bridge, type UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { renderTrayIcon } from "./tray/trayIcon";
import AboutPage, { type AboutTab } from "./pages/AboutPage";
import GamesPage, { allFixes, loadDeclined } from "./pages/GamesPage";
import type { GamesReport } from "./games/types";
import ButtonsPage from "./pages/ButtonsPage";
import ControllerPage from "./pages/ControllerPage";
import DonglePage from "./pages/DonglePage";
import SettingsCards from "./pages/SettingsPage";
import UpdateBanners from "./UpdateBanners";
import UsbAccessSetup from "./UsbAccessSetup";
import { useAppUpdate, useFirmwareUpdate, type FirmwareUpdate } from "./useUpdates";
import { usePoll } from "./usePoll";
import "./desktop.css";

type PageId = "controller" | "audio" | "buttons" | "dongle" | "games" | "about";

interface PageDef {
  id: PageId;
  label: string;
  icon: LucideIcon;
  badge?: number;
  standalone?: boolean; // works without the dongle (no "plug in" screen, no save bar)
  render: (bridge: UseDs5BridgeResult, fw: FirmwareUpdate) => JSX.Element;
}

const APPLY_DEBOUNCE_MS = 150;

export default function DesktopApp() {
  const { t } = useTranslation();
  const bridge = useDs5Bridge();
  const appUpdate = useAppUpdate();
  const fw = useFirmwareUpdate(bridge, appUpdate);
  const [page, setPage] = useState<PageId>("controller");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aboutTab, setAboutTab] = useState<AboutTab>("changes");
  const whatsNew = useWhatsNew();
  const games = useGamesAttention();
  const pages: PageDef[] = [
    { id: "controller", label: t("desktop.nav.controller", "Controller"), icon: Gamepad2, render: (b) => <ControllerPage bridge={b} /> },
    { id: "audio", label: t("desktop.nav.audio", "Audio & haptics"), icon: Volume2, render: (b) => <SettingsCards bridge={b} group="audio" /> },
    { id: "buttons", label: t("desktop.nav.buttons", "Buttons"), icon: ToggleLeft, render: (b) => <ButtonsPage bridge={b} /> },
    { id: "dongle", label: t("desktop.nav.dongle", "Dongle"), icon: Settings2, render: (b, f) => <DonglePage bridge={b} fw={f} advancedOpen={advancedOpen} /> },
    ...(games.supported
      ? [
          {
            id: "games" as const,
            label: t("desktop.nav.games", "Games"),
            icon: Joystick,
            badge: games.count,
            standalone: true,
            render: () => <GamesPage allowed={games.allowed} onAllowedChange={games.setAllowed} onScanned={games.update} onDeclinedChange={games.recount} />,
          },
        ]
      : []),
    { id: "about", label: t("desktop.nav.about", "About"), icon: Info, standalone: true, render: () => <AboutPage key={aboutTab} initialTab={aboutTab} /> },
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
          // The tray's "Diagnostics" lives under Dongle → Advanced now.
          if (command.page === "diagnostics") {
            setPage("dongle");
            setAdvancedOpen(true);
          } else if (pages.some((p) => p.id === command.page)) setPage(command.page as PageId);
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
        {pages.map((p) => (
          <button type="button" key={p.id} className={`dk-nav-item${p.id === page ? " active" : ""}`} aria-current={p.id === page ? "page" : undefined} onClick={() => setPage(p.id)}>
            <p.icon size={15} />
            {p.label}
            {p.badge ? (
              <span className="dk-badge" title={t("desktop.games.attention", { count: p.badge })}>
                {p.badge}
              </span>
            ) : null}
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
          <UpdateBanners app={appUpdate} fw={fw} onShowFirmware={() => setPage("dongle")} />
          {whatsNew.version && (
            <div className="dk-notice">
              <span>{t("desktop.about.updated", { version: whatsNew.version, defaultValue: "Updated to {{version}}." })}</span>
              <span className="dk-spacer" />
              <button
                type="button"
                className="dk-btn"
                onClick={() => {
                  setAboutTab("changes");
                  setPage("about");
                  whatsNew.dismiss();
                }}
              >
                {t("desktop.about.seeWhatsNew", "See what's new")}
              </button>
              <button type="button" className="dk-btn" onClick={whatsNew.dismiss}>
                {t("notice.dismiss")}
              </button>
            </div>
          )}
          {bridge.error && (
            <div className="dk-notice error" role="alert">
              <span>{bridge.error}</span>
              <span className="dk-spacer" />
              <button type="button" className="dk-btn" onClick={bridge.clearError}>
                {t("notice.dismiss")}
              </button>
            </div>
          )}
          {connected || current.standalone ? (
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

        {!current.standalone && (
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
        )}
      </div>
    </div>
  );
}

// Shows "Updated to X" once after the app version changes (not on first run).
const SEEN_KEY = "ds5-last-seen-version";
function useWhatsNew(): { version: string | null; dismiss: () => void } {
  const current = window.desktop?.appVersion ?? null;
  const [version, setVersion] = useState<string | null>(() => {
    if (!current) return null;
    let seen: string | null;
    try {
      seen = window.localStorage.getItem(SEEN_KEY);
      if (!seen) window.localStorage.setItem(SEEN_KEY, current);
    } catch {
      return null;
    }
    return seen && seen !== current ? current : null;
  });
  const dismiss = () => {
    try {
      if (current) window.localStorage.setItem(SEEN_KEY, current);
    } catch {
      // storage unavailable: the banner just reappears next launch
    }
    setVersion(null);
  };
  return { version, dismiss };
}

// Linux Games page: whether the user allowed it to read launcher settings, and
// how many recommended changes are waiting (the sidebar badge). The startup
// check only runs once the user has allowed it.
function useGamesAttention() {
  const supported = window.desktop?.platform === "linux";
  const [allowed, setAllowedState] = useState(false);
  const [count, setCount] = useState(0);
  const last = useRef<GamesReport | null>(null);
  const recount = useCallback(() => setCount(last.current ? allFixes(last.current).filter((f) => f.recommended && !loadDeclined().has(f.id)).length : 0), []);
  const update = useCallback(
    (report: GamesReport) => {
      last.current = report;
      recount();
    },
    [recount],
  );
  useEffect(() => {
    if (!supported) return;
    let live = true;
    void window.desktop!.getSettings().then((s) => {
      if (!live) return;
      setAllowedState(s.gamesScanAllowed);
      if (s.gamesScanAllowed)
        window.desktop!.gamesScan().then(
          (r) => live && update(r),
          () => undefined,
        );
    });
    return () => {
      live = false;
    };
  }, [supported, update]);
  const setAllowed = useCallback(
    (value: boolean) => {
      setAllowedState(value);
      if (!value) {
        last.current = null;
        recount();
      }
      void window.desktop!.setSetting("gamesScanAllowed", value);
    },
    [recount],
  );
  return { supported, allowed, setAllowed, count, update, recount };
}
