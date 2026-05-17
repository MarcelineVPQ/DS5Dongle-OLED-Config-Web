// i18next setup. Loads inline-bundled JSON resources for 7 locales,
// auto-detects from localStorage → navigator.languages → fallback en.
// Initialized once at app boot via the import in src/main.tsx.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en    from "./locales/en.json";
import zhCN  from "./locales/zh-CN.json";
import es    from "./locales/es.json";
import de    from "./locales/de.json";
import fr    from "./locales/fr.json";
import ja    from "./locales/ja.json";
import ptBR  from "./locales/pt-BR.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en",    label: "English",         shortLabel: "EN" },
  { code: "zh-CN", label: "中文",             shortLabel: "中" },
  { code: "es",    label: "Español",         shortLabel: "ES" },
  { code: "de",    label: "Deutsch",         shortLabel: "DE" },
  { code: "fr",    label: "Français",        shortLabel: "FR" },
  { code: "ja",    label: "日本語",           shortLabel: "JA" },
  { code: "pt-BR", label: "Português (BR)",  shortLabel: "PT" },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]["code"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "en":    { translation: en },
      // Register the Chinese / Portuguese bundles under both the explicit
      // region-tagged code AND the bare language code. i18next's internal
      // lookup normalizes "zh-CN" → "zh" in some code paths, which would
      // otherwise fall back to English even when "zh-CN" is the active lng.
      "zh":    { translation: zhCN },
      "zh-CN": { translation: zhCN },
      "es":    { translation: es },
      "de":    { translation: de },
      "fr":    { translation: fr },
      "ja":    { translation: ja },
      "pt":    { translation: ptBR },
      "pt-BR": { translation: ptBR },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh", "zh-CN", "es", "de", "fr", "ja", "pt", "pt-BR"],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,      // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

export default i18n;
