// Readouts and info in a page's main view. The operating rule: the accordion
// (Section) holds settings and actions only; what a page shows about the
// board, the controller or the game (diagnostics, controller info, a game's
// details) lives in the main view, in a MainBlock (tools/list_settings.mjs
// gates both sides).
//
// A MainBlock is always shown: no fold, no header button, nothing
// remembered. It looks like the page's other main-view cards (the Pico 2 W
// page's dials, the Controller page's data cards, a game's stat cards): a
// card with a small heading (an icon, the title, a live status and, for an
// open task, the yellow dot with the task as the status) and its readouts.
// What a readout reads from the board is up to its page (the Pico 2 W page:
// live, once a second while shown; DongleDashboard.tsx).
//
// Deep links: revealBlock(page, id) from anywhere (the rail's board-problem
// dot, the tray's Diagnostics, "More in Diagnostics") scrolls the block into
// view on its page, focuses its heading and flashes it once. A page that
// isn't shown yet picks the link up when it mounts.
//
// Idle cost: none. No timers or polling of its own; a deep link plays one
// flash (a CSS animation that ends), off with reduce motion.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { externalStore } from "../externalStore";
import type { BlockId, BlockPage } from "./sections";
import { HeadContent, showLinked } from "./Section";

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
  // The last deep link this block took, to scroll to and flash.
  revealed: BlockLink | null;
}

// A block's deep-link state, kept by its page.
export function useMainBlock<P extends BlockPage>(page: P, id: BlockId<P>): MainBlockState {
  const [revealed, setRevealed] = useState<BlockLink | null>(null);
  // Deep links: one made before this page mounted, then each new one.
  // lifetime: OK — the effect returns the store's unsubscribe (unmount / page change)
  useEffect(() => {
    const take = (link: BlockLink) => {
      pending.set(null);
      setRevealed(link);
    };
    const now = blockLinkFor(page, id);
    if (now) take(now);
    // lifetime: OK — unsubscribed by the effect's cleanup
    return pending.subscribe(() => {
      const next = blockLinkFor(page, id);
      if (next) take(next);
    });
  }, [page, id]);
  return { id, revealed };
}

// The heading's icon, title, status and task (the yellow dot, said as the
// status): as a Section's, without the chevron. `actions`: the readout's own
// controls or read error at the heading's end.
type Props = Omit<Parameters<typeof HeadContent>[0], "chevron"> & {
  state: MainBlockState;
  actions?: ReactNode;
  children: ReactNode;
};

export function MainBlock({ state, icon, title, status, task, actions, children }: Props) {
  const uid = useId();
  const ref = useRef<HTMLElement>(null);
  const { revealed } = state;
  // A deep link: the block's top scrolled into view, its heading focused, one flash.
  // lifetime: OK — returns showLinked's cleanup, on unmount or the next link
  useEffect(() => {
    const block = ref.current;
    if (revealed && block) return showLinked(block, block, null, block.querySelector<HTMLElement>(".dk-block-head"), "start");
  }, [revealed]);
  return (
    <section ref={ref} className="dk-block" data-block={state.id} aria-labelledby={`${uid}-h`}>
      <div className="dk-block-top">
        <h3 className="dk-block-head" id={`${uid}-h`} tabIndex={-1}>
          <HeadContent icon={icon} title={title} status={status} task={task} chevron={false} />
        </h3>
        {actions && <div className="dk-block-actions">{actions}</div>}
      </div>
      <div className="dk-block-body">{children}</div>
    </section>
  );
}
