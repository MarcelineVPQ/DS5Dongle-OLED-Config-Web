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
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, PanelRightClose, PanelRightOpen, type LucideIcon } from "lucide-react";
import { useFlagPref } from "../storage";
import { reducedMotionNow } from "../motion";
import type { Accordion as AccordionState } from "./useAccordion";

const AccordionContext = createContext<AccordionState | null>(null);

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
  const shown = task || status || null;
  const revealed = acc.revealed?.id === id ? acc.revealed : null;
  // A deep link: scroll to it (or its row), focus the header, flash once.
  // lifetime: OK — the animationend listener fires once (once: true); acquires nothing else
  useEffect(() => {
    const el = ref.current;
    if (!revealed || !el) return;
    const row = revealed.row ? el.querySelector<HTMLElement>(`[data-row="${CSS.escape(revealed.row)}"]`) : null;
    const target = row ?? el;
    target.scrollIntoView({ block: "nearest" });
    el.querySelector<HTMLElement>(".dk-sec-toggle")?.focus({ preventScroll: true });
    if (reducedMotionNow()) return;
    target.classList.remove("dk-flash");
    void target.offsetWidth; // restart the animation for a second link to the same place
    target.classList.add("dk-flash");
    // lifetime: OK — fires once (once: true), when the one-shot flash ends
    target.addEventListener("animationend", () => target.classList.remove("dk-flash"), { once: true });
  }, [revealed]);
  const keepOpen = t("desktop.accordion.keepOpen", { section: title });
  return (
    <section ref={ref} className={`dk-sec${open ? " open" : ""}${pinned ? " pinned" : ""}`} data-section={id}>
      <div className="dk-sec-head">
        <button type="button" className="dk-sec-toggle" id={`${uid}-h`} aria-expanded={open} aria-controls={open ? `${uid}-b` : undefined} onClick={() => acc.toggle(id)}>
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
          <ChevronDown className="dk-sec-chev" size={15} aria-hidden="true" />
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

// A small heading inside a section's body (a group of rows).
export const SectionSub = ({ children }: { children: ReactNode }) => <h3 className="dk-subhead">{children}</h3>;

// A page with its main view on the left and the accordion panel on the
// right. Below ~760 px (the page's width, a container query) the panel is a
// drawer over the main view, opened with the button at the main view's top
// right. Wide, the same buttons hide and show the panel (remembered per page).
// `mainKey`: a new value starts the main view at its top (another text).
export function SplitView({
  page,
  main,
  mainKey,
  title,
  sub,
  state,
  children,
}: {
  page: string;
  main: ReactNode;
  mainKey?: string;
  title: ReactNode;
  sub?: ReactNode;
  state: AccordionState;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useFlagPref(`ds5.accordion.hidden.${page}`);
  const [drawer, setDrawer] = useState(false);
  const panel = useRef<HTMLElement>(null);
  // Narrow (the drawer) is a layout the stylesheet picks; asked at the click.
  const narrow = () => !!panel.current && getComputedStyle(panel.current).position === "absolute";
  const show = () => (narrow() ? setDrawer(true) : setHidden(false));
  const hide = () => (narrow() ? setDrawer(false) : setHidden(true));
  // A deep link on a narrow page opens the drawer to show it.
  const [link, setLink] = useState(state.revealed);
  if (link !== state.revealed) {
    setLink(state.revealed);
    if (state.revealed) setDrawer(true);
  }
  return (
    <div className={`dk-split${hidden ? " panel-hidden" : ""}${drawer ? " drawer-open" : ""}`}>
      <div className="dk-split-main" key={mainKey}>
        {main}
      </div>
      <button type="button" className="dk-btn dk-icon-btn dk-split-show" onClick={show} title={t("desktop.accordion.showPanel")} aria-label={t("desktop.accordion.showPanel")}>
        <PanelRightOpen size={14} />
      </button>
      <aside ref={panel} className="dk-split-panel" aria-label={typeof title === "string" ? title : undefined} onKeyDown={(e) => e.key === "Escape" && narrow() && setDrawer(false)}>
        <header className="dk-split-head">
          <div className="dk-split-titles">
            <h2 tabIndex={-1}>{title}</h2>
            {sub && <span className="dk-split-sub">{sub}</span>}
          </div>
          <button type="button" className="dk-btn dk-icon-btn" onClick={hide} title={t("desktop.accordion.hidePanel")} aria-label={t("desktop.accordion.hidePanel")}>
            <PanelRightClose size={14} />
          </button>
        </header>
        <Accordion state={state}>{children}</Accordion>
      </aside>
    </div>
  );
}
