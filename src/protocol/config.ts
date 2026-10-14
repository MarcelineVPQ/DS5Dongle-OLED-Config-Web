// Config_body wire layout for DS5Dongle OLED Edition firmware.
// 37 bytes (42 from protocol 1.6, 49 from 1.13, 50 from 1.16, 51 from 1.17), little-endian, packed
// (matches src/config.h in the firmware).
//
//   offset 0   uint8   config_version              (firmware-set; read-only)
//   offset 1   float32 haptics_gain                [1.0, 6.0]
//   offset 5   float32 speaker_volume              dB [-100, +12] (digital gain; > 0 boosts, firmware v0.8+)
//   offset 9   uint8   inactive_time               minutes [5, 60]
//   offset 10  uint8   disable_inactive_disconnect 0 = auto-disconnect on idle, 1 = stay paired forever
//   offset 11  uint8   disable_pico_led            0 = LED on, 1 = LED off
//   offset 12  uint8   polling_rate_mode           0 = 250Hz, 1 = 500Hz, 2 = real-time
//   offset 13  uint8   audio_buffer_length         [16, 128]
//   offset 14  uint8   controller_mode             0 = DS5, 1 = DSE, 2 = Auto
//   offset 15  uint8   current_slot                [0, 3]  (OLED Edition multi-slot pairing)
//   offset 16  uint8   auto_haptics_enable         0=Off 1=Fallback 2=Mix 3=Replace  (OLED Edition)
//   offset 17  uint8   auto_haptics_gain           percent [0, 200]                  (OLED Edition)
//   offset 18  uint8   auto_haptics_lowpass        0=80Hz 1=160Hz 2=250Hz 3=400Hz    (OLED Edition)
//   offset 19  uint8   lightbar_mode               0=LIVE 1-4=FAV 5=BREA 6=RAIN 7=FADE 8=HOST (v0.6.5)
//   offset 20  uint8[4] lb_fav_r                   4 favorite-slot red values        (v0.6.5)
//   offset 24  uint8[4] lb_fav_g                   4 favorite-slot green values      (v0.6.5)
//   offset 28  uint8[4] lb_fav_b                   4 favorite-slot blue values       (v0.6.5)
//   offset 32  uint8   screen_dim_timeout          minutes [0, 250], 0 = disabled    (issue #5)
//   offset 33  uint8   screen_off_timeout          minutes [0, 250], 0 = disabled    (issue #5)
//   offset 34  uint8   bt_mic_enable               0 = off, 1 = on (default)         (BT mic, Phase I)
//   offset 35  uint8   screen_brightness           kBrightLevels index [0, 3]        (issue #9, v0.6.11)
//   offset 36  uint8   controller_wakes_display    0 = OLED sleeps during play, 1 = stays awake (issues #8/#9, v0.6.11)
//   offset 37  uint8   narrator_voice              (protocol 1.3; a settings write never changes it)
//   offset 38  float32 haptics_gain_right          [1.0, 6.0] (protocol 1.6)
//   protocol 1.13 (upstream's settings batch; identity [46] bit 1):
//   offset 42  uint8   trigger_reduce              0 = the game's own, 1..10 weaker adaptive triggers
//   offset 43  uint8   speaker_gain                0 = the game's own, 1..7 the controller amp's pre-gain
//   offset 44  uint8   lock_volume                 1 = games can't change the controller's volume / mute
//   offset 45  uint8   mic_select                  0 auto, 1 built-in, 2 headset
//   offset 46  uint8   speaker_select              0 auto, 1 speaker, 2 headset, 3 off
//   offset 47  uint8   status_gpio_pin             0xFF off, else one of STATUS_GPIO_PINS
//   offset 48  uint8   status_gpio_mode            0 high while connected, 1 200 ms pulse on connect
//   protocol 1.16 (identity [46] bit 4):
//   offset 49  uint8   mic_level                   0 = follow the PC's mic level, 1..64 the controller's VolumeMic
//   protocol 1.17 (identity [46] bit 5):
//   offset 50  uint8   mic_echo_cancel             1 = the controller's echo cancellation on (default), 0 = the game's own
//
// The config GET (0xF7) is capped at 63 bytes: from 1.13 a 63-byte GET still
// answers the 42-byte body with the remap block at 42 (remap.ts), and a
// shorter one the whole body, so readConfig asks for CONFIG_BODY_SIZE_V17
// (older firmware answers its own, shorter body).
//
// NOTE: lightbar_mode / lb_fav_* are edited on the OLED and in the desktop app's
// lightbar panel (the web tool doesn't show them), and MUST always be encoded:
// the firmware copies sizeof(Config_body) bytes, so a short body would zero them.
import { toUint8Array } from "./bytes";

