import { useTranslation } from "react-i18next";
import type { UpdateState } from "./api";
import type { FirmwareUpdate } from "./useUpdates";

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// App and firmware update notices, pinned above the page. Wording is literal on
// purpose: every state says exactly what is happening or what went wrong.
export default function UpdateBanners({ app, fw, onShowFirmware }: { app: UpdateState; fw: FirmwareUpdate; onShowFirmware: () => void }) {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const banners: JSX.Element[] = [];

  if (app.phase === "available") {
    banners.push(
      <div className="dk-notice" key="app">
        <span>{t("desktop.update.appAvailable", { version: app.version, size: mb(app.size), defaultValue: "App update {{version}} is available ({{size}})." })}</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn primary" onClick={() => void desktop?.installUpdate()}>
          {t("desktop.update.download", "Download and install")}
        </button>
      </div>,
    );
  } else if (app.phase === "downloading") {
    banners.push(
      <div className="dk-notice" key="app">
        <span>
          {t("desktop.update.downloading", {
            version: app.version,
            got: mb(app.got),
            total: mb(app.total),
            pct: Math.floor((app.got * 100) / Math.max(1, app.total)),
            defaultValue: "Downloading {{version}}: {{got}} of {{total}} ({{pct}}%)",
          })}
        </span>
      </div>,
    );
  } else if (app.phase === "installing") {
    banners.push(
      <div className="dk-notice" key="app">
        {t("desktop.update.installing", "Installing the update…")}
      </div>,
    );
  } else if (app.phase === "ready") {
    banners.push(
      <div className="dk-notice" key="app">
        <span>{t("desktop.update.ready", { version: app.version, defaultValue: "Version {{version}} is installed." })}</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn primary" onClick={() => desktop?.restartToUpdate()}>
          {t("desktop.update.restart", "Restart now")}
        </button>
      </div>,
    );
  } else if (app.phase === "manual") {
    banners.push(
      <div className="dk-notice" key="app">
        <span>{t("desktop.update.manual", { version: app.version, defaultValue: "App update {{version}} is available on the release page." })}</span>
        <span className="dk-spacer" />
        {app.notesUrl && (
          <a className="dk-btn" href={app.notesUrl} target="_blank" rel="noreferrer">
            {t("desktop.update.open", "Open release page")}
          </a>
        )}
      </div>,
    );
  }

  const s = fw.state;
  if (s.phase === "idle" && fw.available && fw.latest) {
    banners.push(
      <div className="dk-notice" key="fw">
        <span>{t("desktop.update.fwAvailable", { version: fw.latest.version, defaultValue: "Firmware {{version}} is available for your dongle." })}</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn" onClick={onShowFirmware}>
          {t("desktop.update.details", "Details")}
        </button>
      </div>,
    );
  } else if (s.phase === "running" || s.phase === "verifying") {
    const step = s.phase === "verifying" ? "verifying" : s.progress.step;
    const pct = s.phase === "running" && s.progress.fraction !== undefined ? ` ${Math.floor(s.progress.fraction * 100)}%` : "";
    banners.push(
      <div className="dk-notice" key="fw">
        <strong>{t("desktop.update.fwDontUnplug", "Updating firmware, don't unplug the dongle.")}</strong>
        <span>
          {t(`desktop.update.fwStep.${step}`, step)}
          {pct}
        </span>
      </div>,
    );
  } else if (s.phase === "done") {
    banners.push(
      <div className="dk-notice" key="fw">
        <span>{t("desktop.update.fwDone", { version: s.version, defaultValue: "Firmware updated to {{version}}. Press PS to reconnect the controller." })}</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn" onClick={fw.dismiss}>
          {t("notice.dismiss")}
        </button>
      </div>,
    );
  } else if (s.phase === "failed") {
    banners.push(
      <div className="dk-notice error" key="fw">
        <span>{s.detail}</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-btn" onClick={fw.dismiss}>
          {t("notice.dismiss")}
        </button>
      </div>,
    );
  }

  return banners.length ? <>{banners}</> : null;
}
