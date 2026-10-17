// The app's navigation rail, on the right edge (AVIEW's sidebar, mirrored):
// icons only by default, expanding over the page on hover or keyboard focus
// (closing right after a page is picked with the pointer);
// pinned open it takes its full width. Ctrl+B (⌘B on macOS) pins/unpins. The bottom shows
// the dongle's status (a colored dot plus a symbol, so it never relies on
// color alone), the pin, and in the bottom corner the lock: locked, the rail
// stays collapsed (icons only; hover and keyboard focus no longer expand it),
// so its icons are a quick way to show and hide the settings panel without
// the rail opening and closing all the time. Pin and lock exclude each other
// (keeping it open unlocks it; locking it unpins it). Both remembered.
// Idle cost: none (CSS states; no timers or listeners added).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { appVersionLabel, isDevelopmentBuild } from "./appVersion";
import { CLEAR_GLASS_RAIL, REGULAR_GLASS } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref } from "./storage";
import { lastBoardName } from "./hardwareName";
import { useTranslation } from "react-i18next";
import { protonApplies } from "./games/platform";
import { Gamepad2, Info, Joystick, Lock, LockOpen, PanelRightClose, PanelRightOpen, Settings, Usb } from "lucide-react";
import type { TFunction } from "i18next";
import type { NoticeTask, Reminder } from "./notices";
import { panelTasks, togglePanel } from "./accordion/Section";

export type RailItem = "controller" | "dongle" | "games" | "app" | "about";
const PIN_KEY = "ds5.railPinned";
export const RAIL_LOCK_KEY = "ds5.railLocked";

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
// A rail item pressed (click, Enter or Space): the page you're on toggles
// its settings panel (every page alike, SplitView's togglePanel: shown or
// hidden, remembered per page); another page is navigated to (`go`). With a
// task waiting whose place isn't on screen (`placeShown` false: the panel
// hidden, its section folded, Games → Home behind a game page), the page
// you're on goes there too (`go` opens it), so the press always leads to
// what the dot is about.
export function railPress(item: RailItem, active: RailItem, go: (item: RailItem) => void, placeShown = true): void {
  if (item === active && placeShown) togglePanel();
  else go(item);
}

// A rail item pressed, with the app's open tasks: a dot on the item leads to
// its first task with a place there (a section, or a main-view block), the
// panel shown, from any page and from the page itself; otherwise railPress.
// `go` opens the page, and that place when there is one.
export function railSelect(pressed: RailItem, active: RailItem, tasks: readonly NoticeTask[], go: (item: RailItem, section?: string) => void): void {
  // loop: NOT-WORTH — N ≤ ~6 open tasks; on a click
  const section = tasks.find((task) => task.place === pressed && task.section)?.section;
  railPress(pressed, active, (item) => go(item, section), !section || taskPlaceShown(section));
}

// Whether a task's place (a section id, or a main-view block's) is on
// screen now: an open section in a shown panel, or a main-view block (always
// shown) on the page on screen.
export function taskPlaceShown(place: string): boolean {
  const id = CSS.escape(place);
  const el = document.querySelector(`.dk-split:not(.panel-hidden) .dk-split-panel .dk-sec.open[data-section="${id}"], .dk-split-main [data-block="${id}"]`);
  return !!el && el.getClientRects().length > 0;
}

// The pages (SplitView's `page`) behind each rail item; the first one mounted
// is the one on screen (a game page over Games → Home).
const RAIL_PAGES: Record<RailItem, readonly string[]> = { controller: ["controller"], dongle: ["dongle"], games: ["game", "games"], app: ["app"], about: ["about"] };

// An item's dot: its open tasks (notices.ts), plus, on the page you're on, a
// task in its hidden panel (`panelTask`, SplitView's panelTasks), the
// panel's only cue while hidden (once shown, the section carries the dot).
export function railDot(reminder: Reminder | undefined, panelTask: string | null): Reminder | undefined {
  if (!panelTask || reminder?.tip.split("\n").includes(panelTask)) return reminder;
  return reminder ? { count: reminder.count, tip: `${reminder.tip}\n${panelTask}` } : { count: null, tip: panelTask };
}

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
  const hiddenTasks = panelTasks.use();
  const [pinned, setPinned] = useFlagPref(PIN_KEY);
  const [locked, setLocked] = useFlagPref(RAIL_LOCK_KEY);
  // Kept open and locked collapsed exclude each other.
  const pin = useCallback(
    (on: boolean) => {
      setPinned(on);
      if (on) setLocked(false);
    },
    [setPinned, setLocked],
  );
  const lock = (on: boolean) => {
    setLocked(on);
    if (on) setPinned(false);
  };
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
    // loop: NOT-WORTH — N ≤ 2 pages per item; per render of the rail
    const page = active === item ? RAIL_PAGES[item].find((p) => hiddenTasks.has(p)) : undefined;
    const reminder = railDot(reminders[item], (page && hiddenTasks.get(page)) || null);
    const tip = `${label} · ${t(active === item ? "desktop.rail.again" : railTip(item))}`;
    return (
      <button
        type="button"
        className={`rail-link${active === item ? " active" : ""}`}
        data-rail={item}
        aria-current={active === item ? "page" : undefined}
        // What's there, in one line; on the page you're on, what a second
        // click (or Enter / Space) does: show / hide its settings panel, the
        // one way to (no button on the page); then what's waiting there.
        title={reminder ? `${tip}\n${reminder.tip}` : tip}
        aria-description={active === item ? (reminder ? `${t("desktop.rail.again")}\n${reminder.tip}` : t("desktop.rail.again")) : reminder?.tip}
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
  // The pin's shortcut as this platform writes it (the handler above takes Ctrl or ⌘).
  const mac = window.desktop?.platform === "darwin";
  const lockLabel = locked ? t("desktop.rail.unlock") : t("desktop.rail.lock");

  return (
    <div className={`rail-slot${pinned ? " pinned" : ""}`}>
      <nav className={`app-rail${picked ? " picked" : ""}${locked ? " locked" : ""}`} ref={railRef} aria-label={t("desktop.rail.label")} onPointerLeave={() => setPicked(false)}>
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
          <button
            type="button"
            className="rail-link rail-pin"
            title={`${pinLabel} (${mac ? "⌘B" : "Ctrl+B"})`}
            aria-keyshortcuts={mac ? "Meta+B" : "Control+B"}
            aria-pressed={pinned}
            onClick={() => pin(!pinned)}
          >
            <span className="rail-ic" aria-hidden="true">
              {pinned ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            </span>
            <span className="rail-label">{pinLabel}</span>
          </button>
          <button type="button" className="rail-lock" title={lockLabel} aria-label={lockLabel} aria-pressed={locked} onClick={() => lock(!locked)}>
            {locked ? <Lock size={13} aria-hidden="true" /> : <LockOpen size={13} aria-hidden="true" />}
          </button>
        </div>
      </nav>
    </div>
  );
}