export const CONFIG_BODY_SIZE = 37;
// Protocol 1.6 adds the right grip's haptics strength after the narrator byte
// (37, which a settings write never changes): a float at 38, 42 bytes in all.
// Only sent to 1.6+ firmware; older firmware would take byte 37 as the narrator.
export const CONFIG_BODY_SIZE_SPLIT = 42;
const RIGHT_GAIN_AT = 38;
// Protocol 1.13 appends seven bytes (49 in all). Only sent to 1.13+ firmware
// (older firmware would ignore them anyway: it copies at most its own size).
export const CONFIG_BODY_SIZE_V13 = 49;
const TAIL_AT = CONFIG_BODY_SIZE_SPLIT;
// Protocol 1.16 appends the mic level (50 in all). Only sent to 1.16+
// firmware: a 49-byte write leaves it as it is on the board.
export const CONFIG_BODY_SIZE_V16 = 50;
const MIC_LEVEL_AT = CONFIG_BODY_SIZE_V13;
// The controller's mic level (SetStateData VolumeMic) tops out at 64; 0 =
// follow the PC's mic level (the firmware's default).
export const MIC_LEVEL_MAX = 64;
// Protocol 1.17 appends the controller's echo cancellation (51 in all). Only
// sent to 1.17+ firmware: a 50-byte write leaves it as it is on the board.
export const CONFIG_BODY_SIZE_V17 = 51;
const ECHO_CANCEL_AT = CONFIG_BODY_SIZE_V16;
// The status pin: the GPIOs the firmware accepts (status_gpio.h), the ones
// nothing else on the dongle uses (not the UART, the OLED add-on or the radio).
export const STATUS_GPIO_OFF = 0xff;
export const STATUS_GPIO_PINS = [2, 3, 4, 5, 6, 7, 13, 14, 16, 18, 19, 20, 21, 22, 26, 27, 28] as const;
// Pre-v0.6.5 firmware returns a 19-byte body (no lightbar / screen-timeout
// fields). We still accept that and default the missing tail, so the updated
// UI can read older firmware without erroring.
export const CONFIG_BODY_MIN_SIZE = 19;
export const FEATURE_REPORT_PAYLOAD_SIZE = 63;

export type PollingRateMode = 0 | 1 | 2;
export type ControllerMode = 0 | 1 | 2;
export type SlotIndex = 0 | 1 | 2 | 3;
export type AutoHapticsMode = 0 | 1 | 2 | 3;
export type AutoHapticsLowpass = 0 | 1 | 2 | 3;
export type MicSelect = 0 | 1 | 2; // auto, built-in, headset
export type SpeakerSelect = 0 | 1 | 2 | 3; // auto, speaker, headset, off
export type StatusGpioMode = 0 | 1; // high while connected, pulse on connect

