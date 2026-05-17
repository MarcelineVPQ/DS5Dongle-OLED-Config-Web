import {
  AlertCircle,
  CheckCircle2,
  Download,
  Monitor,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sliders,
  Usb,
  Waves,
} from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import AdvancedReveal from "./components/AdvancedReveal";
import OledEmulator from "./components/OledEmulator";
import StatusHero from "./components/StatusHero";
import ThemeToggle from "./components/ThemeToggle";
import { useDs5Bridge } from "./hooks/useDs5Bridge";
import {
  AUTO_HAPTICS_LOWPASS_OPTIONS,
  AUTO_HAPTICS_MODE_OPTIONS,
  AutoHapticsLowpass,
  AutoHapticsMode,
  ConfigBody,
  ConfigValidationIssue,
  CONTROLLER_MODE_OPTIONS,
  ControllerMode,
  POLLING_RATE_OPTIONS,
  PollingRateMode,
  SLOT_OPTIONS,
  SlotIndex,
  fieldIssue,
} from "./protocol/config";

type Tab = "config" | "preview";

function readTabFromHash(): Tab {
  if (typeof window === "undefined") return "config";
  const h = window.location.hash.replace(/^#\/?/, "");
  return h === "preview" ? "preview" : "config";
}

export default function App() {
  const bridge = useDs5Bridge();
  const isBusy = bridge.operation !== null;
  const hasIssues = bridge.issues.length > 0;
  const [tab, setTab] = useState<Tab>(readTabFromHash);

  // Sync tab ↔ URL hash so #preview is shareable in Discord.
  useEffect(() => {
    const onHashChange = () => setTab(readTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    const target = tab === "preview" ? "#preview" : "#config";
    if (window.location.hash !== target) {
      // replaceState avoids piling history entries on every tab toggle.
      window.history.replaceState(null, "", `${window.location.pathname}${target}`);
    }
  }, [tab]);

  const autoHapticsHint =
    AUTO_HAPTICS_MODE_OPTIONS.find((o) => o.value === bridge.draft.autoHapticsEnable)?.hint ?? "";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">WebHID</div>
          <h1>DS5 Bridge Config — OLED Edition</h1>
        </div>
        <div className="header-tools">
          <ThemeToggle />
          <div className={`status-pill ${bridge.isConnected ? "connected" : ""}`}>
            {bridge.isConnected ? <CheckCircle2 size={16} /> : <Usb size={16} />}
            <span>{bridge.statusText}</span>
          </div>
        </div>
      </header>

      <nav className="tab-nav" aria-label="View tabs">
        <button
          type="button"
          className={tab === "config" ? "tab active" : "tab"}
          onClick={() => setTab("config")}
          aria-pressed={tab === "config"}
        >
          <Sliders size={16} /> Config
        </button>
        <button
          type="button"
          className={tab === "preview" ? "tab active" : "tab"}
          onClick={() => setTab("preview")}
          aria-pressed={tab === "preview"}
        >
          <Monitor size={16} /> OLED Preview
        </button>
      </nav>

      {bridge.error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{bridge.error}</span>
          <button type="button" onClick={bridge.clearError}>Dismiss</button>
        </div>
      )}

      {!bridge.supported && (
        <div className="notice warning">
          <AlertCircle size={18} />
          <span>WebHID is available in Chromium-based browsers (Chrome, Edge, Brave, Opera) on secure origins. Firefox is not supported by Mozilla.</span>
        </div>
      )}

      <section className="device-strip">
        <div className="device-main">
          <div className="device-icon"><Usb size={22} /></div>
          <div>
            <div className="label">Device</div>
            <strong>{bridge.deviceLabel}</strong>
          </div>
        </div>
        <div className="device-actions">
          {bridge.authorizedDevices.length > 0 && !bridge.client && (
            <button
              type="button"
              className="button secondary"
              onClick={() => bridge.connectAuthorized(bridge.authorizedDevices[0])}
              disabled={isBusy}
              title="Open the first previously authorized device"
            >
              <Power size={17} /> Open
            </button>
          )}
          <button
            type="button"
            className={`button primary ${bridge.isConnected ? "" : "pulse"}`}
            onClick={bridge.connect}
            disabled={!bridge.supported || isBusy}
            title="Choose a DS5 Bridge HID device"
          >
            <Usb size={17} /> Connect
          </button>
        </div>
      </section>

      {tab === "config" && (
      <div className="bento">
        {/* Status hero — top-left, span-8 */}
        <section className="card hover-lift span-8">
          <StatusHero
            isConnected={bridge.isConnected}
            isDirty={bridge.isDirty}
            statusText={bridge.statusText}
            deviceLabel={bridge.deviceLabel}
            config={bridge.config}
            issues={bridge.issues}
          />
        </section>

        {/* Actions — top-right, span-4 */}
        <section className="card span-4 actions-card">
          <div className="panel-title">
            <Download size={18} />
            <h2>Actions</h2>
          </div>
          <div className="action-stack">
            <button type="button" className="button secondary wide" onClick={bridge.readConfig} disabled={!bridge.client || isBusy} title="Read current config from report 0xF7">
              <RefreshCw size={17} /> Read
            </button>
            <button type="button" className="button primary wide" onClick={bridge.applyConfig} disabled={!bridge.client || isBusy || !bridge.isDirty || hasIssues} title="Send command 0x01 through report 0xF6 (update in-memory config)">
              <Send size={17} /> Apply to Device
            </button>
            <button type="button" className="button success wide" onClick={bridge.saveToFlash} disabled={!bridge.client || isBusy || bridge.isDirty} title={bridge.isDirty ? "Apply changes before saving" : "Send command 0x02 through report 0xF6 (write flash)"}>
              <Save size={17} /> Save to Flash
            </button>
            <button type="button" className="button secondary wide" onClick={bridge.reconnectUsb} disabled={!bridge.client || isBusy} title="Send command 0x03 through report 0xF6 (reconnect TinyUSB)">
              <Power size={17} /> Reconnect USB
            </button>
            <button type="button" className="button ghost wide" onClick={bridge.resetDraft} disabled={!bridge.config || isBusy || !bridge.isDirty} title="Restore the last config read or applied">
              <RotateCcw size={17} /> Reset Edits
            </button>
          </div>
        </section>

        {/* Audio Auto Haptics — distinguishing feature, full width, .feature accent */}
        <section className="card hover-lift feature span-12">
          <div className="panel-title">
            <Waves size={18} />
            <h2>Audio Auto Haptics</h2>
            <span className="feature-badge" title="Unique to the OLED Edition firmware">OLED Edition</span>
          </div>
          <p className="panel-blurb">
            Derive haptic feedback from the game's speaker audio for titles that send no native HD-haptic data (e.g. Ghost of Tsushima on Linux + Steam).
          </p>
          <div className="control-stack">
            <AutoHapticsModeControl
              value={bridge.draft.autoHapticsEnable}
              onChange={(value) => bridge.setDraftField("autoHapticsEnable", value)}
            />
            <p className="control-hint">{autoHapticsHint}</p>
            <IntegerControl
              label="Auto Haptics gain"
              suffix="%"
              value={bridge.draft.autoHapticsGain}
              min={0}
              max={200}
              step={10}
              issue={fieldIssue(bridge.issues, "autoHapticsGain")}
              onChange={(value) => bridge.setDraftField("autoHapticsGain", value)}
              disabled={bridge.draft.autoHapticsEnable === 0}
            />
            <AutoHapticsLowpassControl
              value={bridge.draft.autoHapticsLowpass}
              onChange={(value) => bridge.setDraftField("autoHapticsLowpass", value)}
              disabled={bridge.draft.autoHapticsEnable === 0}
            />
          </div>
        </section>

        {/* Multi-slot pairing — span-6 */}
        <section className="card hover-lift span-6">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>Multi-slot pairing</h2>
          </div>
          <p className="panel-blurb">
            Bond up to four DualSenses. The active slot reconnects on boot.
          </p>
          <div className="control-stack">
            <SegmentedControl
              label="Active slot"
              value={bridge.draft.currentSlot}
              options={SLOT_OPTIONS}
              onChange={(value) => bridge.setDraftField("currentSlot", value as SlotIndex)}
            />
          </div>
        </section>

        {/* Haptics & Audio — span-6 */}
        <section className="card hover-lift span-6">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>Haptics & Audio</h2>
          </div>
          <div className="control-stack">
            <FloatControl
              label="Haptics gain"
              value={bridge.draft.hapticsGain}
              min={1}
              max={2}
              step={0.05}
              issue={fieldIssue(bridge.issues, "hapticsGain")}
              onChange={(value) => bridge.setDraftField("hapticsGain", value)}
            />
            <FloatControl
              label="Speaker volume (dB)"
              value={bridge.draft.speakerVolume}
              min={-100}
              max={0}
              step={1}
              issue={fieldIssue(bridge.issues, "speakerVolume")}
              onChange={(value) => bridge.setDraftField("speakerVolume", value)}
            />
            <IntegerControl
              label="Audio buffer length"
              value={bridge.draft.audioBufferLength}
              min={16}
              max={128}
              step={4}
              issue={fieldIssue(bridge.issues, "audioBufferLength")}
              onChange={(value) => bridge.setDraftField("audioBufferLength", value)}
            />
          </div>
        </section>

        {/* Advanced — collapsed by default, span-12 */}
        <section className="card span-12 advanced-card">
          <AdvancedReveal>
            <div className="control-stack">
              <IntegerControl
                label="Inactive timeout (minutes)"
                value={bridge.draft.inactiveTime}
                min={5}
                max={60}
                step={1}
                issue={fieldIssue(bridge.issues, "inactiveTime")}
                onChange={(value) => bridge.setDraftField("inactiveTime", value)}
              />
              <ToggleControl
                label="Disable inactive disconnect"
                value={bridge.draft.disableInactiveDisconnect}
                onChange={(value) => bridge.setDraftField("disableInactiveDisconnect", value)}
              />
              <ToggleControl
                label="Disable Pico LED"
                value={bridge.draft.disablePicoLed}
                onChange={(value) => bridge.setDraftField("disablePicoLed", value)}
              />
              <SegmentedControl
                label="Polling rate"
                value={bridge.draft.pollingRateMode}
                options={POLLING_RATE_OPTIONS}
                onChange={(value) => bridge.setDraftField("pollingRateMode", value as PollingRateMode)}
              />
              <SegmentedControl
                label="Controller mode"
                value={bridge.draft.controllerMode}
                options={CONTROLLER_MODE_OPTIONS}
                onChange={(value) => bridge.setDraftField("controllerMode", value as ControllerMode)}
              />
            </div>
          </AdvancedReveal>
        </section>
      </div>
      )}

      {tab === "preview" && (
        <section className="panel preview-panel">
          <div className="panel-title">
            <Monitor size={18} />
            <h2>OLED Preview</h2>
          </div>
          <p className="panel-blurb">
            Live emulation of the firmware's 10 OLED screens — close to what the physical Pico-OLED-1.3 shows but not byte-perfect. Auto-cycles every 4 s with mock data when no controller is connected. With a controller connected (click <strong>Connect</strong> above), data is live. Share <code>#preview</code> to land Discord viewers directly on this view.
          </p>
          <OledEmulator client={bridge.client} />
        </section>
      )}

      <footer className="app-footer">
        Fork of <a href="https://github.com/awalol/ds5dongle-config-web" target="_blank" rel="noopener noreferrer">awalol/ds5dongle-config-web</a>{" "}
        for <a href="https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition" target="_blank" rel="noopener noreferrer">MarcelineVPQ/DS5Dongle-OLED-Edition</a> firmware.{" "}
        Audio Auto Haptics DSP credited to <a href="https://github.com/loteran/DS5Dongle" target="_blank" rel="noopener noreferrer">loteran/DS5Dongle</a>.
      </footer>
    </main>
  );
}

