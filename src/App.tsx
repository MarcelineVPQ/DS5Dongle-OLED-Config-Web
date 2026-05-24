import {
  AlertCircle,
  CheckCircle2,
  Download,
  Gamepad2,
  Monitor,
  Palette,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sliders,
  Usb,
  Waves,
  Zap,
} from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import AdvancedReveal from "./components/AdvancedReveal";
import Flasher from "./components/Flasher";
import LanguageToggle from "./components/LanguageToggle";
import OledEmulator from "./components/OledEmulator";
import RemapEditor from "./components/RemapEditor";
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
  LIGHTBAR_MODE_OPTIONS,
  POLLING_RATE_OPTIONS,
  PollingRateMode,
  SlotIndex,
  fieldIssue,
} from "./protocol/config";

type Tab = "config" | "remap" | "preview" | "flash";

function readTabFromHash(): Tab {
  if (typeof window === "undefined") return "config";
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "remap") return "remap";
  if (h === "preview") return "preview";
  if (h === "flash") return "flash";
  return "config";
}

export default function App() {
  const { t } = useTranslation();
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
    const target = tab === "remap" ? "#remap" : tab === "preview" ? "#preview" : tab === "flash" ? "#flash" : "#config";
    if (window.location.hash !== target) {
      // replaceState avoids piling history entries on every tab toggle.
      window.history.replaceState(null, "", `${window.location.pathname}${target}`);
    }
  }, [tab]);

  const autoHapticsModeKey = ["off", "fallback", "mix", "replace"][bridge.draft.autoHapticsEnable & 3];
  const autoHapticsHint = t(`autoHaptics.modes.${autoHapticsModeKey}.hint`);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <div className="eyebrow">{t("header.eyebrow")}</div>
          <h1 className="app-title">
            {t("header.title")}
            <span className="app-title-suffix">{t("header.titleSuffix")}</span>
          </h1>
        </div>
        <div className="header-tools">
          <LanguageToggle />
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
          <Sliders size={16} /> {t("tabs.config")}
        </button>
        <button
          type="button"
          className={tab === "remap" ? "tab active" : "tab"}
          onClick={() => setTab("remap")}
          aria-pressed={tab === "remap"}
        >
          <Gamepad2 size={16} /> {t("tabs.remap")}
        </button>
        <button
          type="button"
          className={tab === "preview" ? "tab active" : "tab"}
          onClick={() => setTab("preview")}
          aria-pressed={tab === "preview"}
        >
          <Monitor size={16} /> {t("tabs.preview")}
        </button>
        <button
          type="button"
          className={tab === "flash" ? "tab active" : "tab"}
          onClick={() => setTab("flash")}
          aria-pressed={tab === "flash"}
        >
          <Zap size={16} /> {t("tabs.flash")}
        </button>
      </nav>

      {bridge.error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{bridge.error}</span>
          <button type="button" onClick={bridge.clearError}>{t("notice.dismiss")}</button>
        </div>
      )}

      {!bridge.supported && (
        <div className="notice warning">
          <AlertCircle size={18} />
          <span>{t("notice.webhidUnavailable")}</span>
        </div>
      )}

      <section className="device-strip">
        <div className="device-main">
          <div className="device-icon"><Usb size={22} /></div>
          <div>
            <div className="label">{t("device.label")}</div>
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
              title={t("device.openPrevTitle")}
            >
              <Power size={17} /> {t("device.openPrev")}
            </button>
          )}
          <button
            type="button"
            className={`button primary ${bridge.isConnected ? "" : "pulse"}`}
            onClick={bridge.connect}
            disabled={!bridge.supported || isBusy}
            title={t("device.connectTitle")}
          >
            <Usb size={17} /> {t("device.connect")}
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
            <h2>{t("actions.title")}</h2>
          </div>
          <div className="action-stack">
            <button type="button" className="button secondary wide" onClick={bridge.readConfig} disabled={!bridge.client || isBusy} title={t("actions.readTitle")}>
              <RefreshCw size={17} /> {t("actions.read")}
            </button>
            <button type="button" className="button primary wide" onClick={bridge.applyConfig} disabled={!bridge.client || isBusy || !bridge.isDirty || hasIssues} title={t("actions.applyTitle")}>
              <Send size={17} /> {t("actions.apply")}
            </button>
            <button type="button" className="button success wide" onClick={bridge.saveToFlash} disabled={!bridge.client || isBusy || bridge.isDirty} title={bridge.isDirty ? t("actions.saveNeedsApply") : t("actions.saveTitle")}>
              <Save size={17} /> {t("actions.save")}
            </button>
            <button type="button" className="button secondary wide" onClick={bridge.reconnectUsb} disabled={!bridge.client || isBusy} title={t("actions.reconnectTitle")}>
              <Power size={17} /> {t("actions.reconnect")}
            </button>
            <button type="button" className="button ghost wide" onClick={bridge.resetDraft} disabled={!bridge.config || isBusy || !bridge.isDirty} title={t("actions.resetEditsTitle")}>
              <RotateCcw size={17} /> {t("actions.resetEdits")}
            </button>
          </div>
        </section>

        {/* Audio Auto Haptics — distinguishing feature, full width, .feature accent */}
        <section className="card hover-lift feature span-12">
          <div className="panel-title">
            <Waves size={18} />
            <h2>{t("autoHaptics.sectionTitle")}</h2>
            <span className="feature-badge" title={t("autoHaptics.blurb")}>{t("autoHaptics.badge")}</span>
          </div>
          <p className="panel-blurb">{t("autoHaptics.blurb")}</p>
          <div className="control-stack">
            <AutoHapticsModeControl
              value={bridge.draft.autoHapticsEnable}
              onChange={(value) => bridge.setDraftField("autoHapticsEnable", value)}
            />
            <p className="control-hint">{autoHapticsHint}</p>
            <IntegerControl
              label={t("autoHaptics.gainLabel")}
              suffix="%"
              value={bridge.draft.autoHapticsGain}
              min={0}
              max={200}
              step={10}
              issue={fieldIssue(bridge.issues, "autoHapticsGain")}
              onChange={(value) => bridge.setDraftField("autoHapticsGain", value)}
            />
            <AutoHapticsLowpassControl
              value={bridge.draft.autoHapticsLowpass}
              onChange={(value) => bridge.setDraftField("autoHapticsLowpass", value)}
            />
          </div>
        </section>

        {/* Multi-slot pairing — span-6 */}
        <section className="card hover-lift span-6">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>{t("slots.sectionTitle")}</h2>
          </div>
          <p className="panel-blurb">{t("slots.blurb")}</p>
          <div className="control-stack">
            <SegmentedControl
              label={t("slots.activeLabel")}
              value={bridge.draft.currentSlot}
              options={[0, 1, 2, 3].map((n) => ({
                value: n as SlotIndex,
                label: t("status.slotN", { n }),
              }))}
              onChange={(value) => bridge.setDraftField("currentSlot", value as SlotIndex)}
            />
          </div>
        </section>

        {/* Lightbar — span-6. Mode + 4 favorite colors (also editable on the
            OLED device; round-tripped through Config_body either way). */}
        <section className="card hover-lift span-6">
          <div className="panel-title">
            <Palette size={18} />
            <h2>{t("lightbar.sectionTitle")}</h2>
          </div>
          <p className="panel-blurb">{t("lightbar.blurb")}</p>
          <div className="control-stack">
            <SelectControl
              label={t("lightbar.modeLabel")}
              value={bridge.draft.lightbarMode}
              options={LIGHTBAR_MODE_OPTIONS}
              onChange={(value) => bridge.setDraftField("lightbarMode", value)}
            />
            {[0, 1, 2, 3].map((i) => (
              <ColorControl
                key={i}
                label={`FAV${i}`}
                rgb={[bridge.draft.lbFavR[i], bridge.draft.lbFavG[i], bridge.draft.lbFavB[i]]}
                onChange={([r, g, b]) => {
                  const at = (arr: number[], v: number) => arr.map((x, j) => (j === i ? v : x));
                  bridge.setDraftField("lbFavR", at(bridge.draft.lbFavR, r));
                  bridge.setDraftField("lbFavG", at(bridge.draft.lbFavG, g));
                  bridge.setDraftField("lbFavB", at(bridge.draft.lbFavB, b));
                }}
              />
            ))}
          </div>
        </section>

        {/* Haptics & Audio — span-6 */}
        <section className="card hover-lift span-6">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>{t("haptics.sectionTitle")}</h2>
          </div>
          <div className="control-stack">
            <FloatControl
              label={t("haptics.gainLabel")}
              value={bridge.draft.hapticsGain}
              min={1}
              max={2}
              step={0.05}
              issue={fieldIssue(bridge.issues, "hapticsGain")}
              onChange={(value) => bridge.setDraftField("hapticsGain", value)}
            />
            <FloatControl
              label={t("haptics.speakerVolumeLabel")}
              value={bridge.draft.speakerVolume}
              min={-100}
              max={0}
              step={1}
              issue={fieldIssue(bridge.issues, "speakerVolume")}
              onChange={(value) => bridge.setDraftField("speakerVolume", value)}
            />
            <IntegerControl
              label={t("haptics.audioBufferLabel")}
              value={bridge.draft.audioBufferLength}
              min={16}
              max={128}
              step={4}
              issue={fieldIssue(bridge.issues, "audioBufferLength")}
              onChange={(value) => bridge.setDraftField("audioBufferLength", value)}
            />
            <ToggleControl
              label={t("haptics.btMicLabel")}
              value={bridge.draft.btMicEnable}
              onChange={(value) => bridge.setDraftField("btMicEnable", value)}
            />
          </div>
        </section>

        {/* Advanced — collapsed by default, span-12 */}
        <section className="card span-12 advanced-card">
          <AdvancedReveal title={t("behavior.sectionTitle")} hint={t("behavior.hint")}>
            <div className="control-stack">
              <IntegerControl
                label={t("behavior.inactiveTimeLabel")}
                value={bridge.draft.inactiveTime}
                min={5}
                max={60}
                step={1}
                issue={fieldIssue(bridge.issues, "inactiveTime")}
                onChange={(value) => bridge.setDraftField("inactiveTime", value)}
              />
              <ToggleControl
                label={t("behavior.disableInactiveDisconnect")}
                value={bridge.draft.disableInactiveDisconnect}
                onChange={(value) => bridge.setDraftField("disableInactiveDisconnect", value)}
              />
              <ToggleControl
                label={t("behavior.disablePicoLed")}
                value={bridge.draft.disablePicoLed}
                onChange={(value) => bridge.setDraftField("disablePicoLed", value)}
              />
              <SegmentedControl
                label={t("behavior.pollingRateLabel")}
                value={bridge.draft.pollingRateMode}
                options={POLLING_RATE_OPTIONS}
                onChange={(value) => bridge.setDraftField("pollingRateMode", value as PollingRateMode)}
              />
              <SegmentedControl
                label={t("behavior.controllerModeLabel")}
                value={bridge.draft.controllerMode}
                options={CONTROLLER_MODE_OPTIONS}
                onChange={(value) => bridge.setDraftField("controllerMode", value as ControllerMode)}
              />
              <IntegerControl
                label={t("behavior.screenDimTimeoutLabel")}
                suffix={t("behavior.screenTimeoutSuffix")}
                value={bridge.draft.screenDimTimeout}
                min={0}
                max={250}
                step={1}
                issue={fieldIssue(bridge.issues, "screenDimTimeout")}
                onChange={(value) => bridge.setDraftField("screenDimTimeout", value)}
              />
              <IntegerControl
                label={t("behavior.screenOffTimeoutLabel")}
                suffix={t("behavior.screenTimeoutSuffix")}
                value={bridge.draft.screenOffTimeout}
                min={0}
                max={250}
                step={1}
                issue={fieldIssue(bridge.issues, "screenOffTimeout")}
                onChange={(value) => bridge.setDraftField("screenOffTimeout", value)}
              />
            </div>
          </AdvancedReveal>
        </section>
      </div>
      )}

      {tab === "remap" && (
        <section className="panel remap-panel">
          <div className="panel-title">
            <Gamepad2 size={18} />
            <h2>{t("remap.sectionTitle")}</h2>
            <span className="feature-badge" title={t("remap.blurb")}>{t("remap.badge")}</span>
          </div>
          <RemapEditor client={bridge.client} />
        </section>
      )}

      {tab === "preview" && (
        <section className="panel preview-panel">
          <div className="panel-title">
            <Monitor size={18} />
            <h2>{t("preview.sectionTitle")}</h2>
          </div>
          <p className="panel-blurb">
            <Trans i18nKey="preview.blurb" components={{ strong: <strong />, code: <code /> }} />
          </p>
          <OledEmulator client={bridge.client} />
        </section>
      )}

      {tab === "flash" && (
        <div className="panel flasher-panel">
          <Flasher />
        </div>
      )}

      <footer className="app-footer">
        <Trans
          i18nKey="footer.credits"
          components={[
            <a href="https://github.com/awalol/ds5dongle-config-web" target="_blank" rel="noopener noreferrer" />,
            <a href="https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition" target="_blank" rel="noopener noreferrer" />,
            <a href="https://github.com/loteran/DS5Dongle" target="_blank" rel="noopener noreferrer" />,
          ]}
        />
        <div className="studio-credit">
          A <a href="https://42pixelstudios.com" target="_blank" rel="noopener noreferrer">42 Pixel Studios</a> production
          {" — "}
          <a href="https://42pixelstudios.com/games/neon-debris/" target="_blank" rel="noopener noreferrer">play Neon Debris ↗</a>
        </div>
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

