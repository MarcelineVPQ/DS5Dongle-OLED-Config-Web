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
//
// Several boards (any number, protocol 1.20 tells them apart): the status
// becomes a stack, one row per board (its name, connection, firmware,
// controller and slot), the board in use marked. A row shows that board and
// flashes "THIS ONE" on its OLED; the board in use's row just flashes it.
// At most BOARD_ROWS rows show; the rest are in the "N more…" list, which
// can be searched. Collapsed (icons only), the board in use shows with the
// number of boards on its icon, and the list button. A simulated board
// (Developer card) is a row too, marked as simulated, never a green check.
// Idle cost: none (CSS states; no timers or listeners added; the other
// boards' reads live in useDs5Bridge, every 15 s while shown).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BoardSummary } from "../hooks/boards";
import { MenuButton } from "./MenuButton";
import { appVersionLabel, isDevelopmentBuild } from "./appVersion";
import { CLEAR_GLASS_RAIL, REGULAR_GLASS } from "./glass/variants";
import { useGlass } from "./glass/useGlass";
import { GLASS_KEY } from "./glass/glassPref";
import { useFlagPref } from "./storage";
import { lastBoardName } from "./hardwareName";
import { useTranslation } from "react-i18next";
import { protonApplies } from "./games/platform";
import { ChevronsUpDown, FlaskConical, Gamepad2, Info, Joystick, Lock, LockOpen, PanelRightClose, PanelRightOpen, Settings, Usb } from "lucide-react";
import type { TFunction } from "i18next";
import type { NoticeTask, Reminder } from "./notices";
import { panelTasks, togglePanel } from "./accordion/Section";

export type RailItem = "controller" | "dongle" | "games" | "app" | "about";
// How many board rows the stack shows before "N more…".
export const BOARD_ROWS = 3;
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
  // Every board on USB (useDs5Bridge.boards) and the one in use.
  boards?: readonly BoardSummary[];
  currentBoard?: string | null;
  onBoard?: (key: string) => void;
}

// A board's lines in the stack: its name (or "Simulated board"), its
// firmware, and its controller and slot (or why it can't be read).
export function boardLines(t: TFunction, b: BoardSummary, device: string): { name: string; version: string; detail: string } {
  const name = b.kind === "simulated" ? t("desktop.boards.simulated") : (b.name ?? device);
  const controller = b.model === "edge" ? "DualSense Edge" : "DualSense";
  const detail =
    b.reach === "busy"
      ? t("desktop.boards.busy")
      : b.reach === "unreadable"
        ? t("desktop.boards.unreadable")
        : `${b.controllerConnected ? controller : t("desktop.boards.noController")} · ${t("desktop.boards.slot", { slot: b.slot ?? 0 })}`;
  return { name, version: b.version ?? "", detail };
}

// The rows on show: the first BOARD_ROWS, with the board in use always among them.
export function shownBoards<T extends { key: string }>(boards: readonly T[], current: string | null): T[] {
  const first = boards.slice(0, BOARD_ROWS);
  // loop: NOT-WORTH — N ≤ boards on USB (a few, up to ~20); per rail render
  if (!current || first.some((b) => b.key === current)) return first;
  // loop: NOT-WORTH — N ≤ boards on USB; per rail render
  const cur = boards.find((b) => b.key === current);
  return cur ? [...first.slice(0, BOARD_ROWS - 1), cur] : first;
}

// The search in the board list: any of its lines, or its id.
export function boardMatches(lines: { name: string; version: string; detail: string }, b: BoardSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [lines.name, lines.version, lines.detail, b.boardId ?? "", b.serial ?? ""].join(" ").toLowerCase().includes(q);
}

