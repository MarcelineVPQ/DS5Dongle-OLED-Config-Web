// Header dropdown to override the auto-detected i18next language.
// Persists to localStorage via i18next-browser-languagedetector's caches.

import { Check, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

export default function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Resolve the current language to one of our supported codes (or fallback to en).
  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ??
    SUPPORTED_LANGUAGES.find((l) => i18n.language?.startsWith(l.code)) ??
    SUPPORTED_LANGUAGES[0];

  // Click-outside-to-close
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="language-toggle" ref={ref}>
      <button
        type="button"
        className="language-toggle-button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("languageToggle.currentTitle", { name: current.label })}
      >
        <Globe size={15} />
        <span className="language-toggle-current">{current.shortLabel}</span>
      </button>
      {open && (
        <ul
          className="language-toggle-menu"
          role="listbox"
          aria-label={t("languageToggle.groupLabel")}
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = lang.code === current.code;
            return (
              <li key={lang.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={active ? "active" : ""}
                  onClick={() => {
                    void i18n.changeLanguage(lang.code);
                    setOpen(false);
                  }}
                  title={t("languageToggle.switchTo", { name: lang.label })}
                >
                  <span className="language-toggle-label">{lang.label}</span>
                  <span className="language-toggle-short">{lang.shortLabel}</span>
                  {active && <Check size={14} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
