// Light / system / dark theme toggle, plus "match desktop" in the desktop app
// (the desktop's own colors: KDE's color scheme, or the system accent).
// The theme is applied by useApplyTheme() at the app root, not by the toggle.
// Persists the user's choice in localStorage. With no stored choice the desktop
// app follows the connected controller ("controller") and the web tool uses
// "system" (follow prefers-color-scheme).

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Gamepad2, Monitor, Moon, Palette, Sun } from "lucide-react";
import { controllerShade, onControllerShade } from "../desktop/live/controllerAccent";
import { useTranslation } from "react-i18next";
import { isDesktop } from "../desktop/api";
import { paletteToCssVars, type DesktopPalette } from "../desktop/theme/desktopPalette";

export type Theme = "light" | "dark" | "system" | "desktop" | "controller";

const STORAGE_KEY = "ds5-bridge-theme";
const STYLE_ID = "ds5-desktop-palette";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked: fall back to the default
  }
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  if ((stored === "desktop" || stored === "controller") && isDesktop()) return stored;
  // No choice yet: the desktop app follows the connected controller's colors.
  return isDesktop() ? "controller" : "system";
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

// One theme for the whole app: a tiny store, applied by useApplyTheme() at the
// app root (so it holds whether or not a toggle is on screen); toggles only
// read and change it.
// cache: OK — key=none (the stored theme); invalidated=set by setTheme (writes localStorage too); bound=1 entry
let currentTheme: Theme | null = null;
const listeners = new Set<() => void>();
const getTheme = () => (currentTheme ??= readStoredTheme());
function setStoredTheme(next: Theme): void {
  currentTheme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable: the choice lasts for this session
  }
  for (const l of listeners) l();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, (next: Theme) => void] {
  return [useSyncExternalStore(subscribe, getTheme), setStoredTheme];
}

// Call once at the app root: applies the theme, and follows the desktop's
// colors live while "match desktop" is chosen.
export function useApplyTheme(): void {
  const [theme] = useTheme();
  const desktop = window.desktop;
  // "Controller": light or dark from the connected controller's colorway.
  const shade = useSyncExternalStore(onControllerShade, controllerShade);
  // lifetime: OK — cleanup: unsubscribes the desktop palette; the other paths acquire nothing
  useEffect(() => {
    document.documentElement.toggleAttribute("data-controller-theme", theme === "controller");
    if (theme === "controller") {
      clearDesktopPalette();
      document.documentElement.setAttribute("data-theme", shade ?? "system");
      return;
    }
    if (theme !== "desktop" || !desktop) {
      clearDesktopPalette();
      document.documentElement.setAttribute("data-theme", theme === "desktop" ? "system" : theme);
      return;
    }
    let active = true;
    void desktop.getDesktopPalette().then((p) => active && applyDesktopPalette(p));
    // lifetime: OK — unsubscribed in the effect cleanup
    const unsubscribe = desktop.onDesktopPalette((p) => active && applyDesktopPalette(p));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [theme, desktop, shade]);
}

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  const desktop = window.desktop;

  const setTo = useCallback((next: Theme) => () => setTheme(next), [setTheme]);

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
        <button type="button" className={theme === "controller" ? "active" : ""} onClick={setTo("controller")} aria-pressed={theme === "controller"} title={t("themeToggle.controller")}>
          <Gamepad2 size={15} />
        </button>
      )}
      {desktop && (
        <button type="button" className={theme === "desktop" ? "active" : ""} onClick={setTo("desktop")} aria-pressed={theme === "desktop"} title={t("themeToggle.desktop", "Match desktop colors")}>
          <Palette size={15} />
        </button>
      )}
    </div>
  );
}
