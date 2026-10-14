// Our own color picker, in place of <input type="color">: the native popup's
// eyedropper does nothing in Electron and the popup ignores the theme. A
// swatch button opens a popover (saturation/brightness square, hue slider,
// hex and R/G/B fields, recent colors); every part works from the keyboard
// (arrow keys on the square and the slider, Shift for big steps, Escape
// closes and focus goes back to the swatch) and has a screen-reader name.
// Same contract as the native input: `value` "#rrggbb" in, onChange("#rrggbb")
// out while the color changes. Everything is drawn from the theme tokens,
// except the color space itself (desktop.css, .cp-*).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { readPref, writePref, PREF_EVENT } from "../storage";
import { addRecent, clamp, hsvFromHex, hsvToHex, normalizeHex, parseChannel, parseHex, parseRecent, rgbToHex, type Hsv } from "./colorMath";

// The recent colors, shared by every picker (newest first).
export const RECENT_KEY = "ds5.recentColors";

function useRecentColors(): [string[], (hex: string) => void] {
  const [list, setList] = useState(() => parseRecent(readPref(RECENT_KEY)));
  // lifetime: OK — cleanup removes the PREF_EVENT listener (unmount)
  useEffect(() => {
    const on = (e: Event) => {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (key === RECENT_KEY) setList(parseRecent(value));
    };
    // lifetime: OK — removed in the effect cleanup (unmount)
    window.addEventListener(PREF_EVENT, on);
    return () => window.removeEventListener(PREF_EVENT, on);
  }, []);
  const add = useCallback((hex: string) => writePref(RECENT_KEY, addRecent(parseRecent(readPref(RECENT_KEY)), hex).join(",")), []);
  return [list, add];
}

interface Props {
  value: string;
  onChange: (hex: string) => void;
  // The color's name (FAV0, Shell...), for the swatch and the popover.
  label: string;
  title?: string;
  className?: string;
  disabled?: boolean;
}

export default function ColorPicker({ value, onChange, label, title, className, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const shown = normalizeHex(value) ?? "#000000"; // theme-exempt: a value fallback (no color given), not a UI color
  const { t } = useTranslation();
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`cp-swatch${className ? ` ${className}` : ""}`}
        aria-label={t("desktop.colorPicker.swatch", { name: label, hex: shown.toUpperCase() })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cp-swatch-color" style={{ background: shown }} />
      </button>
      {open && (
        <ColorPopover
          anchor={button}
          value={shown}
          label={label}
          onChange={onChange}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      )}
    </>
  );
}

const STEP = 1; // per arrow key: 1% (square), 1 degree (hue)
const BIG = 10; // with Shift / Page Up / Page Down