interface FloatControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  issue?: ConfigValidationIssue;
  onChange: (value: number) => void;
}

function FloatControl({ label, value, min, max, step, issue, onChange }: FloatControlProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (Number.isFinite(next)) onChange(next);
  };
  const displayDigits = step >= 1 ? 0 : 2;
  return (
    <label className={`control-row ${issue ? "invalid" : ""}`}>
      <span>
        <strong>{label}</strong>
        {issue && <small>{issue.message}</small>}
      </span>
      <div className="range-inputs">
        <input type="range" min={min} max={max} step={step} value={value} onChange={handleChange} />
        <input type="number" min={min} max={max} step={step} value={value.toFixed(displayDigits)} onChange={handleChange} />
      </div>
    </label>
  );
}

interface IntegerControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  issue?: ConfigValidationIssue;
  onChange: (value: number) => void;
  disabled?: boolean;
}

function IntegerControl({ label, value, min, max, step = 1, suffix, issue, onChange, disabled }: IntegerControlProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    if (Number.isFinite(next)) onChange(Math.round(next));
  };
  return (
    <label className={`control-row ${issue ? "invalid" : ""} ${disabled ? "disabled" : ""}`}>
      <span>
        <strong>{label}{suffix ? ` (${suffix})` : ""}</strong>
        {issue && <small>{issue.message}</small>}
      </span>
      <div className="range-inputs">
        <input type="range" min={min} max={max} step={step} value={value} onChange={handleChange} disabled={disabled} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={handleChange} disabled={disabled} />
      </div>
    </label>
  );
}

