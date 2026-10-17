// Text the main process shows by itself, with no page to translate it (the
// dialog when the app can't start): keyed text (src/errorText.ts) in the
// system's language, from the same locale files as the page. The locale file
// is loaded only then (a dynamic import, its own chunk).
import { translateKeyed, type TextParams } from "../../src/errorText";
import { capitalize, deviceVariables } from "../../src/i18n/deviceForms";

type Locale = { default: Record<string, unknown> };
const LOCALES: Record<string, () => Promise<Locale>> = {
  en: () => import("../../src/i18n/locales/en.json"),
  de: () => import("../../src/i18n/locales/de.json"),
  es: () => import("../../src/i18n/locales/es.json"),
  fr: () => import("../../src/i18n/locales/fr.json"),
  ja: () => import("../../src/i18n/locales/ja.json"),
  pt: () => import("../../src/i18n/locales/pt-BR.json"),
  zh: () => import("../../src/i18n/locales/zh-CN.json"),
};

const lookup = (strings: Record<string, unknown>, key: string): string | undefined => {
  const v = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), strings);
  return typeof v === "string" ? v : undefined;
};

// `{{name}}` and `{{name, capitalize}}`, as i18next fills them on the page.
const fill = (template: string, params: TextParams): string =>
  template.replace(/\{\{\s*([\w-]+)\s*(,\s*capitalize\s*)?\}\}/g, (whole, name: string, cap: string | undefined) => {
    const v = params[name];
    if (v === undefined) return whole;
    return cap ? capitalize(String(v)) : String(v);
  });

// Text by key in the system's language, for what the main process shows on
// its own (the tray's menu and tooltip): `board` is the board's name for the
// {{device…}} variables (null: "your board").
export type MainTranslate = (key: string, params?: TextParams, board?: string | null) => string;

// `locale`: Electron's app.getLocale() ("de", "pt-BR", "zh-CN", …).
export async function mainTranslator(locale: string): Promise<MainTranslate> {
  const lang = locale.split("-")[0].toLowerCase();
  const [own, en] = await Promise.all([(LOCALES[lang] ?? LOCALES.en)(), LOCALES.en()]);
  return (key, params = {}, board = null) => fill(lookup(own.default, key) ?? lookup(en.default, key) ?? key, { ...deviceVariables(lang, board), ...params });
}

export async function mainText(text: string, locale: string): Promise<string> {
  const t = await mainTranslator(locale);
  return translateKeyed(text, (key, params) => t(key, params));
}
