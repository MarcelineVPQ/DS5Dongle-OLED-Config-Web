import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FEATURES2, FEATURES3, POWER_FLAGS, supportsFeature2, supportsFeature3 } from "../../protocol/bridgeClient";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import {
  STATUS_GPIO_OFF,
  STATUS_GPIO_PINS,
  type AutoHapticsLowpass,
  type AutoHapticsMode,
  type ControllerMode,
  type MicSelect,
  type PollingRateMode,
  type SpeakerSelect,
  type StatusGpioMode,
} from "../../protocol/config";
import { BusyButton, GripHaptics, Row, Segmented, Slider, Toggle } from "../controls";
import { useFields, type SectionProps } from "./sectionFields";

// Settings sections, each a card the live view's side panel shows for the
// part it belongs to. Changes apply to the dongle's RAM right away
// (DesktopApp); "Save to dongle" in the bottom bar makes them survive a
// power cycle. The game page shows the profile-able ones with a game
// profile's draft instead (`fields`, see sectionFields.tsx).
// The haptic feedback test plays for 3 s. Firmware from protocol 1.15
// (FEATURES3.timedGripTest) holds the grip test (0xF6 0x0E) steadily for a
// given time: one command starts it, and pressing the running button again,
// leaving the panel, or losing the controller or dongle sends a stop. Older
// firmware buzzes 0.5 s per command, so the app repeats it every 0.4 s (the
// pulses overlap, no gap) and stops sending pulses instead.
type GripSide = "left" | "right" | "both";
const GRIP_TEST_S = 3;
const GRIP_PULSE_MS = 500; // one pulse on firmware before 1.15
const GRIP_REPEAT_MS = 400;

function useGripTest(client: UseDs5BridgeResult["client"], connected: boolean, timed: boolean) {
  const [running, setRunning] = useState<GripSide | null>(null);
  const stop = useRef<(() => void) | null>(null);
  // Unmount, another client or a disconnect ends a running test.
  useEffect(() => () => stop.current?.(), [client, connected]);
  const run = useCallback(
    async (side: GripSide) => {
      if (!client) return;
      let stopped = false;
      let wake = () => {};
      const own = () => {
        stopped = true;
        wake();
      };
      stop.current = own;
      const start = Date.now();
      const until = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(0, start + ms - Date.now()));
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      setRunning(side);
      try {
        if (timed) {
          await client.gripTest(side, GRIP_TEST_S);
          if (!stopped) await until(GRIP_TEST_S * 1000);
          // Stopped early: the dongle would keep buzzing to the end.
          if (stopped) await client.gripTest(side, 0).catch(() => undefined);
        } else {
          // The last pulse ends by the 3 s mark.
          for (let at = 0; at <= GRIP_TEST_S * 1000 - GRIP_PULSE_MS; at += GRIP_REPEAT_MS) {
            await until(at);
            if (stopped) break;
            await client.gripTest(side);
          }
          if (!stopped) await until(GRIP_TEST_S * 1000);
        }
      } finally {
        if (stop.current === own) stop.current = null;
        setRunning((r) => (r === side ? null : r));
      }
    },
    [client, timed],
  );
  return { running, run, stop: () => stop.current?.() };
}

// Protocol 1.13 (upstream's settings batch): trigger reduction, speaker boost,
// volume lock, mic and speaker choice, status pin.
const hasV13 = (bridge: UseDs5BridgeResult) => supportsFeature3(bridge.identity, 13, FEATURES3.configTail);

// The adaptive triggers' resistance, weaker in 10 steps (0 = the game's own).
// Per game too (a profile can hold it).
export function TriggerIntensitySection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue, sub } = useFields(props);
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.triggerIntensity")}</h2>
      {hasV13(props.bridge) ? (
        <Slider
          label={t("desktop.settings.triggerReduce")}
          sub={sub("triggerReduce", t("desktop.settings.triggerReduceSub"))}
          value={d.triggerReduce}
          min={0}
          max={10}
          step={1}
          invalid={issue("triggerReduce")}
          onChange={(v) => set("triggerReduce", v)}
        />
      ) : (
        <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>
      )}
    </section>
  );
}

export function HapticsSection(props: SectionProps) {
  const { t } = useTranslation();
  const { bridge } = props;
  const { d, set, patch, issue, sub, live } = useFields(props);
  const gripTest = live && bridge.client && supportsFeature2(bridge.identity, 6, FEATURES2.gripTest);
  const connected = !!bridge.identity?.controllerConnected;
  const test = useGripTest(bridge.client, connected, supportsFeature3(bridge.identity, 15, FEATURES3.timedGripTest));
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
            <BusyButton
              key={side}
              className="dk-btn"
              disabled={!connected || (test.running !== null && test.running !== side)}
              countdown={GRIP_TEST_S}
              onStop={test.stop}
              onClick={() => test.run(side)}
            >
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
  const { d, set, issue, sub, live } = useFields(props);
  const v13 = hasV13(props.bridge);
  const outputs: ReadonlyArray<{ value: SpeakerSelect; label: string }> = (["auto", "speaker", "headset", "off"] as const).map((k, i) => ({
    value: i as SpeakerSelect,
    label: t(`desktop.settings.choice.${k}`),
  }));
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
      {v13 && (
        <>
          <Slider
            label={t("desktop.settings.speakerBoost")}
            sub={sub("speakerGain", t("desktop.settings.speakerBoostSub"))}
            value={d.speakerGain}
            min={0}
            max={7}
            step={1}
            invalid={issue("speakerGain")}
            onChange={(v) => set("speakerGain", v)}
          />
          <Toggle label={t("desktop.settings.lockVolume")} sub={sub("lockVolume", t("desktop.settings.lockVolumeSub"))} value={d.lockVolume} onChange={(v) => set("lockVolume", v)} />
          {/* Where the PC's audio plays is the dongle's, not a game's (not in profiles). */}
          {live && <Segmented label={t("desktop.settings.audioOutput")} value={d.speakerSelect} options={outputs} onChange={(v) => set("speakerSelect", v)} />}
        </>
      )}
      {!v13 && <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>}
    </section>
  );
}

