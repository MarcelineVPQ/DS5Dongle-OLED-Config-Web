// Readouts and info in a page's main view. The operating rule: the accordion
// (Section) holds settings and actions only; what a page shows about the
// board, the controller or the game (diagnostics, controller info, a game's
// details) lives in the main view, in a MainBlock (tools/list_settings.mjs
// gates both sides).
//
// A MainBlock is a disclosure like a Section, closed by default and
// remembered per block: its header (a button, aria-expanded) shows an icon,
// the title, a live status and, for an open task, the yellow dot with the
// task as the status. Its body is a function, called only while it's open,
// so a closed block renders, reads and polls nothing (the Pico's extra
// diagnostics reads run only while its block is open: useMainBlock's `open`).
//
// Deep links: revealBlock(page, id) from anywhere (the rail's board-problem
// dot, the tray's Diagnostics, "More in Diagnostics") opens the block on its
// page, scrolls it into view, focuses its header and flashes it once. A page
// that isn't shown yet picks the link up when it mounts.
//
// Idle cost: none. No timers or polling of its own; a deep link plays one
// flash (a CSS animation that ends), off with reduce motion.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { externalStore } from "../externalStore";
import { useFlagPref } from "../storage";
import type { BlockId, BlockPage } from "./sections";
import { HeadContent, showLinked } from "./Section";

export const BLOCK_OPEN_KEY = (page: BlockPage, id: string) => `ds5.block.open.${page}.${id}`;

interface BlockLink {
  page: BlockPage;
  id: string;
  n: number; // a new link to the same block reveals it again
}

// The pending deep link (one at a time: the newest wins).
// cache: OK — key=none (the one pending link); invalidated=the block it targets takes it (set to null); bound=1 link
const pending = externalStore<BlockLink | null>(null);
let linkCount = 0;

export function revealBlock<P extends BlockPage>(page: P, id: BlockId<P>): void {
  pending.set({ page, id, n: ++linkCount });
}

const blockLinkFor = (page: BlockPage, id: string): BlockLink | null => {
  const link = pending.get();
  return link && link.page === page && link.id === id ? link : null;
};

export interface MainBlockState {
  id: string;
  open: boolean;
  toggle: () => void;
  // The last deep link this block took, to scroll to and flash.
  revealed: BlockLink | null;
}

// A block's state, kept by its page (the page needs `open` to gate its reads).
export function useMainBlock<P extends BlockPage>(page: P, id: BlockId<P>): MainBlockState {
  const [open, setOpen] = useFlagPref(BLOCK_OPEN_KEY(page, id));
  const [revealed, setRevealed] = useState<BlockLink | null>(null);
  // Deep links: one made before this page mounted, then each new one.
  // lifetime: OK — the effect returns the store's unsubscribe (unmount / page change)
  useEffect(() => {
    const take = (link: BlockLink) => {
      pending.set(null);
      setOpen(true);
      setRevealed(link);
    };
    const now = blockLinkFor(page, id);
    if (now) take(now);
    // lifetime: OK — unsubscribed by the effect's cleanup
    return pending.subscribe(() => {
      const next = blockLinkFor(page, id);
      if (next) take(next);
    });
  }, [page, id, setOpen]);
  return { id, open, toggle: () => setOpen(!open), revealed };
}

// The header's icon, title, status and task (the yellow dot, said as the status): as a Section's.
type Props = Parameters<typeof HeadContent>[0] & {
  state: MainBlockState;
  children: () => ReactNode; // called only while open
};

export function MainBlock({ state, icon, title, status, task, children }: Props) {
  const uid = useId();
  const ref = useRef<HTMLElement>(null);
  const { open, revealed } = state;
  // A deep link: the block's top scrolled into view (again once its body has grown), its header focused, one flash.
  // lifetime: OK — returns showLinked's cleanup (its transitionend listener), on unmount or the next link
  useEffect(() => {
    const block = ref.current;
    if (revealed && block) return showLinked(block, block, block.querySelector<HTMLElement>(".dk-block-body"), block.querySelector<HTMLElement>(".dk-block-toggle"), "start");
  }, [revealed]);
  return (
    <section ref={ref} className={`dk-block${open ? " open" : ""}`} data-block={state.id}>
      <button type="button" className="dk-block-toggle" id={`${uid}-h`} aria-expanded={open} aria-controls={open ? `${uid}-b` : undefined} onClick={state.toggle}>
        <HeadContent icon={icon} title={title} status={status} task={task} />
      </button>
      {open && (
        <div className="dk-block-body" role="region" id={`${uid}-b`} aria-labelledby={`${uid}-h`}>
          {children()}
        </div>
      )}
    </section>
  );
}
