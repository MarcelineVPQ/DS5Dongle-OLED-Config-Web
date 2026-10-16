// Linux: the first time the app switches the controller's sound to its stereo
// headset profile (electron/main/games/headsetProfile.ts), it says so here,
// with Undo. After Undo it offers "Don't switch automatically" (the
// headsetStereo setting, also in Controller → Speaker).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Notice from "./Notice";
import { causeText, shown } from "./shownError";
import { HEADSET_STEREO_EVENT } from "./live/HeadsetStereo";

type State = "switched" | "undone" | "nothing" | null;

export default function HeadsetNotice() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(null);
  // lifetime: OK — the effect returns the preload's unsubscribe (unmount)
  useEffect(() => window.desktop?.onHeadsetSwitched(() => setState("switched")), []);
  if (!state) return null;
  const close = () => setState(null);
  const undo = () => {
    window.desktop
      ?.headsetUndo()
      .then((undone) => setState(undone ? "undone" : "nothing"))
      // error: SHOWN — desktop.errors.headsetUndo (the pinned error notice, with the reason)
      .catch((cause: unknown) => {
        close();
        shown("desktop.errors.headsetUndo", { reason: causeText(cause) })(cause);
      });
  };
  const dontSwitch = () => {
    close();
    window.desktop
      ?.setSetting("headsetStereo", false)
      .then((s) => window.dispatchEvent(new CustomEvent(HEADSET_STEREO_EVENT, { detail: s.headsetStereo })))
      .catch(shown("desktop.errors.settingNotSaved"));
  };
  const action =
    state === "switched" ? (
      <button type="button" className="dk-btn" onClick={undo}>
        {t("desktop.games.undoShort")}
      </button>
    ) : state === "undone" ? (
      <button type="button" className="dk-btn" onClick={dontSwitch}>
        {t("desktop.headset.dontSwitch")}
      </button>
    ) : undefined;
  const text = state === "switched" ? t("desktop.headset.switched") : state === "undone" ? t("desktop.headset.undone") : t("desktop.headset.nothingToUndo");
  return (
    <Notice pinned role="status" onDismiss={close} action={action}>
      <span>{text}</span>
    </Notice>
  );
}
