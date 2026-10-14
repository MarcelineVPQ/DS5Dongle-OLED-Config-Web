// Compact controls for the desktop layout. Each renders one .dk-row: Row is
// the settings framework's row (one label, an optional hint, one control),
// and every setting sits in one inside a Section (accordion/Section.tsx).
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { causeText, shown } from "./shownError";
import { logged } from "../errorText";
import { useTopLayer } from "./topLayer";

interface RowProps {
  label: string;
  // What you must know before acting, on screen under the label (a unit or
  // range, a warning, ≤ ~60 characters: the hint gate, tools/list_hints.mjs).
  sub?: string;
  // The longer explanation, behind the ⓘ beside the label (InfoTip).
  info?: string;
  invalid?: boolean;
  // A small control (a switch): the label and its description get the width.
  wide?: boolean;
  // A wide control (long segmented choices): always under the label.
  stack?: boolean;
  // A deep link to this row (revealSection's row): scrolled to and flashed.
  id?: string;
  children: ReactNode;
}

// What the label column keeps beside an inline control, at least.
const LABEL_MIN_PX = 130;
// Every inline <select> is this wide, so the rows' choices line up; one that
// needs more (a long option) puts its row in the stacked layout.
export const SELECT_PX = 180;

// Whether a row's control fits beside its label in the row's width, measured
// (it depends on the label, the language and the panel's width): if not, the
// row stacks (label and hint on top, the control under them at full width).
// Measured once and again only when the row's width changes (a
// ResizeObserver; nothing runs while idle).
function useStacked(fixed: boolean) {
  const row = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  // lifetime: OK — cleanup: disconnects the ResizeObserver (unmount)
  useLayoutEffect(() => {
    const el = row.current;
    const ctl = el?.querySelector<HTMLElement>(":scope > .dk-ctl");
    if (fixed || !el || !ctl) return;
    const check = () => {
      if (!el.clientWidth) return; // not laid out (a hidden page): measured when it is
      // The control's natural width, as if inline (the measuring class lifts the stacked layout's widths).
      el.classList.add("dk-measure");
      const need = ctl.getBoundingClientRect().width;
      const select = ctl.querySelector<HTMLElement>(":scope > select");
      const tooWideSelect = !!select && select.getBoundingClientRect().width > SELECT_PX;
      el.classList.remove("dk-measure");
      setStacked(tooWideSelect || need > el.clientWidth - LABEL_MIN_PX - 12);
    };
    check();
    if (typeof ResizeObserver === "undefined") return; // a test DOM without it: measured once
    // lifetime: OK — disconnected in the layout effect cleanup
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed]);
  return { row, stacked };
}

export function Row({ label, sub, info, invalid, wide, stack, id, children }: RowProps) {
  const { row, stacked } = useStacked(!!wide || !!stack);
  return (
    <div ref={row} className={`dk-row${invalid ? " invalid" : ""}${wide ? " wide" : ""}${stack || stacked ? " stack" : ""}${sub ? " has-sub" : ""}`} data-row={id}>
      <span className="dk-label">
        {label}
        {info && <InfoTip text={info} />}
        {sub && <span className="dk-sub">{sub}</span>}
      </span>
      <div className="dk-ctl">{children}</div>
    </div>
  );
}

