// 3-way light / dark / system theme toggle for the header.
// Persists the user's choice in localStorage; falls back to "system"
// (which means: follow prefers-color-scheme).

import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ds5-bridge-theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTo = useCallback((next: Theme) => () => setTheme(next), []);

  return (
    <div className="theme-toggle" role="group" aria-label={t("themeToggle.groupLabel")}>
      <button
        type="button"
        className={theme === "light" ? "active" : ""}
        onClick={setTo("light")}
        aria-pressed={theme === "light"}
        title={t("themeToggle.light")}
      >
        <Sun size={15} />
      </button>
      <button
        type="button"
        className={theme === "system" ? "active" : ""}
        onClick={setTo("system")}
        aria-pressed={theme === "system"}
        title={t("themeToggle.system")}
      >
        <Monitor size={15} />
      </button>
      <button
        type="button"
        className={theme === "dark" ? "active" : ""}
        onClick={setTo("dark")}
        aria-pressed={theme === "dark"}
        title={t("themeToggle.dark")}
      >
        <Moon size={15} />
      </button>
    </div>
  );
}
