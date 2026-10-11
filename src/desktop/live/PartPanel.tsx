// The side panel of the one-screen view: the settings for whatever is
// selected (a part of the controller, the dongle, or the app itself). The
// sections are the same components the old pages used.
import { PanelRightClose, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LanguageToggle from "../../components/LanguageToggle";
import ThemeToggle from "../../components/ThemeToggle";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { InputReport } from "../../oled/inputReport";
import { REMAP_BUTTON_OPTIONS, REMAP_DISABLED } from "../../protocol/remap";
import type { DesktopSettings } from "../api";
import { BusyButton, Toggle } from "../controls";
import { startTour } from "../tour/Tour";
import DiagnosticsPage from "../pages/DiagnosticsPage";
import { DongleInternals } from "../pages/DongleInternals";
import FirmwarePage from "../pages/FirmwarePage";
import LightbarPage from "../pages/LightbarPage";
import { AutoHapticsSection, DisplaySection, HapticsSection, MicSection, PowerSection, SpeakerSection, UsbSection } from "../pages/SettingsPage";
import SlotsPage from "../pages/SlotsPage";
import TriggersPage from "../pages/TriggersPage";
import { usePoll } from "../usePoll";
import type { FirmwareUpdate } from "../useUpdates";
import { REMAP_INDEX, type PartId } from "./parts";
import type { Remap } from "./useRemap";

export type PanelView = "overview" | "dongle" | "app" | { part: PartId };

interface Props {
  view: PanelView;
  bridge: UseDs5BridgeResult;
  fw: FirmwareUpdate;
  input: InputReport | null;
  remap: Remap;
  advancedOpen: boolean;
  onClose: () => void;
  onOpen: (part: PartId) => void;
  onHide: () => void;
}

export default function PartPanel({ view, bridge, fw, input, remap, advancedOpen, onClose, onOpen, onHide }: Props) {
  const { t } = useTranslation();
  const title =
    view === "overview"
      ? t("desktop.live.overview", "Your controller")
      : view === "dongle"
        ? t("desktop.nav.dongle", "Dongle")
        : view === "app"
          ? t("desktop.live.app", "App settings")
          : partName(t, view.part);

  return (
    <div className="dk-stack">
      <header className="live-panel-head">
        <h2>{title}</h2>
        {view === "overview" && (
          <button type="button" className="dk-btn dk-icon-btn" onClick={onHide} title={t("desktop.live.hidePanel")} aria-label={t("desktop.live.hidePanel")}>
            <PanelRightClose size={14} />
          </button>
        )}
        {view !== "overview" && (
          <button type="button" className="dk-btn dk-icon-btn" onClick={onClose} title={t("desktop.live.close", "Close")} aria-label={t("desktop.live.close", "Close")}>
            <X size={14} />
          </button>
        )}
      </header>
      {view === "overview" && <Overview onOpen={onOpen} />}
      {view === "dongle" && <DongleSections bridge={bridge} fw={fw} advancedOpen={advancedOpen} />}
      {view === "app" && <AppSettings />}
      {typeof view === "object" && <PartSections part={view.part} bridge={bridge} input={input} remap={remap} />}
    </div>
  );
}

function partName(t: (k: string) => string, part: PartId): string {
  return part === "body" ? t("desktop.live.part.body") : t(`desktop.live.part.${part}`);
}

// Shortcuts to every panel, so nobody has to guess where on the drawing a
// setting lives (the grips for haptics weren't obvious).
const SHORTCUTS: Array<[key: string, part: PartId]> = [
  ["lightbar", "lightbar"],
  ["triggers", "r2"],
  ["haptics", "body"],
  ["speaker", "speaker"],
  ["mic", "mute"],
  ["slots", "ps"],
];

function Overview({ onOpen }: { onOpen: (part: PartId) => void }) {
  const { t } = useTranslation();
  return (
    <section className="dk-card">
      <p>{t("desktop.live.go.intro")}</p>
      <div className="live-shortcuts">
        {SHORTCUTS.map(([key, part]) => (
          <button key={key} type="button" className="live-shortcut" onClick={() => onOpen(part)}>
            <strong>{t(`desktop.live.go.${key}.title`)}</strong>
            <span>{t(`desktop.live.go.${key}.sub`)}</span>
          </button>
        ))}
      </div>
      <p className="dk-hint">{t("desktop.live.go.buttons")}</p>
    </section>
  );
}

function PartSections({ part, bridge, input, remap }: { part: PartId; bridge: UseDs5BridgeResult; input: InputReport | null; remap: Remap }) {
  const index = REMAP_INDEX[part];
  return (
    <>
      {part === "lightbar" && <LightbarPage bridge={bridge} />}
      {(part === "l2" || part === "r2") && <TriggerLive input={input} side={part} />}
      {(part === "l2" || part === "r2") && <TriggersPage bridge={bridge} />}
      {(part === "stick-l" || part === "stick-r") && <StickLive input={input} side={part} />}
      {part === "touchpad" && <TouchLive input={input} />}
      {part === "speaker" && <SpeakerSection bridge={bridge} />}
      {part === "speaker" && <LevelMeter bridge={bridge} which="speaker" />}
      {part === "body" && <HapticsSection bridge={bridge} />}
      {part === "body" && <LevelMeter bridge={bridge} which="haptic" />}
      {part === "body" && <AutoHapticsSection bridge={bridge} />}
      {part === "mute" && <MicSection bridge={bridge} />}
      {part === "ps" && <SlotsPage bridge={bridge} />}
      {index !== undefined && <RemapSection index={index} remap={remap} />}
    </>
  );
}

function RemapSection({ index, remap }: { index: number; remap: Remap }) {
  const { t } = useTranslation();
  const target = remap.draft[index];
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.remap", "Remap")}</h2>
      {remap.supported === false ? (
        <p className="dk-hint">{t("remap.unsupported")}</p>
      ) : (
        <>
          <div className="dk-row">
            <label htmlFor={`remap-${index}`}>{t("desktop.live.remapActs", "Acts as")}</label>
            <select id={`remap-${index}`} className="dk-select" value={target} disabled={remap.busy || remap.supported !== true} onChange={(e) => remap.setTarget(index, Number(e.target.value))}>
              {REMAP_BUTTON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === index ? `${o.label} (${t("desktop.live.remapDefault", "default")})` : o.label}
                </option>
              ))}
              <option value={REMAP_DISABLED}>{t("remap.disabled")}</option>
            </select>
          </div>
          <p className="dk-hint">{t("desktop.live.remapHint", "Remaps are written to the dongle when you press Apply and work in every game, with no software on the PC.")}</p>
          {remap.error && <div className="dk-notice error">{remap.error}</div>}
          <div className="dk-row-btns">
            <BusyButton className="dk-btn primary" disabled={!remap.dirty || remap.busy} onClick={remap.apply}>
              {t("desktop.live.remapApply", "Apply remap")}
            </BusyButton>
            <button type="button" className="dk-btn" disabled={!remap.dirty || remap.busy} onClick={remap.revert}>
              {t("desktop.bar.revert", "Revert")}
            </button>
            <button type="button" className="dk-btn" disabled={remap.busy} onClick={remap.resetAll} title={t("desktop.live.remapResetHint", "Every button back to itself")}>
              {t("desktop.live.remapReset", "Reset all")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="live-meter" aria-hidden="true">
      <span style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

function TriggerLive({ input, side }: { input: InputReport | null; side: "l2" | "r2" }) {
  const { t } = useTranslation();
  const value = input ? (side === "l2" ? input.triggerLeft : input.triggerRight) : 0;
  const effect = input ? (side === "l2" ? input.triggerEffectLeft : input.triggerEffectRight) : 0;
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.pull", "Pull")}</h2>
      <Meter value={value / 255} />
      <p className="dk-hint">
        {Math.round((value / 255) * 100)}% · {t("desktop.live.effect", "Effect")}: {t(`desktop.live.effects.${effect}`, String(effect))}
      </p>
    </section>
  );
}

function StickLive({ input, side }: { input: InputReport | null; side: "stick-l" | "stick-r" }) {
  const { t } = useTranslation();
  const s = input ? (side === "stick-l" ? input.leftStick : input.rightStick) : { x: 128, y: 128 };
  const pct = (v: number) => Math.round(((v - 128) / 127) * 100);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.position", "Position")}</h2>
      <p className="dk-mono">
        X {pct(s.x)}% · Y {pct(s.y)}%
      </p>
    </section>
  );
}

