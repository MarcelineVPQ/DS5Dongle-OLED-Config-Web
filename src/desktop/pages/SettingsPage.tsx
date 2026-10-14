import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FEATURES2, FEATURES3, POWER_FLAGS, supportsFeature2, supportsFeature3 } from "../../protocol/bridgeClient";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import {
  MIC_LEVEL_MAX,
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
import { BusyButton, GripHaptics, InfoTip, Row, Segmented, Slider, Toggle } from "../controls";
import { useFields, type SectionProps } from "./sectionFields";
import Notice from "../Notice";

// The settings rows of the Controller and Pico 2 W pages' sections (their
// accordion: live/PartPanel.tsx, dongle/DonglePage.tsx). Each function is a
// section's body (its rows), the Section around it gives the title. Changes
// apply to the dongle's RAM right away (DesktopApp); "Save to dongle" in the
// bottom bar makes them survive a power cycle. The game page shows the
// profile-able ones with a game profile's draft instead (`fields`, see
// sectionFields.tsx).
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
  // lifetime: OK — cleanup stops a running grip test (unmount, client change, disconnect)
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
          // lifetime: OK — fires once, or cleared by wake() when the test stops
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
          // error: NOT-WORTH — stopping a test the user stopped; it ends by itself within 3 s
          if (stopped) await client.gripTest(side, 0).catch(() => undefined);
        } else {
          // The last pulse ends by the 3 s mark.
          // loop: SERIAL-REQUIRED — timed pulses: each waits its slot on a deadline, one HID session
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
  return hasV13(props.bridge) ? (
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
    <>
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
          {/* loop: HOT-PATH-OK — N = 3 sides; page render */}
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
          <InfoTip text={t("desktop.grips.testHint")} />
        </div>
      )}
      {/* hint: MUST-SHOW — the range's meaning (lower: less delay; higher: steadier) */}
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
    </>
  );
}

export function AutoHapticsSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub } = useFields(props);
  // loop: HOT-PATH-OK — N = 4 options; page render
  const ahModes: ReadonlyArray<{ value: AutoHapticsMode; label: string; title: string }> = (["off", "fallback", "mix", "replace"] as const).map((k, i) => ({
    value: i as AutoHapticsMode,
    label: t(`autoHaptics.modes.${k}.label`),
    title: t(`autoHaptics.modes.${k}.hint`),
  }));
  return (
    <>
      <Segmented
        label={t("autoHaptics.modeLabel")}
        sub={sub("autoHapticsEnable")}
        info={t(`autoHaptics.modes.${["off", "fallback", "mix", "replace"][d.autoHapticsEnable & 3]}.hint`)}
        value={d.autoHapticsEnable}
        options={ahModes}
        onChange={(v) => set("autoHapticsEnable", v)}
      />
      <Slider label={t("autoHaptics.gainLabel")} value={d.autoHapticsGain} min={0} max={200} step={10} unit="%" disabled={d.autoHapticsEnable === 0} onChange={(v) => set("autoHapticsGain", v)} />
      <Segmented
        label={t("autoHaptics.lpLabel")}
        value={d.autoHapticsLowpass}
        disabled={d.autoHapticsEnable === 0}
        /* loop: HOT-PATH-OK — N = 4 options; page render */
        options={[80, 160, 250, 400].map((hz, i) => ({ value: i as AutoHapticsLowpass, label: `${hz} Hz` }))}
        onChange={(v) => set("autoHapticsLowpass", v)}
      />
    </>
  );
}

export function SpeakerSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue, sub, live } = useFields(props);
  const v13 = hasV13(props.bridge);
  // loop: HOT-PATH-OK — N = 4 options; page render
  const outputs: ReadonlyArray<{ value: SpeakerSelect; label: string }> = (["auto", "speaker", "headset", "off"] as const).map((k, i) => ({
    value: i as SpeakerSelect,
    label: t(`desktop.settings.choice.${k}`),
  }));
  return (
    <>
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
          <Toggle label={t("desktop.settings.lockVolume")} sub={sub("lockVolume")} info={t("desktop.settings.lockVolumeSub")} value={d.lockVolume} onChange={(v) => set("lockVolume", v)} />
          {/* Where the PC's audio plays is the dongle's, not a game's (not in profiles). */}
          {live && <Segmented label={t("desktop.settings.audioOutput")} value={d.speakerSelect} options={outputs} onChange={(v) => set("speakerSelect", v)} />}
        </>
      )}
      {!v13 && <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>}
    </>
  );
}

// Protocol 1.16: the controller's own mic level (0 = follow the PC's).
const hasMicLevel = (bridge: UseDs5BridgeResult) => supportsFeature3(bridge.identity, 16, FEATURES3.micLevel);

// The controller's mic level, 1..64 (its VolumeMic), or 0 = whatever the PC's
// mic level is. Live it sits under the Mic Test, so its meter shows the
// change; in a game's profile it is in the Microphone card. Following a PC
// level of 0 (identity [48]) means a silent mic, which is common on Linux:
// the boot-time ALSA restore sets the controller's hardware capture volume and
// PipeWire never changes it (it uses software volume), so live it says so.
export function MicLevelSlider(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, issue, sub, live } = useFields(props);
  if (!hasMicLevel(props.bridge)) return <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>;
  const silent = live && d.btMicEnable && d.micLevel === 0 && props.bridge.identity?.pcMicLevel === 0;
  return (
    <>
      {/* hint: MUST-SHOW — the range: 0 = as set on the PC, 1–64 the controller's own level */}
      <Slider
        label={t("desktop.settings.micLevel")}
        sub={sub("micLevel", t("desktop.settings.micLevelSub"))}
        value={d.micLevel}
        min={0}
        max={MIC_LEVEL_MAX}
        step={1}
        invalid={issue("micLevel")}
        disabled={!d.btMicEnable}
        onChange={(v) => set("micLevel", v)}
      />
      {silent && (
        <Notice role="status" closable>
          {t("desktop.settings.micLevelPcZero")}
        </Notice>
      )}
    </>
  );
}

