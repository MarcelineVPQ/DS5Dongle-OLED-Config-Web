// The toast stack (toast.ts): bottom right of the page, newest at the bottom.
// Screen readers hear each one politely. A toast waits while the pointer or
// the keyboard focus is on the stack and while the window is hidden, so it
// never runs out unseen; nothing animates but a CSS fade in and out.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { dismissToast, TOAST_RESUME_MS, useToasts, type Toast } from "./toast";
import { useWindowShown } from "./useWindowShown";

function ToastItem({ toast, paused }: { toast: Toast; paused: boolean }) {
  const { t } = useTranslation();
  // cache: OK — key=this toast; invalidated=reset when it's shown again (shownAt), counted down while it runs; bound=1 number
  const left = useRef({ ms: toast.durationMs, shownAt: toast.shownAt });
  // lifetime: OK — cleanup: clears the dismiss timer (pause, shown again, unmount)
  useEffect(() => {
    if (left.current.shownAt !== toast.shownAt) left.current = { ms: toast.durationMs, shownAt: toast.shownAt };
    if (paused || toast.leaving) return;
    const started = Date.now();
    // lifetime: OK — cleared in the effect cleanup
    const timer = setTimeout(() => dismissToast(toast.id), left.current.ms);
    return () => {
      clearTimeout(timer);
      left.current.ms = Math.max(TOAST_RESUME_MS, left.current.ms - (Date.now() - started));
    };
  }, [paused, toast.leaving, toast.shownAt, toast.durationMs, toast.id]);
  const close = t("desktop.live.close");
  return (
    <li className={`dk-toast${toast.leaving ? " leaving" : ""}`}>
      <span className="dk-toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="dk-btn"
          onClick={() => {
            toast.action?.run();
            dismissToast(toast.id);
          }}
        >
          {t(toast.action.labelKey)}
        </button>
      )}
      <button type="button" className="dk-btn dk-icon-btn dk-toast-close" onClick={() => dismissToast(toast.id)} title={close} aria-label={close}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

export default function Toasts() {
  const { t } = useTranslation();
  const toasts = useToasts();
  const shown = useWindowShown();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The last toast closed with the pointer or focus on it: the stack is
  // gone, so neither can leave by itself (state adjusted while rendering).
  if (toasts.length === 0 && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }
  const paused = hovered || focused || !shown;
  return (
    <section className="dk-toasts" aria-label={t("desktop.toast.region")}>
      <ul
        aria-live="polite"
        aria-relevant="additions text"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {/* loop: NOT-WORTH — N ≤ TOAST_MAX (3) toasts; per toast change */}
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} paused={paused} />
        ))}
      </ul>
    </section>
  );
}
