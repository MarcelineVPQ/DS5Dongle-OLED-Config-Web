// What the app kept between starts and found damaged (error pass, batch E1):
// one notice each, in plain words: what it was, that the parts that still
// read were kept (or that it starts from the defaults), and where the damaged
// copy is. The main process's files (settings, game library) come over IPC
// once; the page's own preferences are told as they're read (src/persisted.ts).
// Each is said once: what loaded is written back, so the next start reads clean.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Notice from "./Notice";
import { onRecovered, recoveredHere, type Recovered } from "../persisted";
import { logged } from "../errorText";

const recoveredKey = (r: Recovered) => `${r.kind}:${r.kept ?? ""}`;

export default function RecoveredNotice() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<Recovered[]>([]);
  const [prefs, setPrefs] = useState<Recovered[]>(recoveredHere);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  // lifetime: OK — cleanup: the returned unsubscribe (unmount)
  useEffect(() => onRecovered(() => setPrefs(recoveredHere())), []);
  // lifetime: OK — cleanup: drops a late answer (holds no resource)
  useEffect(() => {
    let live = true;
    window.desktop
      ?.recoveredFiles()
      .then((r) => live && setFiles(r))
      .catch(logged("asking which files were damaged at start (an app bug: the damaged copies are still kept and logged by the main process)"));
    return () => {
      live = false;
    };
  }, []);

  // loop: NOT-WORTH — N = the damaged files and preferences (almost always 0), per render of this notice
  const shown = [...files, ...prefs].filter((r) => !closed.has(recoveredKey(r)));
  if (shown.length === 0) return null;
  return (
    <>
      {/* loop: NOT-WORTH — N = the damaged files and preferences (almost always 0) */}
      {shown.map((r) => {
        const what = t(`desktop.recovered.what.${r.kind}`);
        const text = r.kept === null ? t("desktop.recovered.notKept", { what }) : t(r.partial ? "desktop.recovered.partial" : "desktop.recovered.whole", { what, kept: r.kept });
        return (
          <Notice key={recoveredKey(r)} error pinned role="alert" onDismiss={() => setClosed((c) => new Set(c).add(recoveredKey(r)))}>
            <span className="dk-notice-text">{text}</span>
          </Notice>
        );
      })}
    </>
  );
}