export interface ConfigBody {
  configVersion: number;
  hapticsGain: number; // left grip (both, on firmware before 1.6)
  hapticsGainRight: number; // right grip (protocol 1.6; else = hapticsGain)
  speakerVolume: number;
  inactiveTime: number;
  disableInactiveDisconnect: boolean;
  disablePicoLed: boolean;
  pollingRateMode: PollingRateMode;
  audioBufferLength: number;
  controllerMode: ControllerMode;
  currentSlot: SlotIndex;
  autoHapticsEnable: AutoHapticsMode;
  autoHapticsGain: number;
  autoHapticsLowpass: AutoHapticsLowpass;
  // OLED-managed lightbar state — round-tripped here, not edited in this UI.
  lightbarMode: number; // 0..8 (see offset map)
  lbFavR: number[]; // length 4, each 0..255
  lbFavG: number[]; // length 4, each 0..255
  lbFavB: number[]; // length 4, each 0..255
  // Screen idle-ladder thresholds (issue #5), minutes, 0 = tier disabled.
  screenDimTimeout: number; // [0, 250]
  screenOffTimeout: number; // [0, 250]
  btMicEnable: boolean; // DualSense mic over Bluetooth (default on)
  // OLED-managed, round-tripped here (not edited in this UI), like the lightbar
  // fields. Decoding/encoding them keeps the remap block aligned and stops a
  // config save from zeroing them. Issues #8 / #9 (v0.6.11).
  screenBrightness: number; // kBrightLevels index [0, 3]
  controllerWakesDisplay: boolean; // false = OLED sleeps during play
  // Protocol 1.13 (defaults on older firmware, and not sent to it).
  triggerReduce: number; // 0 = the game's own, 1..10 weaker
  speakerGain: number; // 0 = the game's own, 1..7
  lockVolume: boolean;
  micSelect: MicSelect;
  speakerSelect: SpeakerSelect;
  statusGpioPin: number; // STATUS_GPIO_OFF or one of STATUS_GPIO_PINS
  statusGpioMode: StatusGpioMode;
  // Protocol 1.16 (0 on older firmware, and not sent to it).
  micLevel: number; // 0 = the PC's level, 1..MIC_LEVEL_MAX the controller's own
  // Protocol 1.17 (on with older firmware, which has no switch, and not sent to it).
  micEchoCancel: boolean; // the controller's own echo cancellation for its mic
}

export interface ConfigValidationIssue {
  field: keyof ConfigBody;
  message: string;
}

export const DEFAULT_CONFIG: ConfigBody = {
  configVersion: 1,
  hapticsGain: 1.0,
  hapticsGainRight: 1.0,
  speakerVolume: 0,
  inactiveTime: 30,
  disableInactiveDisconnect: false,
  disablePicoLed: false,
  pollingRateMode: 1, // 500 Hz (firmware default for a fresh config since protocol 1.13)
  audioBufferLength: 64,
  controllerMode: 2,
  currentSlot: 0,
  autoHapticsEnable: 0, // Off (firmware default since v0.7.0)
  autoHapticsGain: 100,
  autoHapticsLowpass: 1, // 160 Hz
  lightbarMode: 8, // HOST passthrough (firmware default)
  lbFavR: [255, 0, 0, 255],
  lbFavG: [0, 255, 0, 255],
  lbFavB: [0, 0, 255, 255],
  screenDimTimeout: 2, // minutes (firmware default)
  screenOffTimeout: 15, // minutes (firmware default)
  btMicEnable: true, // mic over BT on by default (firmware default)
  screenBrightness: 0, // full brightness (firmware default)
  controllerWakesDisplay: true, // controller activity wakes OLED (firmware default)
  triggerReduce: 0,
  speakerGain: 0,
  lockVolume: false,
  micSelect: 0,
  speakerSelect: 0,
  statusGpioPin: STATUS_GPIO_OFF,
  statusGpioMode: 0,
  micLevel: 0,
  micEchoCancel: true,
};

export const POLLING_RATE_OPTIONS: Array<{ value: PollingRateMode; label: string }> = [
  { value: 0, label: "250 Hz" },
  { value: 1, label: "500 Hz" },
  { value: 2, label: "Real-time (1 kHz)" },
];

export const CONTROLLER_MODE_OPTIONS: Array<{ value: ControllerMode; label: string }> = [
  { value: 0, label: "DS5" },
  { value: 1, label: "DSE (Edge)" },
  { value: 2, label: "Auto (detect)" },
];