function BoardStack({ boards, current, onBoard, device }: { boards: readonly BoardSummary[]; current: string | null; onBoard: (key: string) => void; device: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  // loop: NOT-WORTH — N = boards on USB (up to ~20); per rail render (a board change)
  const lines = useMemo(() => new Map(boards.map((b) => [b.key, boardLines(t, b, device)])), [boards, t, device]);
  const rows = shownBoards(boards, current);
  const more = boards.length - rows.length;
  const tipFor = (b: BoardSummary) => {
    const l = lines.get(b.key)!;
    // loop: HOT-PATH-OK — N = 3 lines per row tooltip, per rail render
    const what = [l.name, l.version, l.detail].filter(Boolean).join("\n");
    return `${what}\n${t(b.key === current ? "desktop.boards.identifyTip" : "desktop.boards.switchTip")}`;
  };
  // A board's icon: a check only for a real board in use; the simulated one
  // its flask; "!" when it can't be read; else a plain dot.
  const icon = (b: BoardSummary) => (b.kind === "simulated" ? <FlaskConical size={11} /> : b.reach !== "ok" ? "!" : b.key === current ? "✓" : "•");
  const tone = (b: BoardSummary) => (b.kind === "simulated" ? "sim" : b.reach !== "ok" ? "warn" : b.key === current ? "ok" : "idle");
  return (
    <div className={`rail-boards${more > 0 ? "" : " few"}`} role="group" aria-label={t("desktop.boards.label")}>
      <div className="rail-boards-head rail-label" role="status">
        {t("desktop.boards.count", { count: boards.length })}
      </div>
      {/* loop: NOT-WORTH — N ≤ BOARD_ROWS rows; per rail render */}
      {rows.map((b) => {
        const l = lines.get(b.key)!;
        const isCurrent = b.key === current;
        return (
          <button
            key={b.key}
            type="button"
            className={`rail-status rail-board ${tone(b)}${isCurrent ? " current" : ""}`}
            aria-current={isCurrent ? "true" : undefined}
            title={tipFor(b)}
            aria-label={`${l.name}, ${l.detail}${l.version ? `, ${l.version}` : ""}${isCurrent ? `, ${t("desktop.boards.current")}` : ""}`}
            aria-description={t(isCurrent ? "desktop.boards.identifyTip" : "desktop.boards.switchTip")}
            onClick={() => onBoard(b.key)}
          >
            <span className="rail-ic" aria-hidden="true">
              <span className="rail-dot">{icon(b)}</span>
              {isCurrent && <span className="rail-badge rail-board-count">{boards.length}</span>}
            </span>
            <span className="rail-label rail-status-text">
              <span>{l.name}</span>
              {l.version && <span className="rail-status-sub">{l.version}</span>}
              <span className="rail-status-sub rail-board-detail">{l.detail}</span>
            </span>
          </button>
        );
      })}
      <MenuButton
        label={t("desktop.boards.all")}
        title={t("desktop.boards.all")}
        className="rail-link rail-boards-more"
        iconOnly={false}
        align="end"
        onClose={() => setQuery("")}
        content={
          <>
            <span className="rail-ic" aria-hidden="true">
              <ChevronsUpDown size={18} />
            </span>
            <span className="rail-label">{more > 0 ? t("desktop.boards.more", { count: more }) : t("desktop.boards.all")}</span>
          </>
        }
        header={
          <input
            className="dk-input rail-boards-search"
            type="search"
            data-autofocus
            aria-label={t("desktop.boards.find")}
            placeholder={t("desktop.boards.find")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget.parentElement?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
              }
            }}
          />
        }
      >
        {/* loop: NOT-WORTH — N = boards on USB (up to ~20); only while the list is open */}
        {boards
          .filter((b) => boardMatches(lines.get(b.key)!, b, query))
          .map((b) => {
            const l = lines.get(b.key)!;
            return (
              <button key={b.key} type="button" role="menuitemradio" aria-checked={b.key === current} className="dk-menu-item rail-boards-item" title={tipFor(b)} onClick={() => onBoard(b.key)}>
                <span className={`rail-dot ${tone(b)}`} aria-hidden="true">
                  {icon(b)}
                </span>
                <span className="rail-status-text">
                  <span>{l.name}</span>
                  {/* loop: HOT-PATH-OK — N = 2 lines per list item, only while the list is open */}
                  <span className="rail-status-sub">{[l.detail, l.version].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            );
          })}
      </MenuButton>
    </div>
  );
}

export default function AppRail({ active, onSelect, gamesSupported, reminders, connected, connecting, firmware, deviceLabel, device, boards = [], currentBoard = null, onBoard }: Props) {
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
          {/* With several boards, or a simulated one: the stack; else the one status line. */}
          {onBoard && (boards.length > 1 || boards[0]?.kind === "simulated") ? (
            <BoardStack boards={boards} current={currentBoard} onBoard={onBoard} device={device} />
          ) : (
            <div className={`rail-status ${connected ? "ok" : "warn"}`} title={connected ? `${status} (${deviceLabel})` : status} role="status">
              <span className="rail-ic" aria-hidden="true">
                <span className="rail-dot">{connected ? "✓" : "…"}</span>
              </span>
              <span className="rail-label rail-status-text">
                <span>{connected ? t("desktop.status.connected") : status}</span>
                {connected && firmware && <span className="rail-status-sub">{firmware}</span>}
              </span>
            </div>
          )}
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
