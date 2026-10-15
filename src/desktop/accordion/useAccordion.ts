// The accordion's state for one page: which section is open, which are
// pinned, and deep links into it. One section is open at a time; a pinned
// section stays open while others fold. Closed sections don't render their
// body at all (Section.tsx), so nothing in them polls or loads.
//
// Remembered across restarts (local storage, storage.ts):
//   - the open (unpinned) section, per page (OPEN_KEY);
//   - the pins, per pin scope (PINS_KEY): the controller page pins per board
//     and pairing slot, every game page shares one set (pinScope).
// First visit (nothing remembered yet): the first section with a task dot
// opens, else none (the pinned ones stay open as always).
//
// The panel menu (SplitView): Collapse all folds every section, the pinned
// ones too, for this visit only (the pins are kept, so they open again the
// next time the page mounts; a folded pinned section's header opens it
// again); Clear pins removes this scope's pins.
//
// Deep links: revealSection(page, id, row?) from anywhere (a rail dot, a
// notice's "Go to", a tile) opens that section on its page, scrolls it into
// view, moves the focus to its header and flashes it once. A page that isn't
// shown yet picks the link up when it mounts. A link made with keepHidden
// (arriving on a page through its rail item's task dot) leaves a hidden panel
// hidden: the section opens, and is scrolled to and flashed once the panel is
// shown (SplitView, Section.tsx).
//
// Idle cost: none. No timers, no polling, no animation loops; state changes
// only on a click, a key or a deep link.
import { useEffect, useState } from "react";
import { externalStore } from "../externalStore";
import { readPref, writePref } from "../storage";
import { readPrefJson } from "../persistedPref";
import { salvageStrings } from "../../persisted";
import type { SectionId, AccordionPage } from "./sections";

export const OPEN_KEY = (page: AccordionPage) => `ds5.accordion.open.${page}`;
export const PINS_KEY = (scope: string) => `ds5.accordion.pins.${scope}`;
// What the remembered open section is when every section is folded.
const NONE = "";

// Where a page's pins are kept. The controller page: per board and pairing
// slot (never the controller's serial, which the board doesn't report for
// every model); every game page shares one set; other pages, one each.
export function pinScope(page: AccordionPage, board?: string | null, slot?: number | null): string {
  if (page === "controller") return `controller:${board ?? "board"}:${slot ?? 0}`;
  return page;
}

// A scope's stored pins. A damaged list keeps the pins that still read, and
// the notice says so (readPrefJson, batch E1).
export function readPins(scope: string): string[] {
  return readPrefJson(PINS_KEY(scope), { kind: "pins", salvage: (data) => salvageStrings(data), fallback: () => [] });
}

export interface Reveal {
  page: AccordionPage;
  id: string;
  row?: string;
  n: number; // a new link to the same section reveals it again
  keepHidden?: boolean; // a hidden panel stays hidden (the rail's task dot)
}

// The pending deep link (one at a time: the newest wins).
// cache: OK — key=none (the one pending link); invalidated=the page it targets takes it (set to null); bound=1 link
const pending = externalStore<Reveal | null>(null);
let revealCount = 0;

export function revealSection<P extends AccordionPage>(page: P, id: SectionId<P>, row?: string, opts?: { keepHidden?: boolean }): void {
  pending.set({ page, id, row, n: ++revealCount, keepHidden: opts?.keepHidden });
}

export interface Accordion {
  page: AccordionPage;
  isOpen: (id: string) => boolean;
  isPinned: (id: string) => boolean;
  toggle: (id: string) => void;
  pin: (id: string) => void;
  reveal: (id: string, row?: string) => void;
  // The panel menu: fold everything for now (pins kept), and clear this scope's pins.
  anyOpen: boolean;
  hasPins: boolean;
  collapseAll: () => void;
  clearPins: () => void;
  // The last deep link this page took, to scroll to and flash (Section.tsx).
  revealed: Reveal | null;
}

// The pending link, if it's for this page.
const linkFor = (page: AccordionPage): Reveal | null => {
  const link = pending.get();
  return link && link.page === page ? link : null;
};