export const AUTO_HAPTICS_MODE_OPTIONS: Array<{
  value: AutoHapticsMode;
  label: string;
  hint: string;
}> = [
  { value: 0, label: "Off", hint: "Default. Native haptics only (channels 2 + 3 of the USB audio stream)." },
  {
    value: 1,
    label: "Fallback",
    hint: "Derived haptic fires only when the game has been silent on the native haptic path for ~1 s. Preserves native HD haptics (Spider-Man Remastered, etc.) while filling in for games that send no haptic data (Ghost of Tsushima on Linux, etc.).",
  },
  { value: 2, label: "Mix", hint: "Always add derived haptic on top of native, soft-clipped together. Best for adding more body to games with weak native haptics." },
  { value: 3, label: "Replace", hint: "Always use derived; discard native completely. Uniform feel across all games regardless of what they send." },
];

// Lightbar mode names — short firmware UI codes (mirror lb_mode_tag in
// src/oled.cpp), shown verbatim in the mode dropdown; not translated.
export const LIGHTBAR_MODE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "LIVE (tilt)" },
  { value: 1, label: "FAV0" },
  { value: 2, label: "FAV1" },
  { value: 3, label: "FAV2" },
  { value: 4, label: "FAV3" },
  { value: 5, label: "Breathing" },
  { value: 6, label: "Rainbow" },
  { value: 7, label: "Fade" },
  { value: 8, label: "Host (game)" },
];

export const AUTO_HAPTICS_LOWPASS_OPTIONS: Array<{ value: AutoHapticsLowpass; label: string }> = [
  { value: 0, label: "80 Hz  (sub-bass)" },
  { value: 1, label: "160 Hz (bass / default)" },
  { value: 2, label: "250 Hz (punchy mid-bass)" },
  { value: 3, label: "400 Hz (presence)" },
];

export function decodeConfigBody(source: ArrayBuffer | DataView | Uint8Array): ConfigBody {
  const bytes = toUint8Array(source);
  // WebHID feature-report reads may or may not include the leading report-ID
  // byte depending on browser/driver. Try both offsets and pick whichever
  // passes validation.
  const candidates = bytes.byteLength >= CONFIG_BODY_MIN_SIZE + 1 ? [0, 1] : [0];
  const parsed = candidates.map((offset) => decodeAt(bytes, offset)).filter(Boolean) as ConfigBody[];
  const valid = parsed.find((config) => validateConfig(config).length === 0);
  if (valid) return valid;
  if (parsed[0]) {
    const issues = validateConfig(parsed[0])
      .map((i) => i.message)
      .join("; ");
    throw new Error(`Device returned invalid config: ${issues}`);
  }
  throw new Error(`Device returned ${bytes.byteLength} bytes, expected at least ${CONFIG_BODY_MIN_SIZE}`);
}

