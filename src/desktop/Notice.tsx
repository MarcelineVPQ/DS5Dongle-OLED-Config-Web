// The app's one notice banner: its text, then (pushed right) an optional
// action, and a small × in the corner that dismisses it (tooltip and label
// "Dismiss", reachable with Tab). How it closes says what kind it is
// (notices.ts):
//   dismissKey — a task (an update, a board problem): hidden until its reason
//                changes, across restarts; the rail's dot stays until it's done.
//   onDismiss  — an error from an action, or news the caller keeps: the caller
//                clears it, so the next failure shows again.
//   closable   — info: closes until it's shown anew.
// None of them: no × (a firmware write in progress, which ends by itself).
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useNoticeDismissed } from "./notices";

interface Props {
  children: ReactNode;
  error?: boolean; // error colors (error: NOT-WORTH — the notice's style, not a failure result)
  pinned?: boolean; // stays at the top of a scrolled page
  role?: "status" | "alert" | "dialog";
  label?: string; // aria-label (a dialog's title)
  action?: ReactNode;
  dismissKey?: string;
  onDismiss?: () => void;
  closable?: boolean;
  className?: string; // where it sits (margins), never its colors
}

export default function Notice({ children, error, pinned, role, label, action, dismissKey, onDismiss, closable, className }: Props) {
  const { t } = useTranslation();
  const [dismissed, dismiss] = useNoticeDismissed(dismissKey);
  const [closed, setClosed] = useState(false);
  if (dismissed || closed) return null;
  const close = dismissKey ? dismiss : onDismiss ? onDismiss : closable ? () => setClosed(true) : null;
  const dismissLabel = t("notice.dismiss");
  return (
    <div className={`dk-notice${error ? " error" : ""}${pinned ? " pinned" : ""}${close ? " has-x" : ""}${className ? ` ${className}` : ""}`} role={role} aria-label={label}>
      {children}
      {action && <span className="dk-spacer" />}
      {action}
      {close && (
        <button type="button" className="dk-notice-x" onClick={close} title={dismissLabel} aria-label={dismissLabel}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
