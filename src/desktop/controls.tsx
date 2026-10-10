// Compact controls for the desktop layout. Each renders one .dk-row.
import { type ReactNode, useState } from "react";

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
  onChange: (value: number) => void;
}

// The range thumb updates a local value while dragging and only reports on
// release, so a drag sends one write to the dongle, not dozens.
export function Slider({ label, sub, value, min, max, step, unit, digits = 0, invalid, disabled, onChange }: SliderProps) {
  // While the user is dragging or typing, show their value; otherwise show the
  // dongle's. null = not editing.
  const [editing, setEditing] = useState<number | null>(null);
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
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={local.toFixed(digits)}
        disabled={disabled}
        aria-label={`${label} value`}
        onChange={(e) => setLocal(Number(e.currentTarget.value))}
        onBlur={(e) => commit(Number(e.currentTarget.value))}
        onKeyDown={(e) => e.key === "Enter" && commit(Number(e.currentTarget.value))}
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

interface SelectProps {
  label: string;
  sub?: string;
  value: number;
  options: ReadonlyArray<{ value: number; label: string }>;
  onChange: (value: number) => void;
}

export function Select({ label, sub, value, options, onChange }: SelectProps) {
  return (
    <Row label={label} sub={sub}>
      <select value={value} aria-label={label} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
