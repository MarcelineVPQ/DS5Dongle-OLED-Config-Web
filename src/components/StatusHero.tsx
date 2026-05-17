// Status hero — top-left bento tile summarizing the dongle's current state.
// Shows: connection state, paired BD address, current slot, save-state, any
// issues. Replaces what used to live in the right-sidebar "State" box,
// pulled forward as a glanceable card.

import { CheckCircle2, RadioTower, Usb } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { ConfigBody, ConfigValidationIssue } from "../protocol/config";

export interface StatusHeroProps {
  isConnected: boolean;
  isDirty: boolean;
  statusText: string;
  deviceLabel: string;
  config: ConfigBody | null;
  issues: ConfigValidationIssue[];
}

const AUTO_HAP_MODE_KEYS = ["off", "fallback", "mix", "replace"] as const;

export default function StatusHero({
  isConnected,
  isDirty,
  statusText,
  deviceLabel,
  config,
  issues,
}: StatusHeroProps) {
  const { t } = useTranslation();
  return (
    <div className="status-hero">
      <div className="status-hero-eyebrow">
        {isConnected ? <CheckCircle2 size={14} /> : <Usb size={14} />}
        <span>{statusText}</span>
        {isDirty && <span className="status-hero-dirty">· {t("status.unsavedEdits")}</span>}
      </div>
      <h2 className="status-hero-title">
        {isConnected ? t("status.connected") : t("status.ready")}
      </h2>
      <div className="status-hero-device">{deviceLabel}</div>

      {config && (
        <div className="status-hero-stats">
          <div className="status-hero-stat">
            <span className="label">{t("status.activeSlot")}</span>
            <strong className="num">{t("status.slotN", { n: config.currentSlot })}</strong>
          </div>
          <div className="status-hero-stat">
            <span className="label">{t("status.configVersion")}</span>
            <strong className="num">{t("status.configVersionPrefix", { n: config.configVersion })}</strong>
          </div>
          <div className="status-hero-stat">
            <span className="label">{t("status.autoHaptics")}</span>
            <strong>{t(`autoHaptics.modes.${AUTO_HAP_MODE_KEYS[config.autoHapticsEnable & 3]}.label`)}</strong>
          </div>
        </div>
      )}

      {!config && !isConnected && (
        <p className="status-hero-empty">
          <RadioTower size={14} />{" "}
          <Trans i18nKey="status.empty" components={{ strong: <strong /> }} />
        </p>
      )}

      {issues.length > 0 && (
        <ul className="status-hero-issues">
          {issues.map((i) => (
            <li key={i.field}>{i.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