// split: protocol 1.6+ (the right grip); tail: protocol 1.13+ (implies split);
// micLevel: protocol 1.16+ (implies tail); echoCancel: protocol 1.17+ (implies micLevel).
export function encodeConfigBody(config: ConfigBody, split = false, tail = false, micLevel = false, echoCancel = false): Uint8Array<ArrayBuffer> {
  const issues = validateConfig(config);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join("; "));
  }
  micLevel ||= echoCancel;
  tail ||= micLevel;
  split ||= tail;
  const bytes = new Uint8Array(new ArrayBuffer(echoCancel ? CONFIG_BODY_SIZE_V17 : micLevel ? CONFIG_BODY_SIZE_V16 : tail ? CONFIG_BODY_SIZE_V13 : split ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE));
  const view = new DataView(bytes.buffer);
  view.setUint8(0, config.configVersion & 0xff);
  view.setFloat32(1, config.hapticsGain, true);
  view.setFloat32(5, config.speakerVolume, true);
  view.setUint8(9, config.inactiveTime & 0xff);
  view.setUint8(10, config.disableInactiveDisconnect ? 1 : 0);
  view.setUint8(11, config.disablePicoLed ? 1 : 0);
  view.setUint8(12, config.pollingRateMode);
  view.setUint8(13, config.audioBufferLength & 0xff);
  view.setUint8(14, config.controllerMode);
  view.setUint8(15, config.currentSlot);
  view.setUint8(16, config.autoHapticsEnable);
  view.setUint8(17, config.autoHapticsGain & 0xff);
  view.setUint8(18, config.autoHapticsLowpass);
  view.setUint8(19, config.lightbarMode & 0xff);
  for (let i = 0; i < 4; i++) view.setUint8(20 + i, config.lbFavR[i] & 0xff);
  for (let i = 0; i < 4; i++) view.setUint8(24 + i, config.lbFavG[i] & 0xff);
  for (let i = 0; i < 4; i++) view.setUint8(28 + i, config.lbFavB[i] & 0xff);
  view.setUint8(32, config.screenDimTimeout & 0xff);
  view.setUint8(33, config.screenOffTimeout & 0xff);
  view.setUint8(34, config.btMicEnable ? 1 : 0);
  view.setUint8(35, config.screenBrightness & 0xff);
  view.setUint8(36, config.controllerWakesDisplay ? 1 : 0);
  if (split) {
    view.setUint8(37, 0xff); // the narrator: ignored by a settings write
    view.setFloat32(RIGHT_GAIN_AT, config.hapticsGainRight, true);
  }
  if (tail) {
    view.setUint8(TAIL_AT, config.triggerReduce);
    view.setUint8(TAIL_AT + 1, config.speakerGain);
    view.setUint8(TAIL_AT + 2, config.lockVolume ? 1 : 0);
    view.setUint8(TAIL_AT + 3, config.micSelect);
    view.setUint8(TAIL_AT + 4, config.speakerSelect);
    view.setUint8(TAIL_AT + 5, config.statusGpioPin);
    view.setUint8(TAIL_AT + 6, config.statusGpioMode);
  }
  if (micLevel) view.setUint8(MIC_LEVEL_AT, config.micLevel);
  if (echoCancel) view.setUint8(ECHO_CANCEL_AT, config.micEchoCancel ? 1 : 0);
  return bytes;
}

