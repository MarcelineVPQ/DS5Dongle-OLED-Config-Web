// The one settings framework: every page's settings are Sections (this file)
// holding Rows (controls.tsx: Row, and Toggle / Slider / Segmented, which are
// Rows). tools/list_settings.mjs is the gate: a settings card or a control
// outside a Section fails `npm run gates`.
//
// Section: a disclosure. Its header (a button, aria-expanded) shows a lucide
// icon, the title (Sony's term, docs/GLOSSARY.md), a live status summary
// (from state the page already has; cut with "…", the full text as its
// tooltip) and, for an open task, a yellow dot on the icon with the task as
// the status. The pin dot in the header's top-right corner keeps it open
// while others fold (a toggle button, aria-pressed). The body is a function,
// called only while the section is open: a closed section renders its header
// and nothing else (no polls, no images, no listeners). A notice for the
// section sits at the top of its body (`notice`).
//
// Keyboard: Tab goes header → its pin → the open body's controls → the next
// header; Enter/Space opens or folds (focus stays on the header); ↑ ↓ Home
// End move between headers (the WAI-ARIA accordion pattern).
//
// Idle cost: none. Opening plays one height transition (CSS, interpolate-size)
// and a deep link one flash (a CSS animation that ends); nothing repeats, and
// reduce motion turns both off.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronsDownUp, EllipsisVertical, PanelRightClose, PanelRightOpen, PinOff, type LucideIcon } from "lucide-react";
import { useFlagPref } from "../storage";
import { reducedMotionNow } from "../motion";
import type { Accordion as AccordionState } from "./useAccordion";
import { InfoTip } from "../controls";
import { MenuButton } from "../MenuButton";

const AccordionContext = createContext<AccordionState | null>(null);
// The panel around the sections (SplitView): whether it's shown, and where a
// section reports its open task (the dot on the panel's show button). Outside
// a SplitView: shown, no report.
interface PanelInfo {
  shown: boolean;
  reportTask: (id: string, task: string | null) => void;
}
const PanelContext = createContext<PanelInfo>({ shown: true, reportTask: () => undefined });

// Arrow keys between the headers of one accordion.
function onHeaderKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (!(e.target instanceof HTMLElement) || !e.target.classList.contains("dk-sec-toggle")) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const heads = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > .dk-sec > .dk-sec-head > .dk-sec-toggle")];
  const at = heads.indexOf(e.target as HTMLButtonElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? heads.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + heads.length) % heads.length;
  e.preventDefault();
  heads[next]?.focus();
}

