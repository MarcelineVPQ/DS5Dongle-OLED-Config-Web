// Asked once, on first run: install app updates automatically? Shown after
// the tour (or a minute in, if there's no tour, e.g. no controller yet), never
// over it. Either answer is final; App settings can change it any time.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tourDone } from "./tour/Tour";
import { useWindowShown } from "./useWindowShown";

const ASK_AFTER_MS = 60_000;

export default function AutoUpdateAsk() {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(true);
  const [due, setDue] = useState(false);
  const shown = useWindowShown();
  // The minute counts from the app's start, also while it's hidden.
  const [started] = useState(() => Date.now());
  // lifetime: OK — acquires nothing (reads whether the question was answered)
  useEffect(() => {
    let live = true;
    void window.desktop?.getSettings().then((s) => live && setAsked(s.updatesAsked));
    return () => {
      live = false;
    };
  }, []);
  // Waits for its moment only while the question is still open and the
  // window is on screen: none once answered (or due), none while hidden.
  // lifetime: OK — cleanup clears the interval (answered, due, window hidden, unmount)
  useEffect(() => {
    if (asked || due || !shown) return;
    // lifetime: OK — cleared in the effect cleanup once answered, due or hidden
    const timer = setInterval(() => {
      const tourOpen = Boolean(document.querySelector(".tour-card"));
      setDue(!tourOpen && (tourDone() || Date.now() - started > ASK_AFTER_MS));
    }, 1000);
    return () => clearInterval(timer);
  }, [asked, due, shown, started]);
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
