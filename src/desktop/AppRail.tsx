// The app's navigation rail, on the right edge (AVIEW's sidebar, mirrored):
// icons only by default, expanding over the page on hover or keyboard focus;
// pinned open it takes its full width. Ctrl+B pins/unpins. The bottom shows
// the dongle's status (a colored dot plus a symbol, so it never relies on
// color alone) and the pin.
import { useEffect, type ReactNode } from "react";
import { CLEAR_GLASS_RAIL, REGULAR_GLASS } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref } from "./storage";
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
  const [pinned, pin] = useFlagPref(PIN_KEY);
  const [glass] = useFlagPref(GLASS_KEY);
  // Clear glass while collapsed; the regular variant while open over content.
  const railRef = useGlass(glass, CLEAR_GLASS_RAIL, REGULAR_GLASS);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        pin(!pinned);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned, pin]);

  const link = (item: RailItem, label: string, icon: ReactNode, badge?: number) => (
    <button
      type="button"
      className={`rail-link${active === item ? " active" : ""}`}
      aria-current={active === item ? "page" : undefined}
      title={item === "controller" && active === "controller" ? t("desktop.rail.controllerAgain") : label}
      onClick={() => onSelect(item)}
    >
      <span className="rail-ic" aria-hidden="true">
        {icon}
        {badge ? (
          <span className="rail-badge" title={t("desktop.games.attention", { count: badge })}>
            {badge}
          </span>
        ) : null}
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
      <nav className="app-rail" ref={railRef} aria-label={t("desktop.rail.label")}>
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
            <span className="rail-label rail-status-text">
              <span>{connected ? t("desktop.status.connected", "Dongle connected") : status}</span>
              {connected && firmware && <span className="rail-status-sub">{firmware}</span>}
            </span>
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