// The sections of one page, sharing its accordion state.
export function Accordion({ state, children, className }: { state: AccordionState; children: ReactNode; className?: string }) {
  return (
    <AccordionContext.Provider value={state}>
      <div className={`dk-accordion${className ? ` ${className}` : ""}`} onKeyDown={onHeaderKeys}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

interface SectionProps {
  id: string; // stable: deep links and pins
  icon: LucideIcon;
  title: string;
  status?: string | null;
  task?: string | null | false; // an open task: the yellow dot, said as the status
  notice?: ReactNode;
  children: () => ReactNode; // called only while open
}

export function Section({ id, icon: Icon, title, status, task, notice, children }: SectionProps) {
  const { t } = useTranslation();
  const acc = useContext(AccordionContext);
  if (!acc) throw new Error("Section outside an Accordion");
  const open = acc.isOpen(id);
  const pinned = acc.isPinned(id);
  const uid = useId();
  const ref = useRef<HTMLElement>(null);
  const revealed = acc.revealed?.id === id ? acc.revealed : null;
  const { shown, reportTask } = useContext(PanelContext);
  // The open task, for the dot on the panel's show button (SplitView).
  // lifetime: OK — cleanup: takes the task back (unmount / the task changes)
  useEffect(() => {
    if (!task) return;
    reportTask(id, task);
    return () => reportTask(id, null);
  }, [id, task, reportTask]);
  // The deep link already shown (a link that came while the panel was hidden is shown when it's shown).
  // cache: NOT-WORTH — key=none (the last link's number); invalidated=each new link; bound=1 number
  const shownLink = useRef(0);
  // A deep link: scroll to it (or its row), focus the header, flash once (the panel hidden: once it's shown).
  // lifetime: OK — showLinked's cleanup removes its transitionend listener (unmount / the next link / the panel hidden)
  useEffect(() => {
    const el = ref.current;
    if (!revealed || !el || !shown || shownLink.current === revealed.n) return;
    shownLink.current = revealed.n;
    const row = revealed.row ? el.querySelector<HTMLElement>(`[data-row="${CSS.escape(revealed.row)}"]`) : null;
    // A row in a body that's opening is scrolled to again once the body has grown, or it stays out of view.
    return showLinked(el, row ?? el, row ? el.querySelector<HTMLElement>(".dk-sec-body") : null, el.querySelector<HTMLElement>(".dk-sec-toggle"), "nearest");
  }, [revealed, shown]);
  const keepOpen = t("desktop.accordion.keepOpen", { section: title });
  return (
    <section ref={ref} className={`dk-sec${open ? " open" : ""}${pinned ? " pinned" : ""}`} data-section={id}>
      <div className="dk-sec-head">
        <button type="button" className="dk-sec-toggle" id={`${uid}-h`} aria-expanded={open} aria-controls={open ? `${uid}-b` : undefined} onClick={() => acc.toggle(id)}>
          <HeadContent icon={Icon} title={title} status={status} task={task} />
        </button>
        <button
          type="button"
          className="dk-sec-pin"
          aria-pressed={pinned}
          aria-label={keepOpen}
          title={pinned ? t("desktop.accordion.pinned") : t("desktop.accordion.pin")}
          onClick={() => acc.pin(id)}
        >
          <i />
        </button>
      </div>
      {open && (
        <div className="dk-sec-body" role="region" id={`${uid}-b`} aria-labelledby={`${uid}-h`}>
          {notice}
          {children()}
        </div>
      )}
    </section>
  );
}

// What a header button shows, for a Section and a main-view MainBlock alike:
// the icon (with the yellow dot for an open task), the title, the live status
// (or the task, said instead) and, for a Section, the chevron.
export function HeadContent({ icon: Icon, title, status, task, chevron = true }: { icon: LucideIcon; title: string; status?: string | null; task?: string | null | false; chevron?: boolean }) {
  const shown = task || status || null;
  return (
    <>
      <span className="dk-sec-ic" aria-hidden="true">
        <Icon size={15} />
        {task && <i className="dk-sec-task" />}
      </span>
      <span className="dk-sec-title">{title}</span>
      {shown && (
        <span className={`dk-sec-status${task ? " warn" : ""}`} title={shown}>
          {shown}
        </span>
      )}
      {chevron && <ChevronDown className="dk-sec-chev" size={15} aria-hidden="true" />}
    </>
  );
}

// Where a deep link lands (a Section, or a main-view MainBlock): `target`
// (the place, or a row in it) scrolled into view, and again once `body` has
// grown (its open transition); the focus to `head`, unless the link already
// put it inside `el` (a drawing click focuses its button's row); `target`
// flashed once. Returns the cleanup (the transitionend listener).
export function showLinked(el: HTMLElement, target: HTMLElement, body: HTMLElement | null, head: HTMLElement | null, block: ScrollLogicalPosition): () => void {
  const scroll = () => target.scrollIntoView({ block });
  scroll();
  // lifetime: OK — fires once (once: true), when the body's open transition ends; removed by the returned cleanup if it never does
  body?.addEventListener("transitionend", scroll, { once: true });
  const cleanup = () => body?.removeEventListener("transitionend", scroll);
  if (!el.contains(document.activeElement)) head?.focus({ preventScroll: true });
  if (reducedMotionNow()) return cleanup;
  target.classList.remove("dk-flash");
  void target.offsetWidth; // restart the animation for a second link to the same place
  target.classList.add("dk-flash");
  // lifetime: OK — fires once (once: true), when the one-shot flash ends
  target.addEventListener("animationend", () => target.classList.remove("dk-flash"), { once: true });
  return cleanup;
}

// A small heading inside a section's body (a group of rows).
export const SectionSub = ({ children }: { children: ReactNode }) => <h3 className="dk-subhead">{children}</h3>;

// A group of rows inside a section's body, with its small heading (what a
// card was before the accordion): a line above it separates it from the rows before.
// `info`: the group's longer explanation, behind the ⓘ beside its heading (InfoTip).
export function SectionGroup({ title, info, children }: { title?: ReactNode; info?: string; children: ReactNode }) {
  return (
    <div className="dk-sec-group">
      {title && (
        <SectionSub>
          {title}
          {info && <InfoTip text={info} />}
        </SectionSub>
      )}
      {children}
    </div>
  );
}

// Whether a page's panel is hidden (its hide button, or the rail's item clicked again).
// Remembered per page (storage.ts, saved at once); a page not visited yet shows it.
// Narrow (the drawer), the same state: shown = the drawer open.
export const PANEL_HIDDEN_KEY = (page: string) => `ds5.accordion.hidden.${page}`;

// The rail's item of the page you're on, clicked again (or Enter / Space on
// it): the shown page's SplitView shows or hides its panel. Every page alike.
const PANEL_TOGGLE_EVENT = "ds5:toggle-panel";
export const togglePanel = () => window.dispatchEvent(new Event(PANEL_TOGGLE_EVENT));

// A page with its main view on the left and the accordion panel on the
// right. Below ~760 px (the page's width, a container query) the panel is a
// drawer over the main view, opened with the button at the main view's top
// right. Wide, the same buttons hide and show the panel (remembered per page).
// `mainKey`: a new value starts the main view at its top (another text).
// `top`: above the sections (a page-wide note, like the profile being edited).
// `panelRef`: the panel element (the Glass style's lensing on the live pages).
export function SplitView({
  page,
  main,
  mainKey,
  title,
  sub,
  top,
  state,
  panelRef,
  children,
}: {
  page: string;
  main: ReactNode;
  mainKey?: string;
  title: ReactNode;
  sub?: ReactNode;
  top?: ReactNode;
  state: AccordionState;
  panelRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useFlagPref(PANEL_HIDDEN_KEY(page));
  const panel = useRef<HTMLElement | null>(null);
  // Stable, so the panel's ref isn't handed over again on every render.
  const setPanel = useCallback(
    (el: HTMLElement | null) => {
      panel.current = el;
      panelRef?.(el);
    },
    [panelRef],
  );
  // Narrow (the drawer) is a layout the stylesheet picks; asked at the key press.
  const narrow = () => !!panel.current && getComputedStyle(panel.current).position === "absolute";
  const show = () => setHidden(false);
  const hide = () => setHidden(true);
  // The rail's toggle: only the page on screen answers (a hidden pane, like
  // Games → Home behind a game page, stays as it is).
  // lifetime: OK — cleanup: removes the rail's toggle listener (unmount / the panel's state changes)
  useEffect(() => {
    const onToggle = () => {
      if (panel.current?.closest(".dk-split")?.getClientRects().length) setHidden(!hidden);
    };
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener(PANEL_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(PANEL_TOGGLE_EVENT, onToggle);
  }, [hidden, setHidden]);
  // A deep link shows the panel (the drawer, narrow) to show its place;
  // arriving through the rail's task dot (keepHidden) leaves a hidden panel
  // hidden: the section is opened and marked, and shown when the panel is.
  // lifetime: OK — acquires nothing (writes the remembered state once per link)
  useEffect(() => {
    if (state.revealed && !state.revealed.keepHidden) setHidden(false);
  }, [state.revealed, setHidden]);
  // The sections' open tasks: a dot on the show button while the panel is hidden.
  const [tasks, setTasks] = useState<ReadonlyArray<readonly [string, string]>>([]);
  const reportTask = useCallback((id: string, task: string | null) => {
    // loop: NOT-WORTH — N ≤ a page's sections; when a section's task changes
    setTasks((now) => [...now.filter(([at]) => at !== id), ...(task ? [[id, task] as const] : [])]);
  }, []);
  const panelInfo = useMemo(() => ({ shown: !hidden, reportTask }), [hidden, reportTask]);
  const task = tasks[0]?.[1];
  const showLabel = task ? t("desktop.accordion.showPanelTask", { task }) : t("desktop.accordion.showPanel");
  return (
    <div className={`dk-split${hidden ? " panel-hidden" : " drawer-open"}`}>
      <div className="dk-split-main" key={mainKey}>
        {main}
      </div>
      <button type="button" className="dk-btn dk-icon-btn dk-split-show" onClick={show} title={showLabel} aria-label={showLabel}>
        <PanelRightOpen size={14} />
        {task && <i className="dk-sec-task" aria-hidden="true" />}
      </button>
      {/* Hidden: display none (wide) or the closed drawer, still laid out
          off-screen under visibility hidden (narrow); said hidden in both. */}
      <aside
        ref={setPanel}
        className="dk-split-panel"
        aria-label={typeof title === "string" ? title : undefined}
        aria-hidden={hidden || undefined}
        onKeyDown={(e) => e.key === "Escape" && narrow() && hide()}
      >
        <header className="dk-split-head">
          <div className="dk-split-titles">
            <h2 tabIndex={-1}>{title}</h2>
            {sub && <span className="dk-split-sub">{sub}</span>}
          </div>
          <PanelMenu state={state} />
          <button type="button" className="dk-btn dk-icon-btn" onClick={hide} title={t("desktop.accordion.hidePanel")} aria-label={t("desktop.accordion.hidePanel")}>
            <PanelRightClose size={14} />
          </button>
        </header>
        {top}
        <PanelContext.Provider value={panelInfo}>
          <Accordion state={state}>{children}</Accordion>
        </PanelContext.Provider>
      </aside>
    </div>
  );
}

// The panel menu: the small ⋮ in every settings panel's header (SplitView, so
// every page alike), on the app's one popup menu (MenuButton). Collapse all
// folds every section, pinned ones too (they stay pinned and open again next
// visit); Clear pins removes this page's pins (the controller page: this
// board and slot's). No "Expand all": every body open at once would render
// and poll everything. An item with nothing to do is disabled, its tooltip
// says why.
function PanelMenu({ state }: { state: AccordionState }) {
  const { t } = useTranslation();
  return (
    <MenuButton label={t("desktop.accordion.menu")} align="end" content={<EllipsisVertical size={14} />}>
      <>
        <button type="button" role="menuitem" disabled={!state.anyOpen} title={state.anyOpen ? t("desktop.accordion.collapseAllTip") : t("desktop.accordion.nothingOpen")} onClick={state.collapseAll}>
          <ChevronsDownUp size={14} aria-hidden="true" />
          {t("desktop.accordion.collapseAll")}
        </button>
        <button type="button" role="menuitem" disabled={!state.hasPins} title={state.hasPins ? t("desktop.accordion.clearPinsTip") : t("desktop.accordion.noPins")} onClick={state.clearPins}>
          <PinOff size={14} aria-hidden="true" />
          {t("desktop.accordion.clearPins")}
        </button>
      </>
    </MenuButton>
  );
}
