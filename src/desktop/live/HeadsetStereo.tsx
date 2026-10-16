// Controller → Speaker: what the PC does with a headset in the controller's
// headset jack.
//   Linux: the switch for the stereo headset profile (the headsetStereo app
//     setting; electron/main/games/headsetProfile.ts does the switching).
//   Windows: how to set the controller to Stereo (Windows sets it up as a
//     4-channel device, whose rear channels drive the haptic feedback).
// macOS gives a headset stereo as it is: nothing to show.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfoTip, Toggle } from "../controls";
import { logged } from "../../errorText";

/** Sent when the setting changes outside this switch (the notice's "Don't switch automatically"). */
export const HEADSET_STEREO_EVENT = "ds5:headset-stereo";

export function HeadsetStereo() {
  const platform = window.desktop?.platform;
  if (platform === "linux") return <LinuxHeadsetStereo />;
  if (platform === "win32") return <WindowsStereoHint />;
  return null;
}

function LinuxHeadsetStereo() {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  // lifetime: OK — cleanup: drops a late answer and removes the event listener (unmount)
  useEffect(() => {
    let live = true;
    window.desktop
      ?.getSettings()
      .then((s) => live && setOn(s.headsetStereo))
      .catch(logged("reading the stereo headset setting (the switch stays hidden; App settings still save it)"));
    const changed = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    // lifetime: OK — removed in the cleanup (unmount)
    window.addEventListener(HEADSET_STEREO_EVENT, changed);
    return () => {
      live = false;
      window.removeEventListener(HEADSET_STEREO_EVENT, changed);
    };
  }, []);
  if (on === null) return null;
  return (
    <Toggle
      label={t("desktop.headset.stereo")}
      info={t("desktop.headset.stereoInfo")}
      value={on}
      // A rejection shows desktop.errors.actionFailed (Toggle) and the switch stays as it was.
      onChange={(value) => window.desktop!.setSetting("headsetStereo", value).then((s) => setOn(s.headsetStereo))}
    />
  );
}

function WindowsStereoHint() {
  const { t } = useTranslation();
  return (
    <p className="dk-hint">
      {t("desktop.headset.windowsStereo")}
      <InfoTip text={t("desktop.headset.windowsStereoInfo")} />
    </p>
  );
}
