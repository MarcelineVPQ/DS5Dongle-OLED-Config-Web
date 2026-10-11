// Compact controls for the desktop layout. Each renders one .dk-row.
import { type ReactNode, useEffect, useRef, useState } from "react";

interface RowProps {
  label: string;
  sub?: string;
  invalid?: boolean;
  children: ReactNode;
}

export function Row({ label, sub, invalid, children }: RowProps) {
  return (
    <div className={`dk-row${invalid ? " invalid" : ""}`}>
      <span className="dk-label">
        {label}
        {sub && <span className="dk-sub">{sub}</span>}
      </span>
      <div className="dk-ctl">{children}</div>
    </div>
  );
}

interface SliderProps {
  label: string;
  sub?: string;
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
export function Slider({ label, sub, value, min, max, step, unit, digits = 0, invalid, disabled, signed, onChange }: SliderProps) {
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
    <Row label={label} sub={sub} invalid={invalid}>
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

interface ToggleProps {
  label: string;
  sub?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function Toggle({ label, sub, value, disabled, onChange }: ToggleProps) {
  return (
    <Row label={label} sub={sub}>
      <button type="button" role="switch" aria-checked={value} aria-label={label} className={`dk-toggle${value ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!value)} />
    </Row>
  );
}

interface SegmentedProps<T extends number> {
  label: string;
  sub?: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function Segmented<T extends number>({ label, sub, value, options, disabled, onChange }: SegmentedProps<T>) {
  return (
    <Row label={label} sub={sub}>
      <div className="dk-seg" role="group" aria-label={label}>
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
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, c | 0))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// A button for anything that waits on the dongle or the network, with the same
// behavior as AVNetworkMonitor's Loading.action(): while the action runs it is
// disabled and aria-busy with a spinner ring beside its label (the label and
// any icon stay as they are); after a few seconds it also counts the seconds,
// so a slow check doesn't look hung; and it always comes back, on success or
// failure (the restore is in a finally). The action's own result or error is
// shown by the caller.
const ELAPSED_AFTER_S = 3;

interface BusyButtonProps {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}

export function BusyButton({ onClick, children, className = "dk-btn", disabled, title }: BusyButtonProps) {
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // (again: StrictMode mounts twice in development)
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const run = async () => {
    if (busy) return;
    setSecs(0);
    setBusy(true);
    try {
      await onClick();
    } catch {
      // the caller reports its own errors; the button just never sticks
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <button type="button" className={`${className}${busy ? " dk-btn-busy" : ""}`} disabled={disabled || busy} aria-busy={busy || undefined} title={title} onClick={() => void run()}>
      {busy && <span className="dk-btn-spinner" aria-hidden="true" />}
      {children}
      {busy && secs >= ELAPSED_AFTER_S && <span className="dk-btn-elapsed"> · {secs}s</span>}
    </button>
  );
}
