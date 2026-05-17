// Status hero — top-left bento tile summarizing the dongle's current state.
// Shows: connection state, paired BD address, current slot, save-state, any
// issues. Replaces what used to live in the right-sidebar "State" box,
// pulled forward as a glanceable card.

import { CheckCircle2, RadioTower, Usb } from "lucide-react";
import { ConfigBody, ConfigValidationIssue } from "../protocol/config";

export interface StatusHeroProps {
  isConnected: boolean;
  isDirty: boolean;
  statusText: string;
  deviceLabel: string;
  config: ConfigBody | null;
  issues: ConfigValidationIssue[];
}

function fmtSlotLabel(slot: number | undefined): string {
  if (slot === undefined) return "—";
  return `Slot ${slot}`;
}

export default function StatusHero({
  isConnected,
  isDirty,
  statusText,
  deviceLabel,
  config,
  issues,
}: StatusHeroProps) {
  return (
    <div className="status-hero">
      <div className="status-hero-eyebrow">
        {isConnected ? <CheckCircle2 size={14} /> : <Usb size={14} />}
        <span>{statusText}</span>
        {isDirty && <span className="status-hero-dirty">· unsaved edits</span>}
      </div>
      <h2 className="status-hero-title">
        {isConnected ? "Connected" : "Ready to connect"}
      </h2>
      <div className="status-hero-device">{deviceLabel}</div>

      {config && (
        <div className="status-hero-stats">
          <div className="status-hero-stat">
            <span className="label">Active slot</span>
            <strong className="num">{fmtSlotLabel(config.currentSlot)}</strong>
          </div>
          <div className="status-hero-stat">
            <span className="label">Config version</span>
            <strong className="num">v{config.configVersion}</strong>
          </div>
          <div className="status-hero-stat">
            <span className="label">Auto Haptics</span>
            <strong>{
              config.autoHapticsEnable === 0 ? "Off" :
              config.autoHapticsEnable === 1 ? "Fallback" :
              config.autoHapticsEnable === 2 ? "Mix" : "Replace"
            }</strong>
          </div>
        </div>
      )}

      {!config && !isConnected && (
        <p className="status-hero-empty">
          <RadioTower size={14} /> Plug in your Pico + pair the DualSense, then click <strong>Connect</strong> above.
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
