import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { type AutoHapticsLowpass, type AutoHapticsMode, type ControllerMode, type PollingRateMode, fieldIssue } from "../../protocol/config";
import { BusyButton, Segmented, Slider, Toggle } from "../controls";

// Settings sections, each a card the live view's side panel shows for the
// part it belongs to. Changes apply to the dongle's RAM right away
// (DesktopApp); "Save to dongle" in the bottom bar makes them survive a
// power cycle.
type SectionProps = { bridge: UseDs5BridgeResult };

function useFields(bridge: UseDs5BridgeResult) {
  const d = bridge.draft;
  const set = bridge.setDraftField;
  const issue = (f: Parameters<typeof fieldIssue>[1]) => Boolean(fieldIssue(bridge.issues, f));
  return { d, set, issue };
}

export function HapticsSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.haptics", "Haptics")}</h2>
      <Slider label={t("haptics.gainLabel")} value={d.hapticsGain} min={1} max={6} step={0.1} digits={1} unit="×" invalid={issue("hapticsGain")} onChange={(v) => set("hapticsGain", v)} />
      <Slider
        label={t("haptics.audioBufferLabel")}
        sub={t("haptics.audioBufferSub")}
        value={d.audioBufferLength}
        min={16}
        max={128}
        step={4}
        invalid={issue("audioBufferLength")}
        onChange={(v) => set("audioBufferLength", v)}
      />
    </section>
  );
}

export function AutoHapticsSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(bridge);
  const ahModes: ReadonlyArray<{ value: AutoHapticsMode; label: string; title: string }> = (["off", "fallback", "mix", "replace"] as const).map((k, i) => ({
    value: i as AutoHapticsMode,
    label: t(`autoHaptics.modes.${k}.label`),
    title: t(`autoHaptics.modes.${k}.hint`),
  }));
  return (
    <section className="dk-card">
      <h2>{t("autoHaptics.sectionTitle")}</h2>
      <Segmented label={t("autoHaptics.modeLabel")} value={d.autoHapticsEnable} options={ahModes} onChange={(v) => set("autoHapticsEnable", v)} />
      <Slider label={t("autoHaptics.gainLabel")} value={d.autoHapticsGain} min={0} max={200} step={10} unit="%" disabled={d.autoHapticsEnable === 0} onChange={(v) => set("autoHapticsGain", v)} />
      <Segmented
        label={t("autoHaptics.lpLabel")}
        value={d.autoHapticsLowpass}
        disabled={d.autoHapticsEnable === 0}
        options={[80, 160, 250, 400].map((hz, i) => ({ value: i as AutoHapticsLowpass, label: `${hz} Hz` }))}
        onChange={(v) => set("autoHapticsLowpass", v)}
      />
      <p className="dk-hint">{t(`autoHaptics.modes.${["off", "fallback", "mix", "replace"][d.autoHapticsEnable & 3]}.hint`)}</p>
    </section>
  );
}

export function SpeakerSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.speaker", "Speaker")}</h2>
      <Slider
        label={t("desktop.settings.speakerLevel", "Speaker level")}
        sub={t("desktop.settings.speakerLevelSub", "0 = unchanged; above 0 boosts and can clip")}
        value={d.speakerVolume}
        // Usual range ±12 dB; a lower level set on the OLED (down to -100)
        // still shows as it is instead of being clamped by the slider.
        min={Math.min(-12, Math.floor(d.speakerVolume))}
        max={12}
        step={1}
        unit="dB"
        signed
        invalid={issue("speakerVolume")}
        onChange={(v) => set("speakerVolume", v)}
      />
    </section>
  );
}

export function MicSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.mic", "Microphone")}</h2>
      <Toggle label={t("haptics.btMicLabel")} value={d.btMicEnable} onChange={(v) => set("btMicEnable", v)} />
    </section>
  );
}

export function PowerSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.power", "Power")}</h2>
      <Toggle label={t("desktop.settings.idleDisconnect", "Disconnect when idle")} value={!d.disableInactiveDisconnect} onChange={(v) => set("disableInactiveDisconnect", !v)} />
      <Slider label={t("behavior.inactiveTimeLabel")} value={d.inactiveTime} min={5} max={60} step={5} unit="min" disabled={d.disableInactiveDisconnect} onChange={(v) => set("inactiveTime", v)} />
      <Toggle label={t("desktop.settings.picoLed", "Pico status LED")} value={!d.disablePicoLed} onChange={(v) => set("disablePicoLed", !v)} />
    </section>
  );
}

export function DisplaySection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.display", "OLED display")}</h2>
      <Segmented
        label={t("desktop.settings.brightness", "Brightness")}
        value={d.screenBrightness}
        options={["100%", "50%", "25%", "6%"].map((label, i) => ({ value: i, label }))}
        onChange={(v) => set("screenBrightness", v)}
      />
      <Slider
        label={t("behavior.screenDimTimeoutLabel")}
        sub={t("desktop.settings.zeroOff", "0 = never")}
        value={d.screenDimTimeout}
        min={0}
        max={Math.max(60, d.screenDimTimeout)}
        step={1}
        unit="min"
        onChange={(v) => set("screenDimTimeout", v)}
      />
      <Slider
        label={t("behavior.screenOffTimeoutLabel")}
        sub={t("desktop.settings.zeroOff", "0 = never")}
        value={d.screenOffTimeout}
        min={0}
        max={Math.max(120, d.screenOffTimeout)}
        step={1}
        unit="min"
        onChange={(v) => set("screenOffTimeout", v)}
      />
      <Toggle label={t("desktop.settings.controllerWakes", "Controller input wakes the screen")} value={d.controllerWakesDisplay} onChange={(v) => set("controllerWakesDisplay", v)} />
    </section>
  );
}

export function UsbSection({ bridge }: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(bridge);
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.usb", "USB")}</h2>
      <Segmented
        label={t("behavior.pollingRateLabel")}
        value={d.pollingRateMode}
        options={[
          { value: 0 as PollingRateMode, label: "250 Hz" },
          { value: 1 as PollingRateMode, label: "500 Hz" },
          { value: 2 as PollingRateMode, label: "1 kHz" },
        ]}
        onChange={(v) => set("pollingRateMode", v)}
      />
      <Segmented
        label={t("behavior.controllerModeLabel")}
        value={d.controllerMode}
        options={[
          { value: 0 as ControllerMode, label: "DS5" },
          { value: 1 as ControllerMode, label: "Edge" },
          { value: 2 as ControllerMode, label: "Auto" },
        ]}
        onChange={(v) => set("controllerMode", v)}
      />
      <p className="dk-hint">{t("desktop.settings.usbHint", "These take effect after Reconnect USB (the PC sees the dongle unplug and replug).")}</p>
      <div className="dk-ctl" style={{ justifyContent: "flex-start", paddingBottom: 4 }}>
        <BusyButton disabled={!bridge.client || bridge.operation !== null} onClick={bridge.reconnectUsb}>
          {t("actions.reconnect")}
        </BusyButton>
      </div>
    </section>
  );
}
