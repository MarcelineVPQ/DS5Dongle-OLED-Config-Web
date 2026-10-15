import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateState } from "./api";
import { BusyButton } from "./controls";
import Notice from "./Notice";
import { appUpdateKey, firmwareUpdateKey } from "./openTasks";
import { type FirmwareUpdate, useFirmwareHold } from "./useUpdates";
import { formatMb } from "./format";
import { shownText } from "./shownError";

const Action = ({ primary, onClick, disabled, title, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) => (
  <button type="button" className={`dk-btn${primary ? " primary" : ""}`} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </button>
);

// App and firmware update notices, pinned above the page. Wording is literal on
// purpose: every state says exactly what is happening or what went wrong.
export default function UpdateBanners({
  app,
  fw,
  onShowFirmware,
  onFirmwareChanges,
}: {
  app: UpdateState;
  fw: FirmwareUpdate;
  onShowFirmware: () => void; // the Pico page, where Update installs it
  onFirmwareChanges: () => void; // About → Firmware changes
}) {
  const { t } = useTranslation();
  // A failed install stays said until dismissed (a failed scheduled check
  // stays quiet); failing again after another try shows it again.
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const failed = app.phase === "failed";
  // Forgotten once the update moves on (set while rendering, React's pattern
  // for state that follows a prop).
  const [wasFailed, setWasFailed] = useState(failed);
  if (wasFailed !== failed) {
    setWasFailed(failed);
    if (!failed) setDismissedFailure(null);
  }
  const desktop = window.desktop;
  const appKey = appUpdateKey(app) ?? undefined;
  // While firmware is written, restarting or installing the app waits (the
  // main process holds them too); the notice says why.
  const hold = useFirmwareHold();
  const waitHint = hold.writing ? t("desktop.update.restartWait") : undefined;

  let appNotice: React.ReactNode = null;
  if (app.phase === "available")
    appNotice = (
      <Notice
        dismissKey={appKey}
        action={
          <BusyButton className="dk-btn primary" onClick={() => desktop?.installUpdate()} disabled={hold.writing} title={waitHint}>
            {t("desktop.update.download", "Download and install")}
          </BusyButton>
        }
      >
        <span>{t("desktop.update.appAvailable", { version: app.version, size: formatMb(app.size), defaultValue: "App update {{version}} is available ({{size}})." })}</span>
        {app.dropsDevTools && <span>{t("desktop.update.dropsDevTools")}</span>}
        {waitHint && <span>{waitHint}</span>}
      </Notice>
    );
  else if (app.phase === "downloading")
    appNotice = (
      <Notice closable>
        <span>
          {t("desktop.update.downloading", {
            version: app.version,
            got: formatMb(app.got),
            total: formatMb(app.total),
            pct: Math.floor((app.got * 100) / Math.max(1, app.total)),
            defaultValue: "Downloading {{version}}: {{got}} of {{total}} ({{pct}}%)",
          })}
        </span>
      </Notice>
    );
  else if (app.phase === "failed" && app.during === "install" && dismissedFailure !== app.detail)
    // was SILENT-BUG: when Download and install failed, the banner just went away
    appNotice = (
      <Notice error onDismiss={() => setDismissedFailure(app.detail)}>
        <span>{t("desktop.update.appFailed", { detail: shownText(app.detail) })}</span>
      </Notice>
    );
  else if (app.phase === "installing") appNotice = <Notice closable>{t("desktop.update.installing", "Installing the update…")}</Notice>;
  else if (app.phase === "ready")
    appNotice = (
      <Notice
        dismissKey={appKey}
        action={
          <Action primary onClick={() => desktop?.restartToUpdate()} disabled={hold.writing} title={waitHint}>
            {t("desktop.update.restart", "Restart now")}
          </Action>
        }
      >
        <span>{t("desktop.update.ready", { version: app.version, defaultValue: "Version {{version}} is installed." })}</span>
        {hold.writing && <span>{t(hold.restartQueued ? "desktop.update.restartQueued" : "desktop.update.restartWait")}</span>}
      </Notice>
    );
  else if (app.phase === "manual")
    appNotice = (
      <Notice
        dismissKey={appKey}
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
      <Notice
        dismissKey={firmwareUpdateKey(fw.latest.version)}
        action={
          <>
            <Action onClick={onFirmwareChanges}>{t("desktop.update.details", "Details")}</Action>
            <Action primary onClick={onShowFirmware}>
              {t("desktop.update.fwUpdate")}
            </Action>
          </>
        }
      >
        <span>{t("desktop.update.fwAvailable", { version: fw.latest.version })}</span>
      </Notice>
    );
  else if (s.phase === "running" || s.phase === "verifying") {
    const step = s.phase === "verifying" ? (s.slow ? "verifyingPress" : "verifying") : s.progress.step;
    const pct = s.phase === "running" && s.progress.fraction !== undefined ? ` ${Math.floor(s.progress.fraction * 100)}%` : "";
    fwNotice = (
      <Notice>
        <strong>{t("desktop.update.fwDontUnplug", "Updating firmware, don't unplug {{device}}.")}</strong>
        <span>
          {t(`desktop.update.fwStep.${step}`, step)}
          {pct}
        </span>
      </Notice>
    );
  } else if (s.phase === "done")
    fwNotice = (
      <Notice onDismiss={fw.dismiss}>
        <span>{t("desktop.update.fwDone", { version: s.version, defaultValue: "Firmware updated to {{version}}. Press PS to reconnect the controller." })}</span>
      </Notice>
    );
  else if (s.phase === "notStarted")
    // The board came back in BOOTSEL: the one place to install it again (DesktopApp keeps the setup screen's own offer out of the way meanwhile).
    fwNotice = (
      <Notice
        error
        role="alert"
        onDismiss={fw.dismiss}
        action={
          <BusyButton className="dk-btn primary" onClick={fw.reinstall}>
            {t("desktop.firmware.installAgain")}
          </BusyButton>
        }
      >
        <span>{t("desktop.firmware.didntStart")}</span>
      </Notice>
    );
  else if (s.phase === "failed")
    fwNotice = (
      <Notice error onDismiss={fw.dismiss}>
        <span>{s.detail}</span>
      </Notice>
    );

  // Asked to quit mid-write (any firmware write, Setup's first install too):
  // the window stays until the write ends.
  const quitNotice = hold.writing && hold.quitQueued && (
    <Notice>
      <strong>{t("desktop.update.quitQueued")}</strong>
    </Notice>
  );

  if (!appNotice && !fwNotice && !quitNotice) return null;
  return (
    <>
      {quitNotice}
      {/* Keyed by phase: a notice closed in one step doesn't hide the next. */}
      <Fragment key={`app-${app.phase}`}>{appNotice}</Fragment>
      <Fragment key={`fw-${s.phase}`}>{fwNotice}</Fragment>
    </>
  );
}
