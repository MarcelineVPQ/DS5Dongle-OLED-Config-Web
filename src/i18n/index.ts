// i18next setup. Loads inline-bundled JSON resources for 7 locales,
// auto-detects from localStorage → navigator.languages → fallback en.
// Initialized once at app boot via the import in src/main.tsx.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import es from "./locales/es.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ptBR from "./locales/pt-BR.json";
import { capitalize, deviceVariables } from "./deviceForms";
import { logged } from "../errorText";

// Use bare BCP47 language codes only. We only support one variant of
// each, so "zh" / "pt" is enough; the previous "zh-CN" / "pt-BR" codes
// tripped i18next's region-tag normalization and silently fell back to
// English even when the user explicitly picked them.
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", shortLabel: "EN" },
  { code: "zh", label: "中文（简体）", shortLabel: "中" },
  { code: "es", label: "Español", shortLabel: "ES" },
  { code: "de", label: "Deutsch", shortLabel: "DE" },
  { code: "fr", label: "Français", shortLabel: "FR" },
  { code: "ja", label: "日本語", shortLabel: "JA" },
  { code: "pt", label: "Português (Brasil)", shortLabel: "PT" },
] as const;

// Where an explicitly chosen language is remembered.
export const LANGUAGE_KEY = "i18nextLng";

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

// The board's name in every string ({{device}}, {{deviceName}}, ...; see
// deviceForms.ts). One object, refilled in place when the board or the
// language changes, so every t() call sees the current name without passing it.
const deviceDefaults: Record<string, string> = {};
let deviceBoard: string | null = null;
const fillDevice = () => Object.assign(deviceDefaults, deviceVariables(i18n.resolvedLanguage ?? i18n.language, deviceBoard));

// Resources are bundled: init can't fail to load them (a key without text would show as the key).
i18n
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
      escapeValue: false, // React already escapes
      defaultVariables: deviceDefaults,
    },
    // Re-render translated text when the board's name changes, too.
    react: { bindI18n: "languageChanged deviceChanged" },
    // A language the user picked (saved by LanguageToggle) wins; otherwise the
    // system language every launch. Detected languages are not saved, so a
    // later change of system language is followed.
    detection: {
      order: ["localStorage", "navigator"],
      caches: [],
      lookupLocalStorage: LANGUAGE_KEY,
    },
  })
  .catch(logged("starting i18next"));

fillDevice();
i18n.on("languageChanged", fillDevice);
i18n.services.formatter?.add("capitalize", (value: unknown) => capitalize(String(value)));

/** The board strings name: the connected one, else the last one, else null ("your board"). */
export function setDeviceBoard(name: string | null): void {
  if (name === deviceBoard) return;
  deviceBoard = name;
  fillDevice();
  i18n.emit("deviceChanged");
}

export default i18n;
