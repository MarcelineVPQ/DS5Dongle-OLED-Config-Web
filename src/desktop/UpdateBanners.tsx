import { useTranslation } from "react-i18next";
import type { UpdateState } from "./api";
import type { FirmwareUpdate } from "./useUpdates";

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// One notice: its text, then (pushed right) an optional action.
function Notice({ error, children, action }: { error?: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`dk-notice${error ? " error" : ""}`}>
      {children}
      {action && <span className="dk-spacer" />}
      {action}
    </div>
  );
}
const Action = ({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className={`dk-btn${primary ? " primary" : ""}`} onClick={onClick}>
    {children}
  </button>
);

// App and firmware update notices, pinned above the page. Wording is literal on
// purpose: every state says exactly what is happening or what went wrong.
export default function UpdateBanners({ app, fw, onShowFirmware }: { app: UpdateState; fw: FirmwareUpdate; onShowFirmware: () => void }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const dismiss = <Action onClick={fw.dismiss}>{t("notice.dismiss")}</Action>;

  let appNotice: React.ReactNode = null;
  if (app.phase === "available")
    appNotice = (
      <Notice
        action={
          <Action primary onClick={() => void desktop?.installUpdate()}>
            {t("desktop.update.download", "Download and install")}
          </Action>
        }
      >
        <span>{t("desktop.update.appAvailable", { version: app.version, size: mb(app.size), defaultValue: "App update {{version}} is available ({{size}})." })}</span>
      </Notice>
    );
  else if (app.phase === "downloading")
    appNotice = (
      <Notice>
        <span>
          {t("desktop.update.downloading", {
            version: app.version,
            got: mb(app.got),
            total: mb(app.total),
            pct: Math.floor((app.got * 100) / Math.max(1, app.total)),
            defaultValue: "Downloading {{version}}: {{got}} of {{total}} ({{pct}}%)",
          })}
        </span>
      </Notice>
    );
  else if (app.phase === "installing") appNotice = <Notice>{t("desktop.update.installing", "Installing the update…")}</Notice>;
  else if (app.phase === "ready")
    appNotice = (
      <Notice
        action={
          <Action primary onClick={() => desktop?.restartToUpdate()}>
            {t("desktop.update.restart", "Restart now")}
          </Action>
        }
      >
        <span>{t("desktop.update.ready", { version: app.version, defaultValue: "Version {{version}} is installed." })}</span>
      </Notice>
    );
  else if (app.phase === "manual")
    appNotice = (
      <Notice
        action={
          app.notesUrl && (
            <a className="dk-btn" href={app.notesUrl} target="_blank" rel="noreferrer">
              {t("desktop.update.open", "Open release page")}
            </a>
          )
        }
      >
        <span>{t("desktop.update.manual", { version: app.version, defaultValue: "App update {{version}} is available on the release page." })}</span>
      </Notice>
    );

  const s = fw.state;
  let fwNotice: React.ReactNode = null;
  if (s.phase === "idle" && fw.available && fw.latest)
    fwNotice = (
      <Notice action={<Action onClick={onShowFirmware}>{t("desktop.update.details", "Details")}</Action>}>
        <span>{t("desktop.update.fwAvailable", { version: fw.latest.version, defaultValue: "Firmware {{version}} is available for your dongle." })}</span>
      </Notice>
    );
  else if (s.phase === "running" || s.phase === "verifying") {
    const step = s.phase === "verifying" ? (s.slow ? "verifyingPress" : "verifying") : s.progress.step;
    const pct = s.phase === "running" && s.progress.fraction !== undefined ? ` ${Math.floor(s.progress.fraction * 100)}%` : "";
    fwNotice = (
      <Notice>
        <strong>{t("desktop.update.fwDontUnplug", "Updating firmware, don't unplug the dongle.")}</strong>
        <span>
          {t(`desktop.update.fwStep.${step}`, step)}
          {pct}
        </span>
      </Notice>
    );
  } else if (s.phase === "done")
    fwNotice = (
      <Notice action={dismiss}>
        <span>{t("desktop.update.fwDone", { version: s.version, defaultValue: "Firmware updated to {{version}}. Press PS to reconnect the controller." })}</span>
      </Notice>
    );
  else if (s.phase === "failed")
    fwNotice = (
      <Notice error action={dismiss}>
        <span>{s.detail}</span>
      </Notice>
    );

  if (!appNotice && !fwNotice) return null;
  return (
    <>
      {appNotice}
      {fwNotice}
    </>
  );
}