interface ToggleControlProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

function ToggleControl({ label, value, onChange }: ToggleControlProps) {
  return (
    <div className="control-row toggle-row">
      <strong>{label}</strong>
      <button
        type="button"
        className={`switch ${value ? "on" : ""}`}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        title={value ? "Enabled" : "Disabled"}
      >
        <span />
      </button>
    </div>
  );
}

interface SegmentedOption<T extends number> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends number> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}

function SegmentedControl<T extends number>({ label, value, options, onChange, disabled }: SegmentedControlProps<T>) {
  return (
    <div className={`control-row ${disabled ? "disabled" : ""}`}>
      <strong>{label}</strong>
      <div className={`segmented-control n-options-${options.length}`} role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface AutoHapticsModeControlProps {
  value: AutoHapticsMode;
  onChange: (value: AutoHapticsMode) => void;
}

function AutoHapticsModeControl({ value, onChange }: AutoHapticsModeControlProps) {
  return (
    <div className="control-row">
      <strong>Mode</strong>
      <div className="segmented-control n-options-4" role="group" aria-label="Auto Haptics mode">
        {AUTO_HAPTICS_MODE_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            title={option.hint}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface AutoHapticsLowpassControlProps {
  value: AutoHapticsLowpass;
  onChange: (value: AutoHapticsLowpass) => void;
  disabled?: boolean;
}

function AutoHapticsLowpassControl({ value, onChange, disabled }: AutoHapticsLowpassControlProps) {
  return (
    <div className={`control-row ${disabled ? "disabled" : ""}`}>
      <strong>Low-pass cutoff</strong>
      <div className="segmented-control n-options-4" role="group" aria-label="Auto Haptics low-pass cutoff">
        {AUTO_HAPTICS_LOWPASS_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
