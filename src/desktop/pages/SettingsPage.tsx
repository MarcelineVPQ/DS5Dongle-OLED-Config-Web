import { useTranslation } from "react-i18next";
import { FEATURES2, supportsFeature2 } from "../../protocol/bridgeClient";
import type { AutoHapticsLowpass, AutoHapticsMode, ControllerMode, PollingRateMode } from "../../protocol/config";
import { BusyButton, GripHaptics, Segmented, Slider, Toggle } from "../controls";
import { useFields, type SectionProps } from "./sectionFields";

// Settings sections, each a card the live view's side panel shows for the
// part it belongs to. Changes apply to the dongle's RAM right away
// (DesktopApp); "Save to dongle" in the bottom bar makes them survive a
// power cycle. The game page shows the profile-able ones with a game
// profile's draft instead (`fields`, see sectionFields.tsx).
export function HapticsSection(props: SectionProps) {
  const { t } = useTranslation();
  const { bridge } = props;
  const { d, set, patch, issue, sub, live } = useFields(props);
  const gripTest = live && bridge.client && supportsFeature2(bridge.identity, 6, FEATURES2.gripTest);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.haptics", "Haptic feedback")}</h2>
      <GripHaptics
        left={d.hapticsGain}
        right={d.hapticsGainRight}
        split={!!bridge.client?.splitHaptics}
        sub={sub("hapticsGain")}
        invalid={issue("hapticsGain") || issue("hapticsGainRight")}
        onChange={(l, r) => patch({ hapticsGain: l, hapticsGainRight: r })}
      />
      {gripTest && (
        <div className="dk-row-btns">
          {(["left", "right", "both"] as const).map((side) => (
            <BusyButton key={side} className="dk-btn" disabled={!bridge.identity?.controllerConnected} onClick={() => bridge.client!.gripTest(side)}>
              {t(`desktop.grips.test.${side}`)}
            </BusyButton>
          ))}
        </div>
      )}
      {gripTest && <p className="dk-hint">{t("desktop.grips.testHint")}</p>}
      <Slider
        label={t("haptics.audioBufferLabel")}
        sub={sub("audioBufferLength", t("haptics.audioBufferSub"))}
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

export function AutoHapticsSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub } = useFields(props);
  const ahModes: ReadonlyArray<{ value: AutoHapticsMode; label: string; title: string }> = (["off", "fallback", "mix", "replace"] as const).map((k, i) => ({
    value: i as AutoHapticsMode,
    label: t(`autoHaptics.modes.${k}.label`),
    title: t(`autoHaptics.modes.${k}.hint`),
  }));
  return (
    <section className="dk-card">
      <h2>{t("autoHaptics.sectionTitle")}</h2>
      <Segmented label={t("autoHaptics.modeLabel")} sub={sub("autoHapticsEnable")} value={d.autoHapticsEnable} options={ahModes} onChange={(v) => set("autoHapticsEnable", v)} />
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

export function SpeakerSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue, sub } = useFields(props);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.speaker", "Speaker")}</h2>
      <Slider
        label={t("desktop.settings.speakerLevel", "Volume (Speaker for Controller)")}
        sub={sub("speakerVolume", t("desktop.settings.speakerLevelSub", "0 = unchanged; above 0 boosts and can clip"))}
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

export function MicSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub } = useFields(props);
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.mic", "Microphone")}</h2>
      <Toggle label={t("haptics.btMicLabel")} sub={sub("btMicEnable")} value={d.btMicEnable} onChange={(v) => set("btMicEnable", v)} />
    </section>
  );
}

export function PowerSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.power", "Power")}</h2>
      <Toggle label={t("desktop.settings.idleDisconnect", "Disconnect when idle")} value={!d.disableInactiveDisconnect} onChange={(v) => set("disableInactiveDisconnect", !v)} />
      <Slider label={t("behavior.inactiveTimeLabel")} value={d.inactiveTime} min={5} max={60} step={5} unit="min" disabled={d.disableInactiveDisconnect} onChange={(v) => set("inactiveTime", v)} />
      <Toggle label={t("desktop.settings.picoLed", "Pico status LED")} value={!d.disablePicoLed} onChange={(v) => set("disablePicoLed", !v)} />
    </section>
  );
}

export function DisplaySection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
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

export function UsbSection(props: SectionProps) {
  const { t } = useTranslation();
  const { bridge } = props;
  const { d, set } = useFields(props);
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