export function validateConfig(config: ConfigBody): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  if (!Number.isFinite(config.hapticsGain) || config.hapticsGain < 1 || config.hapticsGain > 6) {
    issues.push({ field: "hapticsGain", message: "Haptics gain must be between 1.0 and 6.0" });
  }
  if (!Number.isFinite(config.hapticsGainRight) || config.hapticsGainRight < 1 || config.hapticsGainRight > 6) {
    issues.push({ field: "hapticsGainRight", message: "Haptics gain must be between 1.0 and 6.0" });
  }
  if (!Number.isFinite(config.speakerVolume) || config.speakerVolume < -100 || config.speakerVolume > 12) {
    issues.push({ field: "speakerVolume", message: "Speaker volume must be between -100 dB and +12 dB" });
  }
  if (!Number.isInteger(config.inactiveTime) || config.inactiveTime < 5 || config.inactiveTime > 60) {
    issues.push({ field: "inactiveTime", message: "Inactive time must be between 5 and 60 minutes" });
  }
  if (!Number.isInteger(config.pollingRateMode) || config.pollingRateMode < 0 || config.pollingRateMode > 2) {
    issues.push({ field: "pollingRateMode", message: "Polling rate mode must be 0, 1, or 2" });
  }
  if (!Number.isInteger(config.audioBufferLength) || config.audioBufferLength < 16 || config.audioBufferLength > 128) {
    issues.push({ field: "audioBufferLength", message: "Audio buffer length must be between 16 and 128" });
  }
  if (!Number.isInteger(config.controllerMode) || config.controllerMode < 0 || config.controllerMode > 2) {
    issues.push({ field: "controllerMode", message: "Controller mode must be 0 (DS5), 1 (DSE), or 2 (Auto)" });
  }
  if (!Number.isInteger(config.currentSlot) || config.currentSlot < 0 || config.currentSlot > 3) {
    issues.push({ field: "currentSlot", message: "Current slot must be 0-3" });
  }
  if (!Number.isInteger(config.autoHapticsEnable) || config.autoHapticsEnable < 0 || config.autoHapticsEnable > 3) {
    issues.push({ field: "autoHapticsEnable", message: "Auto Haptics mode must be 0 (Off), 1 (Fallback), 2 (Mix), or 3 (Replace)" });
  }
  if (!Number.isInteger(config.autoHapticsGain) || config.autoHapticsGain < 0 || config.autoHapticsGain > 200) {
    issues.push({ field: "autoHapticsGain", message: "Auto Haptics gain must be between 0 % and 200 %" });
  }
  if (!Number.isInteger(config.autoHapticsLowpass) || config.autoHapticsLowpass < 0 || config.autoHapticsLowpass > 3) {
    issues.push({ field: "autoHapticsLowpass", message: "Auto Haptics LP must be 0-3 (80/160/250/400 Hz)" });
  }
  if (!Number.isInteger(config.screenDimTimeout) || config.screenDimTimeout < 0 || config.screenDimTimeout > 250) {
    issues.push({ field: "screenDimTimeout", message: "Screen dim timeout must be 0-250 minutes (0 = disabled)" });
  }
  if (!Number.isInteger(config.screenOffTimeout) || config.screenOffTimeout < 0 || config.screenOffTimeout > 250) {
    issues.push({ field: "screenOffTimeout", message: "Screen off timeout must be 0-250 minutes (0 = disabled)" });
  }
  if (!Number.isInteger(config.triggerReduce) || config.triggerReduce < 0 || config.triggerReduce > 10) {
    issues.push({ field: "triggerReduce", message: "Trigger effect reduction must be 0-10" });
  }
  if (!Number.isInteger(config.speakerGain) || config.speakerGain < 0 || config.speakerGain > 7) {
    issues.push({ field: "speakerGain", message: "Speaker boost must be 0-7" });
  }
  if (!Number.isInteger(config.micSelect) || config.micSelect < 0 || config.micSelect > 2) {
    issues.push({ field: "micSelect", message: "Microphone must be 0 (auto), 1 (built-in) or 2 (headset)" });
  }
  if (!Number.isInteger(config.speakerSelect) || config.speakerSelect < 0 || config.speakerSelect > 3) {
    issues.push({ field: "speakerSelect", message: "Audio output must be 0-3 (auto, speaker, headset, off)" });
  }
  if (config.statusGpioPin !== STATUS_GPIO_OFF && !(STATUS_GPIO_PINS as readonly number[]).includes(config.statusGpioPin)) {
    issues.push({ field: "statusGpioPin", message: "Status pin must be off or a free GPIO" });
  }
  if (!Number.isInteger(config.micLevel) || config.micLevel < 0 || config.micLevel > MIC_LEVEL_MAX) {
    issues.push({ field: "micLevel", message: `Mic level must be 0 (follow the PC) to ${MIC_LEVEL_MAX}` });
  }
  if (config.statusGpioMode !== 0 && config.statusGpioMode !== 1) {
    issues.push({ field: "statusGpioMode", message: "Status pin mode must be 0 or 1" });
  }
  // lightbar_mode / lb_fav_* come from fixed choices (mode list, color pickers)
  // and the firmware clamps them; normalizeConfig clamps them defensively too.
  return issues;
}