export function useAccordion<P extends AccordionPage>(page: P, scope: string, firstTask: SectionId<P> | null = null): Accordion {
  const [open, setOpen] = useState<string | null>(() => {
    const stored = readPref(OPEN_KEY(page));
    if (stored === null) return firstTask; // first visit
    return stored === NONE ? null : stored;
  });
  const [pins, setPins] = useState<string[]>(() => readPins(scope));
  // Pinned sections folded by Collapse all, for this visit (not remembered: they open again next time).
  const [foldedPins, setFoldedPins] = useState<string[]>([]);
  // Another board or slot on the controller page: its own pins.
  const [shownScope, setShownScope] = useState(scope);
  if (shownScope !== scope) {
    setShownScope(scope);
    setPins(readPins(scope));
    setFoldedPins([]);
  }

  // Deep links: one made before this page mounted, then each new one.
  const [link, setLink] = useState<Reveal | null>(() => linkFor(page));
  // lifetime: OK — the effect returns the store's unsubscribe (unmount / page change)
  useEffect(() => {
    if (link && pending.get() === link) pending.set(null); // taken at mount
    // lifetime: OK — unsubscribed by the effect's cleanup
    return pending.subscribe(() => {
      const next = linkFor(page);
      if (!next) return;
      pending.set(null);
      setLink(next);
    });
  }, [page, link]);
  // A new link opens its section (set while rendering: React's pattern for state that follows other state).
  const [revealed, setRevealed] = useState<Reveal | null>(null);
  if (link && link !== revealed) {
    setRevealed(link);
    if (!pins.includes(link.id)) setOpen(link.id);
    // loop: NOT-WORTH — N ≤ a page's sections; once per deep link
    else if (foldedPins.includes(link.id)) setFoldedPins(foldedPins.filter((p) => p !== link.id));
  }

  // The open section is remembered (after the first visit: only once something changed it).
  const [firstOpen] = useState(open);
  // lifetime: OK — acquires nothing (writes the remembered open section)
  useEffect(() => {
    const value = open ?? NONE;
    const stored = readPref(OPEN_KEY(page));
    if (stored === value || (stored === null && open === firstOpen)) return;
    writePref(OPEN_KEY(page), value);
  }, [open, page, firstOpen]);

  const savePins = (next: string[]) => {
    setPins(next);
    writePref(PINS_KEY(scope), JSON.stringify(next));
  };
  const isPinned = (id: string) => pins.includes(id);
  const isFolded = (id: string) => foldedPins.includes(id);
  // loop: HOT-PATH-OK — N ≤ a page's sections (≤ 12); per render
  const anyOpen = open !== null || pins.some((p) => !isFolded(p));
  return {
    page,
    isPinned,
    isOpen: (id) => open === id || (isPinned(id) && !isFolded(id)),
    anyOpen,
    hasPins: pins.length > 0,
    collapseAll: () => {
      setOpen(null);
      setFoldedPins(pins);
    },
    clearPins: () => {
      savePins([]);
      setFoldedPins([]);
    },
    toggle: (id) => {
      // A pinned section folded by Collapse all: its header opens it again (still pinned).
      // loop: NOT-WORTH — N ≤ a page's sections; on a click
      if (isPinned(id) && isFolded(id)) setFoldedPins(foldedPins.filter((p) => p !== id));
      else if (isPinned(id)) {
        // A pinned section's header folds it: the pin goes too (else the header would do nothing).
        // loop: NOT-WORTH — N ≤ a page's sections; on a click
        savePins(pins.filter((p) => p !== id));
        if (open === id) setOpen(null);
      } else setOpen(open === id ? null : id);
    },
    pin: (id) => {
      if (isPinned(id)) {
        // Unpinned, it stays open as the page's one open section (another open one folds).
        // loop: NOT-WORTH — N ≤ a page's sections; on a click
        savePins(pins.filter((p) => p !== id));
        setOpen(id);
        // loop: NOT-WORTH — N ≤ a page's sections; on a click
        if (isFolded(id)) setFoldedPins(foldedPins.filter((p) => p !== id));
      } else {
        savePins([...pins, id]);
        if (open === id) setOpen(null);
      }
    },
    reveal: (id, row) => setLink({ page, id, row, n: ++revealCount }),
    revealed,
  };
}
