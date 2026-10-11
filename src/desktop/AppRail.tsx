// The app's navigation rail, on the right edge (AVIEW's sidebar, mirrored):
// icons only by default, expanding over the page on hover or keyboard focus;
// pinned open it takes its full width. Ctrl+B pins/unpins. The bottom shows
// the dongle's status (a colored dot plus a symbol, so it never relies on
// color alone) and the pin.
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Gamepad2, Info, Joystick, PanelRightClose, PanelRightOpen, Settings, Usb } from "lucide-react";

export type RailItem = "controller" | "dongle" | "games" | "app" | "about";
const PIN_KEY = "ds5.railPinned";

interface Props {
  active: RailItem;
  onSelect: (item: RailItem) => void;
  gamesSupported: boolean;
  gamesBadge: number;
  connected: boolean;
  connecting: boolean;
  firmware: string | null;
  deviceLabel: string;
}

export default function AppRail({ active, onSelect, gamesSupported, gamesBadge, connected, connecting, firmware, deviceLabel }: Props) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(() => {
    try {
      return window.localStorage.getItem(PIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const pin = (next: boolean) => {
    setPinned(next);
    try {
      window.localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      // storage blocked: lasts for this session
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setPinned((p) => {
          try {
            window.localStorage.setItem(PIN_KEY, p ? "0" : "1");
          } catch {
            // ignore
          }
          return !p;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const link = (item: RailItem, label: string, icon: ReactNode, badge?: number) => (
    <button type="button" className={`rail-link${active === item ? " active" : ""}`} aria-current={active === item ? "page" : undefined} title={label} onClick={() => onSelect(item)}>
      <span className="rail-ic" aria-hidden="true">
        {icon}
        {badge ? <span className="rail-badge">{badge}</span> : null}
      </span>
      <span className="rail-label">{label}</span>
    </button>
  );

  const status = connected
    ? `${t("desktop.status.connected", "Dongle connected")}${firmware ? ` · ${firmware}` : ""}`
    : connecting
      ? t("statusText.connecting")
      : t("desktop.status.waiting", "Waiting for the dongle…");
  const pinLabel = pinned ? t("desktop.rail.collapse") : t("desktop.rail.pin");

  return (
    <div className={`rail-slot${pinned ? " pinned" : ""}`}>
      <nav className="app-rail" aria-label={t("desktop.rail.label")}>
        <div className="rail-nav">
          {link("controller", t("desktop.nav.controller"), <Gamepad2 size={20} />)}
          {link("dongle", t("desktop.nav.dongle", "Dongle"), <Usb size={20} />)}
          {gamesSupported && link("games", t("desktop.nav.games", "Games"), <Joystick size={20} />, gamesBadge)}
          <div className="rail-divider" />
          {link("app", t("desktop.live.app", "App settings"), <Settings size={20} />)}
          {link("about", t("desktop.nav.about", "About"), <Info size={20} />)}
        </div>
        <div className="rail-footer">
          <div className={`rail-status ${connected ? "ok" : "warn"}`} title={connected ? `${status} (${deviceLabel})` : status} role="status">
            <span className="rail-ic" aria-hidden="true">
              <span className="rail-dot">{connected ? "✓" : "…"}</span>
            </span>
            <span className="rail-label">{status}</span>
          </div>
          <button type="button" className="rail-link rail-pin" title={`${pinLabel} (Ctrl+B)`} aria-pressed={pinned} onClick={() => pin(!pinned)}>
            <span className="rail-ic" aria-hidden="true">
              {pinned ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            </span>
            <span className="rail-label">{pinLabel}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
