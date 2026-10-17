// The language picker: overrides the auto-detected i18next language.
// Persists to localStorage via i18next-browser-languagedetector's caches.

import { Check, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n, { LANGUAGE_KEY, SUPPORTED_LANGUAGES } from "../i18n";
import { logged } from "../errorText";
import { MenuButton } from "../desktop/MenuButton";

// The current language as one of ours (or English): also App settings →
// Language's status.
export function currentLanguage(language: string | undefined): (typeof SUPPORTED_LANGUAGES)[number] {
  // loop: HOT-PATH-OK — N = 7 languages, early exit; per render
  return SUPPORTED_LANGUAGES.find((l) => l.code === language) ?? SUPPORTED_LANGUAGES.find((l) => language?.startsWith(l.code)) ?? SUPPORTED_LANGUAGES[0];
}

// The word "Language" in every language the app has, for App settings →
// Language's header: someone who switched to a language they can't read
// finds their way back (owner, dev.15). The current language's word first
// (the title), the others after it (the status line), each word once (es and
// pt-BR share "Idioma"). Visual only: the header's accessible name stays in
// the current language.
export function languageWords(language: string | undefined): { own: string; others: string[] } {
  const ownCode = currentLanguage(language).code;
  const word = (code: string) => i18n.getFixedT(code)("desktop.settings2.language");
  const own = word(ownCode);
  // loop: NOT-WORTH — N = 7 languages; App settings' render
  const others = [...new Set(SUPPORTED_LANGUAGES.map((l) => word(l.code)))].filter((w) => w !== own);
  return { own, others };
}

// App settings → Language's picker: the app's one popup menu (MenuButton),
// each language a radio item in its own name (never a flag: languages aren't
// countries). Picking one switches, closes the menu and puts the focus back
// on the button; Escape closes it without leaving the drawer.
export default function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const current = currentLanguage(i18n.language);
  return (
    <MenuButton
      label={t("languageToggle.groupLabel")}
      title={t("languageToggle.currentTitle", { name: current.label })}
      className="language-toggle-button"
      align="end"
      iconOnly={false}
      content={
        <>
          <Globe size={15} aria-hidden="true" />
          <span className="language-toggle-current">{current.label}</span>
        </>
      }
    >
      {
        // loop: HOT-PATH-OK — N = 7 languages in the menu
        SUPPORTED_LANGUAGES.map((lang) => {
          const active = lang.code === current.code;
          return (
            <button
              key={lang.code}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              lang={lang.code}
              onClick={() => {
                void i18n.changeLanguage(lang.code).catch(logged("switching the language (resources are bundled, so nothing to load can fail)"));
                try {
                  window.localStorage.setItem(LANGUAGE_KEY, lang.code); // remember an explicit choice
                } catch {
                  // error: NOT-WORTH — storage unavailable: the choice lasts for this session
                }
              }}
              title={t("languageToggle.switchTo", { name: lang.label })}
            >
              <Check size={14} aria-hidden="true" className={active ? undefined : "dk-menu-off"} />
              <span className="language-toggle-label">{lang.label}</span>
              <span className="language-toggle-short">{lang.shortLabel}</span>
            </button>
          );
        })
      }
    </MenuButton>
  );
}