// Protocol 1.17: the controller's own echo cancellation for its microphone.
const hasEchoCancel = (bridge: UseDs5BridgeResult) => supportsFeature3(bridge.identity, 17, FEATURES3.echoCancel);

// The controller's echo cancellation (on by default): it takes the PC's own
// sound, played on the controller's headset or speaker, back out of what its
// mic hears, so a voice chat or the Mic Test doesn't repeat itself. Off, the
// board leaves it to the game. Live it sits next to Microphone level under the
// Mic Test; in a game's profile, in the Microphone card. Older firmware has no
// switch (MicLevelSlider already says to update).
export function EchoCancelToggle(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub } = useFields(props);
  if (!hasEchoCancel(props.bridge)) return null;
  return (
    <Toggle
      label={t("desktop.settings.echoCancel")}
      sub={sub("micEchoCancel")}
      info={t("desktop.settings.echoCancelSub")}
      value={d.micEchoCancel}
      disabled={!d.btMicEnable}
      onChange={(v) => set("micEchoCancel", v)}
    />
  );
}

export function MicSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set, sub, live } = useFields(props);
  // loop: HOT-PATH-OK — N = 3 options; page render
  const mics: ReadonlyArray<{ value: MicSelect; label: string }> = (["auto", "builtIn", "headset"] as const).map((k, i) => ({
    value: i as MicSelect,
    label: t(`desktop.settings.choice.${k}`),
  }));
  return (
    <>
      <Toggle label={t("haptics.btMicLabel")} sub={sub("btMicEnable")} value={d.btMicEnable} onChange={(v) => set("btMicEnable", v)} />
      {/* Which mic is the dongle's setting, not a game's (not in profiles). */}
      {live && hasV13(props.bridge) && <Segmented label={t("desktop.settings.micInput")} value={d.micSelect} options={mics} disabled={!d.btMicEnable} onChange={(v) => set("micSelect", v)} />}
      {/* Live, the level and the echo cancellation are under the Mic Test (PartPanel). */}
      {!live && <MicLevelSlider {...props} />}
      {!live && <EchoCancelToggle {...props} />}
    </>
  );
}

// A GPIO that shows the controller connection (an LED, a PC's power header).
export function StatusPinSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
  const off = d.statusGpioPin === STATUS_GPIO_OFF;
  return (
    <>
      {hasV13(props.bridge) ? (
        <>
          <Row label={t("desktop.settings.statusPinGpio")}>
            <select className="dk-select" aria-label={t("desktop.settings.statusPinGpio")} value={d.statusGpioPin} onChange={(e) => set("statusGpioPin", Number(e.currentTarget.value))}>
              <option value={STATUS_GPIO_OFF}>{t("desktop.settings.statusPinOff")}</option>
              {/* loop: HOT-PATH-OK — N = 17 GPIO pins; page render */}
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
            info={t("desktop.settings.statusPinHint")}
            onChange={(v) => set("statusGpioMode", v)}
          />
        </>
      ) : (
        <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>
      )}
    </>
  );
}

export function PowerSection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
  return (
    <>
      <Toggle label={t("desktop.settings.idleDisconnect", "Disconnect when idle")} value={!d.disableInactiveDisconnect} onChange={(v) => set("disableInactiveDisconnect", !v)} />
      <Slider label={t("behavior.inactiveTimeLabel")} value={d.inactiveTime} min={5} max={60} step={5} unit="min" disabled={d.disableInactiveDisconnect} onChange={(v) => set("inactiveTime", v)} />
      <Toggle label={t("desktop.settings.picoLed", "Pico status LED")} value={!d.disablePicoLed} onChange={(v) => set("disablePicoLed", !v)} />
    </>
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
    <>
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
            info={t("desktop.settings.psWakesPcSub")}
            value={(bits & POWER_FLAGS.psWakesPc) !== 0}
            disabled={off}
            onChange={(v) => flip(POWER_FLAGS.psWakesPc, v)}
          />
          <p className="dk-hint">{t("desktop.settings.pcSleepHint")}</p>
        </>
      ) : (
        <p className="dk-hint">{t("desktop.settings.needsFirmware")}</p>
      )}
    </>
  );
}

export function DisplaySection(props: SectionProps) {
  const { t } = useTranslation();
  const { d, set } = useFields(props);
  return (
    <>
      <Segmented
        label={t("desktop.settings.brightness", "Brightness")}
        value={d.screenBrightness}
        /* loop: HOT-PATH-OK — N = 4 options; page render */
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
    </>
  );
}

export function UsbSection(props: SectionProps) {
  const { t } = useTranslation();
  const { bridge } = props;
  const { d, set } = useFields(props);
  return (
    <>
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
      {/* hint: MUST-SHOW — a warning: these settings wait for Reconnect USB */}
      <p className="dk-hint">{t("desktop.settings.usbHint", "These take effect after Reconnect USB (the PC sees {{device}} unplug and replug).")}</p>
      <div className="dk-row-btns">
        <BusyButton disabled={!bridge.client || bridge.operation !== null} onClick={bridge.reconnectUsb}>
          {t("actions.reconnect")}
        </BusyButton>
      </div>
    </>
  );
}
