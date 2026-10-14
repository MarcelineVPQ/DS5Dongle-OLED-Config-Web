// Asked once, on first run: install app updates automatically? Shown after
// the tour (or a minute in, if there's no tour, e.g. no controller yet), never
// over it. Either answer is final; App settings can change it any time.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tourDone } from "./tour/Tour";

const ASK_AFTER_MS = 60_000;

export default function AutoUpdateAsk() {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(true);
  const [due, setDue] = useState(false);
  // lifetime: WASTE — cleanup clears the interval only at unmount: it ticks after the answer, and hidden
  useEffect(() => {
    void window.desktop?.getSettings().then((s) => setAsked(s.updatesAsked));
    const started = Date.now();
    // lifetime: WASTE — 1 Hz DOM query for the app's life, also once answered and while hidden
    const timer = setInterval(() => {
      const tourOpen = Boolean(document.querySelector(".tour-card"));
      setDue(!tourOpen && (tourDone() || Date.now() - started > ASK_AFTER_MS));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  if (asked || !due || !window.desktop) return null;
  const answer = (on: boolean) => {
    setAsked(true);
    void window.desktop?.setSetting("autoInstallUpdates", on).then(() => window.desktop?.setSetting("updatesAsked", true));
  };
  return (
    <div className="dk-notice" role="dialog" aria-label={t("desktop.update.askTitle")}>
      <span>
        <b>{t("desktop.update.askTitle")}</b> {t("desktop.update.askBody")}
      </span>
      <span className="dk-spacer" />
      <button type="button" className="dk-btn" onClick={() => answer(false)}>
        {t("desktop.update.askNo")}
      </button>
      <button type="button" className="dk-btn primary" onClick={() => answer(true)}>
        {t("desktop.update.askYes")}
      </button>
    </div>
  );
}
