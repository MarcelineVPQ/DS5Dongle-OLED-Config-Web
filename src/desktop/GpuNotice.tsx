// Hardware acceleration was turned off after the GPU process crashed twice
// (electron/main/gpuCrash.ts): the page says so, with Turn back on (bug hunt
// A4, 0.9.5: it used to go off without a word). Either way it applies from
// the next start.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Notice from "./Notice";
import { shown } from "./shownError";

export default function GpuNotice() {
  const { t } = useTranslation();
  const [state, setState] = useState<"off" | "on" | null>(null);
  // lifetime: OK — the effect returns the preload's unsubscribe (unmount)
  useEffect(() => window.desktop?.onGpuTurnedOff(() => setState("off")), []);
  if (!state) return null;
  const turnBackOn = () => {
    // error: SHOWN — desktop.errors.settingNotSaved (the notice closes; App settings still has the switch)
    window.desktop
      ?.setSetting("hardwareAcceleration", true)
      .then(() => setState("on"))
      // error: SHOWN — desktop.errors.settingNotSaved
      .catch((cause: unknown) => {
        setState(null);
        shown("desktop.errors.settingNotSaved")(cause);
      });
  };
  const action =
    state === "off" ? (
      <button type="button" className="dk-btn" onClick={turnBackOn}>
        {t("desktop.notices.gpuTurnBackOn")}
      </button>
    ) : undefined;
  return (
    <Notice pinned role="status" onDismiss={() => setState(null)} action={action}>
      <span>{t(state === "off" ? "desktop.notices.gpuOff" : "desktop.notices.gpuBackOn")}</span>
    </Notice>
  );
}
