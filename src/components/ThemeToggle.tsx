// Light / system / dark theme toggle, plus "match desktop" in the desktop app
// (the desktop's own colors: KDE's color scheme, or the system accent).
// Persists the user's choice in localStorage. With no stored choice the desktop
// app matches the desktop's colors (falling back to "system" when the desktop
// exposes none) and the web tool uses "system" (follow prefers-color-scheme).

import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isDesktop } from "../desktop/api";
import { paletteToCssVars, type DesktopPalette } from "../desktop/theme/desktopPalette";

export type Theme = "light" | "dark" | "system" | "desktop";

const STORAGE_KEY = "ds5-bridge-theme";
const STYLE_ID = "ds5-desktop-palette";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  if (stored === "desktop" && isDesktop()) return stored;
  return isDesktop() ? "desktop" : "system";
}

function clearDesktopPalette(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// The desktop shell sets its own tokens on .dk, so the palette is applied with
// !important on both :root and .dk to win over the built-in themes.
function applyDesktopPalette(palette: DesktopPalette | null): void {
  if (!palette) {
    clearDesktopPalette();
    document.documentElement.setAttribute("data-theme", "system");
    return;
  }
  document.documentElement.setAttribute("data-theme", palette.isDark ? "dark" : "light");
  const body = Object.entries(paletteToCssVars(palette))
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join(" ");
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `:root, .dk { ${body} }`;
}

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const desktop = window.desktop;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
    if (theme !== "desktop" || !desktop) {
      clearDesktopPalette();
      document.documentElement.setAttribute("data-theme", theme === "desktop" ? "system" : theme);
      return;
    }
    let active = true;
    void desktop.getDesktopPalette().then((p) => active && applyDesktopPalette(p));
    const unsubscribe = desktop.onDesktopPalette((p) => active && applyDesktopPalette(p));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [theme, desktop]);

  const setTo = useCallback((next: Theme) => () => setTheme(next), []);

  return (
    <div className="theme-toggle" role="group" aria-label={t("themeToggle.groupLabel")}>
      <button type="button" className={theme === "light" ? "active" : ""} onClick={setTo("light")} aria-pressed={theme === "light"} title={t("themeToggle.light")}>
        <Sun size={15} />
      </button>
      <button type="button" className={theme === "system" ? "active" : ""} onClick={setTo("system")} aria-pressed={theme === "system"} title={t("themeToggle.system")}>
        <Monitor size={15} />
      </button>
      <button type="button" className={theme === "dark" ? "active" : ""} onClick={setTo("dark")} aria-pressed={theme === "dark"} title={t("themeToggle.dark")}>
        <Moon size={15} />
      </button>
      {desktop && (
        <button type="button" className={theme === "desktop" ? "active" : ""} onClick={setTo("desktop")} aria-pressed={theme === "desktop"} title={t("themeToggle.desktop", "Match desktop colors")}>
          <Palette size={15} />
        </button>
      )}
    </div>
  );
}