export function MicSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub, live } = useFields(props);
  const mics: ReadonlyArray<{ value: MicSelect; label: string }> = (["auto", "builtIn", "headset"] as const).map((k, i) => ({
    value: i as MicSelect,
    label: t(`desktop.settings.choice.${k}`),
  }));
  return (
    <section className="dk-card">
      <h2>{t("desktop.live.mic", "Microphone")}</h2>
      <Toggle label={t("haptics.btMicLabel")} sub={sub("btMicEnable")} value={d.btMicEnable} onChange={(v) => set("btMicEnable", v)} />
      {/* Which mic is the dongle's setting, not a game's (not in profiles). */}
      {live && hasV13(props.bridge) && <Segmented label={t("desktop.settings.micInput")} value={d.micSelect} options={mics} disabled={!d.btMicEnable} onChange={(v) => set("micSelect", v)} />}
    </section>
  );
}

// A GPIO that shows the controller connection (an LED, a PC's power header).
export function StatusPinSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
  const off = d.statusGpioPin === STATUS_GPIO_OFF;
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.statusPin")}</h2>
      {hasV13(props.bridge) ? (
        <>
          <Row label={t("desktop.settings.statusPinGpio")}>
            <select className="dk-select" aria-label={t("desktop.settings.statusPinGpio")} value={d.statusGpioPin} onChange={(e) => set("statusGpioPin", Number(e.currentTarget.value))}>
              <option value={STATUS_GPIO_OFF}>{t("desktop.settings.statusPinOff")}</option>
              {STATUS_GPIO_PINS.map((pin) => (
                <option key={pin} value={pin}>
                  GP{pin}
                </option>
              ))}
            </select>
          </Row>
          <Segmented
            label={t("desktop.settings.statusPinMode")}
            value={d.statusGpioMode}
            disabled={off}
            options={[
              { value: 0 as StatusGpioMode, label: t("desktop.settings.statusPinHigh") },
              { value: 1 as StatusGpioMode, label: t("desktop.settings.statusPinPulse") },
            ]}
            onChange={(v) => set("statusGpioMode", v)}
          />
          <p className="dk-hint">{t("desktop.settings.statusPinHint")}</p>
        </>
      ) : (
        <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>
      )}
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

// What the dongle does when the PC sleeps (protocol 1.14). Not part of the
// config body or a game's profile: each switch is saved on the dongle at once
// (0xF6 0x17), and shows the dongle's own bits (identity [47]), so a change
// on the OLED shows here too.
export function PcSleepSection({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const bits = bridge.identity?.powerFlags ?? null;
  const flip = (bit: number, on: boolean) => (bits === null ? undefined : bridge.setPowerFlags(on ? bits | bit : bits & ~bit));
  // One write at a time: the next one is worked out from the bits this one leaves.
  const off = bits === null || !bridge.client || bridge.operation !== null;
  return (
    <section className="dk-card">
      <h2>{t("desktop.settings.pcSleep")}</h2>
      {bits !== null ? (
        <>
          <Toggle
            label={t("desktop.settings.sleepControllerOff")}
            sub={t("desktop.settings.sleepControllerOffSub")}
            value={(bits & POWER_FLAGS.sleepControllerOff) !== 0}
            disabled={off}
            onChange={(v) => flip(POWER_FLAGS.sleepControllerOff, v)}
          />
          <Toggle
            label={t("desktop.settings.psWakesPc")}
            sub={t("desktop.settings.psWakesPcSub")}
            value={(bits & POWER_FLAGS.psWakesPc) !== 0}
            disabled={off}
            onChange={(v) => flip(POWER_FLAGS.psWakesPc, v)}
          />
          <p className="dk-hint">{t("desktop.settings.pcSleepHint")}</p>
        </>
      ) : (
        <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>
      )}
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
      <p className="dk-hint">{t("desktop.settings.usbHint", "These take effect after Reconnect USB (the PC sees {{device}} unplug and replug).")}</p>
      <div className="dk-ctl" style={{ justifyContent: "flex-start", paddingBottom: 4 }}>
        <BusyButton disabled={!bridge.client || bridge.operation !== null} onClick={bridge.reconnectUsb}>
          {t("actions.reconnect")}
        </BusyButton>
      </div>
    </section>
  );
}
