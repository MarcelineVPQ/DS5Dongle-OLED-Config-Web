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

// Use bare BCP47 language codes only. We only support one variant of
// each, so "zh" / "pt" is enough; the previous "zh-CN" / "pt-BR" codes
// tripped i18next's region-tag normalization and silently fell back to
// English even when the user explicitly picked them.
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English",        shortLabel: "EN" },
  { code: "zh", label: "中文",           shortLabel: "中" },
  { code: "es", label: "Español",        shortLabel: "ES" },
  { code: "de", label: "Deutsch",        shortLabel: "DE" },
  { code: "fr", label: "Français",       shortLabel: "FR" },
  { code: "ja", label: "日本語",          shortLabel: "JA" },
  { code: "pt", label: "Português (BR)", shortLabel: "PT" },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]["code"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zhCN },
      es: { translation: es },
      de: { translation: de },
      fr: { translation: fr },
      ja: { translation: ja },
      pt: { translation: ptBR },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh", "es", "de", "fr", "ja", "pt"],
    // navigator may report "zh-CN" / "pt-BR" / "en-US" etc; match those
    // against the bare-code resources we ship.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
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