function ColorPopover({
  anchor,
  value,
  label,
  onChange,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  value: string;
  label: string;
  onChange: (hex: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const { t } = useTranslation();
  const pop = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLDivElement>(null);
  const hueBar = useRef<HTMLDivElement>(null);
  const id = useId();
  const [recent, addRecentColor] = useRecentColors();
  const [hsv, setHsv] = useState<Hsv>(() => hsvFromHex(value));
  const [hexText, setHexText] = useState(value);
  const [channels, setChannels] = useState(() => (parseHex(value) ?? [0, 0, 0]).map(String));
  // The newest HSV for event handlers (a drag's move can come before React
  // has rendered the previous one).
  const hsvNow = useRef(hsv);
  // lifetime: OK — acquires nothing (mirrors state into a ref)
  useEffect(() => {
    hsvNow.current = hsv;
  }, [hsv]);
  const opened = useRef(value);
  // cache: OK — key=none (last applied hex); invalidated=each pick; bound=1 entry
  const last = useRef(value);
  // Changes coming back in (the parent's value) without losing the hue of a grey.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setHsv((h) => hsvFromHex(value, h));
    setHexText(value);
    // loop: HOT-PATH-OK — N = 3 channels; only when the value changes from outside
    setChannels((parseHex(value) ?? [0, 0, 0]).map(String));
  }

  const emit = (hex: string) => {
    if (hex === last.current) return;
    last.current = hex;
    onChange(hex);
  };
  const setFromHsv = (next: Hsv) => {
    const n = { h: clamp(next.h, 0, 360), s: clamp(next.s, 0, 1), v: clamp(next.v, 0, 1) };
    hsvNow.current = n;
    setHsv(n);
    const hex = hsvToHex(n);
    setHexText(hex);
    setChannels((parseHex(hex) ?? [0, 0, 0]).map(String));
    emit(hex);
  };
  const setFromHex = (hex: string) => {
    hsvNow.current = hsvFromHex(hex, hsvNow.current);
    setHsv(hsvNow.current);
    setHexText(hex);
    setChannels((parseHex(hex) ?? [0, 0, 0]).map(String));
    emit(hex);
  };

  // A popover in the top layer (over everything, escaping scrolling panels),
  // placed under the swatch, or above it when there's no room.
  // lifetime: OK — cleanup removes the resize/scroll listeners; the early return acquires nothing
  useLayoutEffect(() => {
    const el = pop.current;
    const a = anchor.current;
    if (!el || !a) return;
    // (React 18 doesn't know the popover attribute yet.)
    el.setAttribute("popover", "manual");
    el.showPopover?.();
    const place = () => {
      const r = a.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
      const left = clamp(r.left, 8, Math.max(8, window.innerWidth - w - 8));
      el.style.top = `${Math.round(top)}px`;
      el.style.left = `${Math.round(left)}px`;
    };
    place();
    square.current?.focus();
    // lifetime: OK — removed in the layout effect cleanup (popover closes)
    window.addEventListener("resize", place);
    // lifetime: OK — removed in the layout effect cleanup (popover closes)
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // However it closes, a changed color joins the recent ones.
  // lifetime: OK — acquires nothing; the cleanup adds a changed color to the recent ones
  useEffect(
    () => () => {
      if (last.current !== opened.current) addRecentColor(last.current);
    },
    [addRecentColor],
  );
  const close = onClose;
  // A click outside closes it (the swatch's own click toggles it).
  // lifetime: OK — cleanup removes the outside-click listener (popover closes)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !anchor.current?.contains(target)) close(false);
    };
    // lifetime: OK — removed in the effect cleanup (popover closes)
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor, close]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };
  // Tabbing out of the popover closes it.
  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && !pop.current?.contains(next) && !anchor.current?.contains(next)) close(false);
  };

  // Dragging on the square or the hue bar.
  const drag = (e: ReactPointerEvent<HTMLDivElement>, apply: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      apply(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    // lifetime: OK — removed in up() on pointerup/pointercancel; dies with the element
    el.addEventListener("pointermove", move);
    // lifetime: OK — removed in up() on pointerup/pointercancel; dies with the element
    el.addEventListener("pointerup", up);
    // lifetime: OK — removed in up() on pointerup/pointercancel; dies with the element
    el.addEventListener("pointercancel", up);
  };

  const squareKeys = (e: KeyboardEvent) => {
    const step = (e.shiftKey ? BIG : STEP) / 100;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step], PageUp: [0, BIG / 100], PageDown: [0, -BIG / 100] };
    const m = moves[e.key];
    if (e.key === "Home") setFromHsv({ ...hsvNow.current, s: 0 });
    else if (e.key === "End") setFromHsv({ ...hsvNow.current, s: 1 });
    else if (m) setFromHsv({ ...hsvNow.current, s: hsvNow.current.s + m[0], v: hsvNow.current.v + m[1] });
    else return;
    e.preventDefault();
  };
  const hueKeys = (e: KeyboardEvent) => {
    const step = e.shiftKey ? BIG : STEP;
    const moves: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageUp: BIG, PageDown: -BIG };
    if (e.key === "Home") setFromHsv({ ...hsvNow.current, h: 0 });
    else if (e.key === "End") setFromHsv({ ...hsvNow.current, h: 360 });
    else if (moves[e.key] !== undefined) setFromHsv({ ...hsvNow.current, h: hsvNow.current.h + moves[e.key] });
    else return;
    e.preventDefault();
  };

  const commitHex = () => {
    const hex = normalizeHex(hexText);
    if (hex) setFromHex(hex);
    else setHexText(last.current);
  };
  const setChannel = (i: number, text: string) => {
    const next = [...channels];
    next[i] = text;
    setChannels(next);
    const nums = next.map(parseChannel);
    if (nums.every((n) => n !== null)) {
      const hex = rgbToHex(nums as number[]);
      hsvNow.current = hsvFromHex(hex, hsvNow.current);
      setHsv(hsvNow.current);
      setHexText(hex);
      emit(hex);
    }
  };
  const hexValid = normalizeHex(hexText) !== null;
  const pct = (x: number) => Math.round(x * 100);
  const hue = Math.round(hsv.h) % 360;
  // loop: HOT-PATH-OK — N = 3 channel names
  const channelNames = (["R", "G", "B"] as const).map((c) => t(`desktop.colorPicker.channel${c}`));

  return (
    <div ref={pop} className="cp-pop" role="dialog" aria-label={t("desktop.colorPicker.dialog", { name: label })} onKeyDown={onKeyDown} onBlur={onBlur}>
      <div
        ref={square}
        className="cp-square"
        style={{ "--cp-hue": hue } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label={t("desktop.colorPicker.square")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct(hsv.s)}
        aria-valuetext={t("desktop.colorPicker.squareValue", { s: pct(hsv.s), v: pct(hsv.v) })}
        onKeyDown={squareKeys}
        onPointerDown={(e) => drag(e, (x, y) => setFromHsv({ ...hsvNow.current, s: x, v: 1 - y }))}
      >
        <span className="cp-square-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div
        ref={hueBar}
        className="cp-hue"
        role="slider"
        tabIndex={0}
        aria-label={t("desktop.colorPicker.hue")}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={hue}
        aria-valuetext={t("desktop.colorPicker.hueValue", { h: hue })}
        onKeyDown={hueKeys}
        onPointerDown={(e) => drag(e, (x) => setFromHsv({ ...hsvNow.current, h: x * 360 }))}
      >
        <span className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="cp-fields">
        <label className="cp-field cp-hex">
          <span>{t("desktop.colorPicker.hex")}</span>
          <input
            type="text"
            value={hexText}
            spellCheck={false}
            maxLength={7}
            aria-invalid={!hexValid}
            onChange={(e) => {
              setHexText(e.currentTarget.value);
              const hex = normalizeHex(e.currentTarget.value);
              if (hex && e.currentTarget.value.replace("#", "").length === 6) setFromHex(hex);
            }}
            onBlur={commitHex}
            onKeyDown={(e) => e.key === "Enter" && commitHex()}
          />
        </label>
        {/* loop: HOT-PATH-OK — N = 3 channel fields */}
        {channelNames.map((name, i) => (
          <label key={name} className="cp-field" title={name}>
            <span aria-hidden="true">{name.slice(0, 1)}</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={channels[i]}
              aria-label={name}
              aria-invalid={parseChannel(channels[i]) === null}
              onChange={(e) => setChannel(i, e.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="cp-recent" role="group" aria-labelledby={`${id}-recent`}>
          <span id={`${id}-recent`} className="cp-recent-label">
            {t("desktop.colorPicker.recent")}
          </span>
          <div className="cp-recent-row">
            {/* loop: HOT-PATH-OK — N ≤ 8 recent colors (RECENT_MAX) */}
            {recent.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`cp-recent-color${hex === normalizeHex(hexText) ? " on" : ""}`}
                aria-label={t("desktop.colorPicker.recentColor", { hex: hex.toUpperCase() })}
                title={hex.toUpperCase()}
                onClick={() => setFromHex(hex)}
              >
                <span className="cp-swatch-color" style={{ background: hex }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