// The ⓘ: a small info icon beside a label, with the longer explanation as a
// tooltip. Shown on hover, and on keyboard focus (Tab); Esc or leaving closes
// it; a click toggles it (touch). Screen readers get the text as the icon's
// description (aria-describedby: the text is always in the page, hidden).
// The bubble is in the top layer (useTopLayer: over everything, never cut by
// a section, the drawer or a card), near the icon and kept on screen. Idle
// cost: none; it closes on scroll (the window's scroll listener lives only
// while it's open).
export function InfoTip({ text }: { text: string }) {
  const { t } = useTranslation();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  useTopLayer(tip, open, { anchor: btn, dx: -10 });
  // lifetime: OK — the effect returns the scroll/resize listeners' removal (closed / unmount)
  useEffect(() => {
    if (!open) return;
    // lifetime: OK — removed in the cleanup (closed / unmount)
    window.addEventListener("scroll", hide, true);
    // lifetime: OK — removed in the cleanup (closed / unmount)
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dk-info${open ? " open" : ""}`}
        aria-label={t("desktop.common.moreInfo")}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault(); // inside a <label> or <summary>: not its own click
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation(); // closes the tooltip, not the drawer or dialog around it
            hide();
          }
        }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" hidden>
        {text}
      </span>
      {open && (
        <span ref={tip} className="dk-info-tip top-layer" aria-hidden="true">
          {text}
        </span>
      )}
    </>
  );
}

interface SliderProps {
  label: string;
  sub?: string;
  info?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  invalid?: boolean;
  disabled?: boolean;
  // Show an explicit + on positive values (gains around 0).
  signed?: boolean;
  onChange: (value: number) => void;
}

// The range thumb updates a local value while dragging and only reports on
// release, so a drag sends one write to the dongle, not dozens.
export function Slider({ label, sub, info, value, min, max, step, unit, digits = 0, invalid, disabled, signed, onChange }: SliderProps) {
  // While the user is dragging or typing, show their value; otherwise show the
  // dongle's. null = not editing.
  const [editing, setEditing] = useState<number | null>(null);
  // The number box keeps the text as typed ("-", "3.", "") until Enter or
  // leaving the box, so ordinary typing works.
  const [text, setText] = useState<string | null>(null);
  const local = editing ?? value;
  const setLocal = (next: number) => setEditing(next);
  const commit = (next: number) => {
    setEditing(null);
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(max, Math.max(min, next));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <Row label={label} sub={sub} info={info} invalid={invalid}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setLocal(Number(e.currentTarget.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
      />
      {signed && <span className="dk-sign">{local > 0 ? "+" : ""}</span>}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text ?? local.toFixed(digits)}
        disabled={disabled}
        aria-label={`${label} value`}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={(e) => {
          setText(null);
          if (e.currentTarget.value.trim() !== "") commit(Number(e.currentTarget.value));
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.currentTarget.value.trim() === "") return;
          setText(null);
          commit(Number(e.currentTarget.value));
        }}
      />
      {unit !== undefined && <span className="dk-unit">{unit}</span>}
    </Row>
  );
}

// False once the component has unmounted, so an action that finishes late
// doesn't set its state (BusyButton, Toggle).
function useLive() {
  const live = useRef(true);
  // lifetime: OK — cleanup: marks the component unmounted (holds no resource)
  useEffect(() => {
    live.current = true; // (again: StrictMode mounts twice in development)
    return () => {
      live.current = false;
    };
  }, []);
  return live;
}

interface ToggleProps {
  label: string;
  sub?: string;
  info?: string;
  value: boolean;
  disabled?: boolean;
  // A promise (a write that waits on the dongle) makes the switch busy like a
  // BusyButton until it settles: disabled, aria-busy, the spinner beside it.
  onChange: (value: boolean) => Promise<unknown> | void;
}

export function Toggle({ label, sub, info, value, disabled, onChange }: ToggleProps) {
  const [busy, setBusy] = useState(false);
  const live = useLive();
  const flip = () => {
    const pending = onChange(!value);
    if (!(pending instanceof Promise)) return;
    setBusy(true);
    void pending
      // error: SHOWN — desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error)
      .catch((cause: unknown) => shown("desktop.errors.actionFailed", { reason: causeText(cause) })(cause))
      .finally(() => {
        if (live.current) setBusy(false);
      });
  };
  return (
    <Row label={label} sub={sub} info={info} wide>
      {busy && <span className="dk-btn-spinner" aria-hidden="true" />}
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        aria-busy={busy || undefined}
        className={`dk-toggle${value ? " on" : ""}`}
        disabled={disabled || busy}
        onClick={flip}
      />
    </Row>
  );
}

interface SegmentedProps<T extends number> {
  label: string;
  sub?: string;
  info?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}

// The choices go under the label when they don't fit beside it (Row measures).
export function Segmented<T extends number>({ label, sub, info, value, options, disabled, onChange }: SegmentedProps<T>) {
  return (
    <Row label={label} sub={sub} info={info}>
      <div className="dk-seg" role="group" aria-label={label}>
        {/* loop: HOT-PATH-OK — N ≤ 6 segment options */}
        {options.map((o) => (
          <button type="button" key={o.value} title={o.title} className={o.value === value ? "on" : ""} aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

export function rgbToHex([r, g, b]: number[]): string {
  return (
    "#" +
    // loop: HOT-PATH-OK — N = 3 channels
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, c | 0))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// One #rrggbb parser for the app (theme/desktopPalette.ts).
export { hexToRgb } from "./theme/desktopPalette";

// A button for anything that waits on the dongle or the network, with the same
// behavior as AVNetworkMonitor's Loading.action(): while the action runs it is
// disabled and aria-busy with a spinner ring beside its label (the label and
// any icon stay as they are); after a few seconds it also counts the seconds,
// so a slow check doesn't look hung; and it always comes back, on success or
// failure (the restore is in a finally). The action's own result or error is
// shown by the caller. An action with a known length (`countdown`, seconds)
// counts down from the start instead; with `onStop` the running button stays
// pressable, and pressing it again stops the action early. `since` (a
// Date.now() time) shows an action that runs outside the button as running,
// counting from then: a button that mounts while it plays picks it up.
const ELAPSED_AFTER_S = 3;

interface BusyButtonProps {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  countdown?: number;
  onStop?: () => void;
  since?: number | null;
  autoFocus?: boolean;
}

export function BusyButton({ onClick, children, className = "dk-btn", disabled, title, countdown, onStop, since, autoFocus }: BusyButtonProps) {
  const [ownBusy, setBusy] = useState(false);
  const busy = ownBusy || since != null;
  const [secs, setSecs] = useState(0);
  const live = useLive();
  // lifetime: OK — cleanup: clears the 1 s busy counter (done / unmount)
  useEffect(() => {
    if (!busy) return;
    const started = since || Date.now();
    const tick = () => setSecs(Math.floor((Date.now() - started) / 1000));
    tick();
    // lifetime: OK — cleared in the effect cleanup (busy ends / unmount)
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busy, since]);
  const run = async () => {
    if (busy) {
      onStop?.();
      return;
    }
    setSecs(0);
    setBusy(true);
    try {
      await onClick();
    } catch (cause) {
      // error: SHOWN — desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error; callers that do catch it first)
      shown("desktop.errors.actionFailed", { reason: causeText(cause) })(cause);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`${className}${busy ? " dk-btn-busy" : ""}`}
      disabled={disabled || (busy && !onStop)}
      aria-busy={busy || undefined}
      title={title}
      autoFocus={autoFocus}
      onClick={() => void run().catch(logged("BusyButton.run (it shows its own errors)"))}
    >
      {busy && <span className="dk-btn-spinner" aria-hidden="true" />}
      {children}
      {busy && countdown !== undefined && countdown - secs > 0 && <span className="dk-btn-elapsed"> · {countdown - secs}s</span>}
      {busy && countdown === undefined && secs >= ELAPSED_AFTER_S && <span className="dk-btn-elapsed"> · {secs}s</span>}
    </button>
  );
}

// Haptics strength for the two grips: Left and Right, with Link (on while
// they're equal) moving both together. Firmware before protocol 1.6 has one
// strength for both: then a single slider. Used by the Haptics panel and game
// profiles, so both behave the same.
export function GripHaptics({
  left,
  right,
  split,
  sub,
  invalid,
  onChange,
}: {
  left: number;
  right: number;
  split: boolean;
  sub?: string;
  invalid?: boolean;
  onChange: (left: number, right: number) => void;
}) {
  const { t } = useTranslation();
  const [linked, setLinked] = useState(() => Math.abs(left - right) < 0.001);
  if (!split) return <Slider label={t("haptics.gainLabel")} sub={sub} value={left} min={1} max={6} step={0.1} digits={1} unit="×" invalid={invalid} onChange={(v) => onChange(v, v)} />;
  return (
    <>
      <Toggle
        label={t("desktop.grips.link")}
        sub={t("desktop.grips.linkSub")}
        value={linked}
        onChange={(on) => {
          setLinked(on);
          if (on && left !== right) onChange(left, left); // linking evens them out at the left value
        }}
      />
      <Slider label={t("desktop.grips.left")} sub={sub} value={left} min={1} max={6} step={0.1} digits={1} unit="×" invalid={invalid} onChange={(v) => onChange(v, linked ? v : right)} />
      <Slider label={t("desktop.grips.right")} sub={sub} value={right} min={1} max={6} step={0.1} digits={1} unit="×" invalid={invalid} onChange={(v) => onChange(linked ? v : left, v)} />
    </>
  );
}