function TouchLive({ input }: { input: InputReport | null }) {
  const { t } = useTranslation();
  const touching = input?.fingers.filter((f) => f.touching) ?? [];
  return (
    <section className="dk-card">
      <p className="dk-hint">{t("desktop.live.touchHint", "Touch the touchpad to see your fingers here. There's nothing to set up for it.")}</p>
      {touching.map((f, i) => (
        <p key={i} className="dk-mono">
          {t("desktop.live.finger", { n: i + 1, defaultValue: "Finger {{n}}" })}: {f.x}, {f.y}
        </p>
      ))}
    </section>
  );
}

function LevelMeter({ bridge, which }: { bridge: UseDs5BridgeResult; which: "speaker" | "haptic" }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const diag = usePoll(() => client!.readDiag(), 250, Boolean(client)).value;
  const peak = diag ? (which === "speaker" ? diag.peakSpeaker : diag.peakHaptic) : 0;
  return (
    <section className="dk-card">
      <h2>{which === "speaker" ? t("desktop.live.speakerLevel", "Speaker level now") : t("desktop.live.hapticLevel", "Haptics level now")}</h2>
      <Meter value={peak / 255} />
    </section>
  );
}

function DongleSections({ bridge, fw, advancedOpen }: { bridge: UseDs5BridgeResult; fw: FirmwareUpdate; advancedOpen: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <FirmwarePage bridge={bridge} fw={fw} />
      <PowerSection bridge={bridge} />
      <DisplaySection bridge={bridge} />
      <UsbSection bridge={bridge} />
      <details className="dk-card dk-advanced" open={advancedOpen}>
        <summary>{t("desktop.dongle.advanced", "Advanced")}</summary>
        <DongleInternals bridge={bridge} />
        <DiagnosticsPage bridge={bridge} />
      </details>
    </>
  );
}