export function normalizeConfig(config: ConfigBody): ConfigBody {
  return {
    configVersion: clampInteger(config.configVersion, 0, 255),
    hapticsGain: roundToStep(config.hapticsGain, 0.01),
    hapticsGainRight: roundToStep(config.hapticsGainRight, 0.01),
    speakerVolume: roundToStep(config.speakerVolume, 1),
    inactiveTime: clampInteger(config.inactiveTime, 5, 60),
    disableInactiveDisconnect: Boolean(config.disableInactiveDisconnect),
    disablePicoLed: Boolean(config.disablePicoLed),
    pollingRateMode: clampInteger(config.pollingRateMode, 0, 2) as PollingRateMode,
    audioBufferLength: clampInteger(config.audioBufferLength, 16, 128),
    controllerMode: clampInteger(config.controllerMode, 0, 2) as ControllerMode,
    currentSlot: clampInteger(config.currentSlot, 0, 3) as SlotIndex,
    autoHapticsEnable: clampInteger(config.autoHapticsEnable, 0, 3) as AutoHapticsMode,
    autoHapticsGain: clampInteger(config.autoHapticsGain, 0, 200),
    autoHapticsLowpass: clampInteger(config.autoHapticsLowpass, 0, 3) as AutoHapticsLowpass,
    lightbarMode: clampInteger(config.lightbarMode, 0, 8),
    lbFavR: config.lbFavR.map((v) => clampInteger(v, 0, 255)),
    lbFavG: config.lbFavG.map((v) => clampInteger(v, 0, 255)),
    lbFavB: config.lbFavB.map((v) => clampInteger(v, 0, 255)),
    screenDimTimeout: clampInteger(config.screenDimTimeout, 0, 250),
    screenOffTimeout: clampInteger(config.screenOffTimeout, 0, 250),
    btMicEnable: Boolean(config.btMicEnable),
    screenBrightness: clampInteger(config.screenBrightness, 0, 3),
    controllerWakesDisplay: Boolean(config.controllerWakesDisplay),
    triggerReduce: clampInteger(config.triggerReduce, 0, 10),
    speakerGain: clampInteger(config.speakerGain, 0, 7),
    lockVolume: Boolean(config.lockVolume),
    micSelect: clampInteger(config.micSelect, 0, 2) as MicSelect,
    speakerSelect: clampInteger(config.speakerSelect, 0, 3) as SpeakerSelect,
    statusGpioPin: (STATUS_GPIO_PINS as readonly number[]).includes(config.statusGpioPin) ? config.statusGpioPin : STATUS_GPIO_OFF,
    statusGpioMode: config.statusGpioMode === 1 ? 1 : 0,
    micLevel: clampInteger(config.micLevel, 0, MIC_LEVEL_MAX),
    micEchoCancel: Boolean(config.micEchoCancel),
  };
}

export function configsEqual(left: ConfigBody | null, right: ConfigBody | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.configVersion === right.configVersion &&
    Math.abs(left.hapticsGain - right.hapticsGain) < 0.001 &&
    Math.abs(left.hapticsGainRight - right.hapticsGainRight) < 0.001 &&
    Math.abs(left.speakerVolume - right.speakerVolume) < 0.5 &&
    left.inactiveTime === right.inactiveTime &&
    left.disableInactiveDisconnect === right.disableInactiveDisconnect &&
    left.disablePicoLed === right.disablePicoLed &&
    left.pollingRateMode === right.pollingRateMode &&
    left.audioBufferLength === right.audioBufferLength &&
    left.controllerMode === right.controllerMode &&
    left.currentSlot === right.currentSlot &&
    left.autoHapticsEnable === right.autoHapticsEnable &&
    left.autoHapticsGain === right.autoHapticsGain &&
    left.autoHapticsLowpass === right.autoHapticsLowpass &&
    left.lightbarMode === right.lightbarMode &&
    arraysEqual(left.lbFavR, right.lbFavR) &&
    arraysEqual(left.lbFavG, right.lbFavG) &&
    arraysEqual(left.lbFavB, right.lbFavB) &&
    left.screenDimTimeout === right.screenDimTimeout &&
    left.screenOffTimeout === right.screenOffTimeout &&
    left.btMicEnable === right.btMicEnable &&
    left.screenBrightness === right.screenBrightness &&
    left.controllerWakesDisplay === right.controllerWakesDisplay &&
    left.triggerReduce === right.triggerReduce &&
    left.speakerGain === right.speakerGain &&
    left.lockVolume === right.lockVolume &&
    left.micSelect === right.micSelect &&
    left.speakerSelect === right.speakerSelect &&
    left.statusGpioPin === right.statusGpioPin &&
    left.statusGpioMode === right.statusGpioMode &&
    left.micLevel === right.micLevel &&
    left.micEchoCancel === right.micEchoCancel
  );
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function fieldIssue(issues: ConfigValidationIssue[], field: keyof ConfigBody): ConfigValidationIssue | undefined {
  return issues.find((issue) => issue.field === field);
}

