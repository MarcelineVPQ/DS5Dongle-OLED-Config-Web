// The app's navigation rail, on the right edge (AVIEW's sidebar, mirrored):
// icons only by default, expanding over the page on hover or keyboard focus
// (closing right after a page is picked with the pointer);
// pinned open it takes its full width. Ctrl+B pins/unpins. The bottom shows
// the dongle's status (a colored dot plus a symbol, so it never relies on
// color alone) and the pin.
import { useEffect, useState, type ReactNode } from "react";
import { appVersionLabel, isDevelopmentBuild } from "./appVersion";
import { CLEAR_GLASS_RAIL, REGULAR_GLASS } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref } from "./storage";
import { lastBoardName } from "./hardwareName";
import { useTranslation } from "react-i18next";
import { protonApplies } from "./games/platform";
import { Gamepad2, Info, Joystick, PanelRightClose, PanelRightOpen, Settings, Usb } from "lucide-react";
import type { TFunction } from "i18next";
import type { Reminder } from "./notices";

export type RailItem = "controller" | "dongle" | "games" | "app" | "about";
const PIN_KEY = "ds5.railPinned";

// Each rail item's name (the board's page is named after the board).
export const railLabel = (t: TFunction, item: RailItem, device: string): string =>
  item === "controller"
    ? t("desktop.nav.controller")
    : item === "dongle"
      ? device
      : item === "games"
        ? t("desktop.nav.games", "Games")
        : item === "app"
          ? t("desktop.live.app", "App settings")
          : t("desktop.nav.about", "About");

// The tooltip's key: Games mentions Proton only where Proton applies (Linux).
export const railTip = (item: RailItem): string => (item === "games" && !protonApplies() ? "desktop.rail.tip.gamesWindows" : `desktop.rail.tip.${item}`);

interface Props {
  active: RailItem;
  onSelect: (item: RailItem) => void;
  gamesSupported: boolean;
  // Open tasks per rail item (notices.ts): a dot, or Games' count, with what's waiting as its tooltip.
  reminders: Partial<Record<RailItem, Reminder>>;
  connected: boolean;
  connecting: boolean;
  firmware: string | null;
  deviceLabel: string;
  device: string; // hardwareName()
}

export default function AppRail({ active, onSelect, gamesSupported, reminders, connected, connecting, firmware, deviceLabel, device }: Props) {
  const { t } = useTranslation();
  const [pinned, pin] = useFlagPref(PIN_KEY);
  const [glass] = useFlagPref(GLASS_KEY);
  // Clear glass while collapsed; the regular variant while open over content.
  const railRef = useGlass(glass, CLEAR_GLASS_RAIL, REGULAR_GLASS);
  // Picking a page closes the rail right away, like a menu: hover doesn't
  // reopen it until the pointer leaves the rail and comes back. Keyboard focus
  // only opens it when it's visible focus (Tab), not after a click.
  const [picked, setPicked] = useState(false);
  // lifetime: OK — cleanup: removes the Ctrl+B keydown listener (unmount / pin change)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        pin(!pinned);
      }
    };
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned, pin]);

  const link = (item: RailItem, icon: ReactNode) => {
    const label = railLabel(t, item, device);
    const reminder = reminders[item];
    const tip = item === "controller" && active === "controller" ? t("desktop.rail.controllerAgain") : `${label} · ${t(railTip(item))}`;
    return (
      <button
        type="button"
        className={`rail-link${active === item ? " active" : ""}`}
        data-rail={item}
        aria-current={active === item ? "page" : undefined}
        // What's there, in one line; on Controller again, what a second click
        // does; then what's waiting there.
        title={reminder ? `${tip}\n${reminder.tip}` : tip}
        aria-description={reminder?.tip}
        onClick={(e) => {
          onSelect(item);
          // A pointer click (detail > 0), not Enter/Space: close the rail now.
          if (e.detail > 0) setPicked(true);
        }}
      >
        <span className="rail-ic" aria-hidden="true">
          {icon}
          {reminder && (
            <span className={`rail-badge${reminder.count === null ? " dot" : ""}`} title={reminder.tip}>
              {reminder.count}
            </span>
          )}
        </span>
        <span className="rail-label">{label}</span>
      </button>
    );
  };

  // Before the device identifies itself: the last board that connected, or a
  // neutral line if none has yet.
  const lastBoard = connected ? null : lastBoardName();
  const status = connected
    ? `${t("desktop.status.connected")}${firmware ? ` · ${firmware}` : ""}`
    : connecting
      ? t("statusText.connecting")
      : lastBoard
        ? t("desktop.status.waiting")
        : t("desktop.status.waitingFirst");
  const pinLabel = pinned ? t("desktop.rail.collapse") : t("desktop.rail.pin");

  return (
    <div className={`rail-slot${pinned ? " pinned" : ""}`}>
      <nav className={`app-rail${picked ? " picked" : ""}`} ref={railRef} aria-label={t("desktop.rail.label")} onPointerLeave={() => setPicked(false)}>
        <div className="rail-nav">
          {link("controller", <Gamepad2 size={20} />)}
          {link("dongle", <Usb size={20} />)}
          {gamesSupported && link("games", <Joystick size={20} />)}
          <div className="rail-divider" />
          {link("app", <Settings size={20} />)}
          {link("about", <Info size={20} />)}
          {isDevelopmentBuild() && (
            <div className="rail-dev" title={t("desktop.rail.devHint")}>
              <b>{t("desktop.rail.development")}</b> · {appVersionLabel()}
            </div>
          )}
        </div>
        <div className="rail-footer">
          <div className={`rail-status ${connected ? "ok" : "warn"}`} title={connected ? `${status} (${deviceLabel})` : status} role="status">
            <span className="rail-ic" aria-hidden="true">
              <span className="rail-dot">{connected ? "✓" : "…"}</span>
            </span>
            <span className="rail-label rail-status-text">
              <span>{connected ? t("desktop.status.connected") : status}</span>
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
