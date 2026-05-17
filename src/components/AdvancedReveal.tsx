// Progressive-disclosure wrapper. Wraps "advanced" settings (polling rate,
// controller mode, inactive timeout, LED toggles) behind a "Show advanced"
// disclosure that defaults closed.
//
// Open state is persisted to localStorage so power users who opened it once
// keep it expanded on return visits.

import { ChevronDown } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

const STORAGE_KEY = "ds5-bridge-advanced-open";

export interface AdvancedRevealProps {
  title?: string;
  hint?: string;
  children: ReactNode;
}

export default function AdvancedReveal({
  title = "Advanced settings",
  hint = "Polling rate, controller mode, LED behavior, inactive disconnect — most users never change these.",
  children,
}: AdvancedRevealProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  }, [open]);

  return (
    <details className="advanced-reveal" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="advanced-reveal-summary">
        <ChevronDown size={16} className="advanced-reveal-chevron" />
        <span className="advanced-reveal-title">{title}</span>
        <span className="advanced-reveal-hint">{hint}</span>
      </summary>
      <div className="advanced-reveal-body">{children}</div>
    </details>
  );
}