function decodeAt(bytes: Uint8Array, offset: number): ConfigBody | null {
  const avail = bytes.byteLength - offset;
  if (avail < CONFIG_BODY_MIN_SIZE) return null;
  // A 63-byte read of 1.13+ firmware has the remap block ('RM') at 42, not
  // the 1.13 fields.
  const remapAt42 = avail > TAIL_AT + 1 && bytes[offset + TAIL_AT] === 0x52 && bytes[offset + TAIL_AT + 1] === 0x4d;
  const len = Math.min(avail, remapAt42 ? CONFIG_BODY_SIZE_SPLIT : CONFIG_BODY_SIZE_V17);
  const tail = len >= CONFIG_BODY_SIZE_V13;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, len);
  // Read tail fields (offset >= 19) only when the firmware actually sent them;
  // older firmware stops at offset 18, so default the rest.
  const u8 = (o: number, fallback: number) => (o < len ? view.getUint8(o) : fallback);
  return {
    configVersion: view.getUint8(0),
    hapticsGain: view.getFloat32(1, true),
    hapticsGainRight: len >= CONFIG_BODY_SIZE_SPLIT ? view.getFloat32(RIGHT_GAIN_AT, true) : view.getFloat32(1, true),
    speakerVolume: view.getFloat32(5, true),
    inactiveTime: view.getUint8(9),
    disableInactiveDisconnect: view.getUint8(10) === 1,
    disablePicoLed: view.getUint8(11) === 1,
    pollingRateMode: view.getUint8(12) as PollingRateMode,
    audioBufferLength: view.getUint8(13),
    controllerMode: view.getUint8(14) as ControllerMode,
    currentSlot: view.getUint8(15) as SlotIndex,
    autoHapticsEnable: view.getUint8(16) as AutoHapticsMode,
    autoHapticsGain: view.getUint8(17),
    autoHapticsLowpass: view.getUint8(18) as AutoHapticsLowpass,
    lightbarMode: u8(19, DEFAULT_CONFIG.lightbarMode),
    lbFavR: [0, 1, 2, 3].map((i) => u8(20 + i, DEFAULT_CONFIG.lbFavR[i])),
    lbFavG: [0, 1, 2, 3].map((i) => u8(24 + i, DEFAULT_CONFIG.lbFavG[i])),
    lbFavB: [0, 1, 2, 3].map((i) => u8(28 + i, DEFAULT_CONFIG.lbFavB[i])),
    screenDimTimeout: u8(32, DEFAULT_CONFIG.screenDimTimeout),
    screenOffTimeout: u8(33, DEFAULT_CONFIG.screenOffTimeout),
    btMicEnable: u8(34, DEFAULT_CONFIG.btMicEnable ? 1 : 0) === 1,
    screenBrightness: u8(35, DEFAULT_CONFIG.screenBrightness),
    controllerWakesDisplay: u8(36, DEFAULT_CONFIG.controllerWakesDisplay ? 1 : 0) === 1,
    triggerReduce: tail ? view.getUint8(TAIL_AT) : DEFAULT_CONFIG.triggerReduce,
    speakerGain: tail ? view.getUint8(TAIL_AT + 1) : DEFAULT_CONFIG.speakerGain,
    lockVolume: tail ? view.getUint8(TAIL_AT + 2) === 1 : DEFAULT_CONFIG.lockVolume,
    micSelect: (tail ? view.getUint8(TAIL_AT + 3) : DEFAULT_CONFIG.micSelect) as MicSelect,
    speakerSelect: (tail ? view.getUint8(TAIL_AT + 4) : DEFAULT_CONFIG.speakerSelect) as SpeakerSelect,
    statusGpioPin: tail ? view.getUint8(TAIL_AT + 5) : DEFAULT_CONFIG.statusGpioPin,
    statusGpioMode: (tail ? view.getUint8(TAIL_AT + 6) : DEFAULT_CONFIG.statusGpioMode) as StatusGpioMode,
    micLevel: len >= CONFIG_BODY_SIZE_V16 ? view.getUint8(MIC_LEVEL_AT) : DEFAULT_CONFIG.micLevel,
    micEchoCancel: len >= CONFIG_BODY_SIZE_V17 ? view.getUint8(ECHO_CANCEL_AT) !== 0 : DEFAULT_CONFIG.micEchoCancel,
  };
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