// The app's own settings (stored by the main process), plus theme and language.
function AppSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  useEffect(() => {
    void window.desktop?.getSettings().then(setSettings);
  }, []);
  const set = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => void window.desktop?.setSetting(key, value).then(setSettings);
  return (
    <>
      <section className="dk-card">
        <h2>{t("desktop.live.look", "Look")}</h2>
        <div className="dk-row-btns">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </section>
      {settings && (
        <section className="dk-card">
          <h2>{t("desktop.live.behavior", "Behavior")}</h2>
          <Toggle label={t("desktop.live.closeToTray")} value={settings.closeToTray} onChange={(v) => set("closeToTray", v)} />
          <Toggle label={t("desktop.live.launchAtLogin")} value={settings.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} />
          <Toggle label={t("desktop.live.startMinimized")} value={settings.startMinimized} onChange={(v) => set("startMinimized", v)} />
          <Toggle label={t("desktop.live.checkForUpdates")} value={settings.checkForUpdates} onChange={(v) => set("checkForUpdates", v)} />
        </section>
      )}
      <section className="dk-card">
        <h2>{t("desktop.tour.helpTitle")}</h2>
        <p className="dk-hint">{t("desktop.tour.helpHint")}</p>
        <div className="dk-row-btns">
          <button type="button" className="dk-btn" onClick={startTour}>
            {t("desktop.tour.replay")}
          </button>
        </div>
      </section>
    </>
  );
}