interface SelectControlProps {
  label: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (value: number) => void;
}

function SelectControl({ label, value, options, onChange }: SelectControlProps) {
  return (
    <label className="control-row">
      <strong>{label}</strong>
      <select value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function rgbToHex(rgb: number[]): string {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, c | 0)).toString(16).padStart(2, "0")).join("");
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

interface ColorControlProps {
  label: string;
  rgb: number[];
  onChange: (rgb: [number, number, number]) => void;
}

function ColorControl({ label, rgb, onChange }: ColorControlProps) {
  return (
    <label className="control-row">
      <strong>{label}</strong>
      <input
        type="color"
        value={rgbToHex(rgb)}
        onChange={(e) => onChange(hexToRgb(e.currentTarget.value))}
      />
    </label>
  );
}

interface AutoHapticsModeControlProps {
  value: AutoHapticsMode;
  onChange: (value: AutoHapticsMode) => void;
}

function AutoHapticsModeControl({ value, onChange }: AutoHapticsModeControlProps) {
  const { t } = useTranslation();
  const keys = ["off", "fallback", "mix", "replace"] as const;
  return (
    <div className="control-row">
      <strong>{t("autoHaptics.modeLabel")}</strong>
      <div className="segmented-control n-options-4" role="group" aria-label={t("autoHaptics.sectionTitle")}>
        {AUTO_HAPTICS_MODE_OPTIONS.map((option, i) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            title={t(`autoHaptics.modes.${keys[i]}.hint`)}
          >
            {t(`autoHaptics.modes.${keys[i]}.label`)}
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
  const { t } = useTranslation();
  const lpKeys = ["80", "160", "250", "400"] as const;
  return (
    <div className={`control-row ${disabled ? "disabled" : ""}`}>
      <strong>{t("autoHaptics.lpLabel")}</strong>
      <div className="segmented-control n-options-4" role="group" aria-label={t("autoHaptics.lpLabel")}>
        {AUTO_HAPTICS_LOWPASS_OPTIONS.map((option, i) => (
          <button
            type="button"
            key={option.value}
            className={option.value === value ? "selected" : ""}
            onClick={() => onChange(option.value)}
            aria-pressed={option.value === value}
            disabled={disabled}
          >
            {t(`autoHaptics.lpOptions.${lpKeys[i]}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
