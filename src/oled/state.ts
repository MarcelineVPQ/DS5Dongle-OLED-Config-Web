// Emulator state — what each screen needs to render, plus the "current
// screen index" and KEY1-contextual selections (trigger preset, lightbar
// mode) that the physical firmware tracks too. Pure data, no React.

import { ConfigBody, DEFAULT_CONFIG } from "../protocol/config";
import { InputReport, emptyInputReport } from "./inputReport";

export const SCREEN_NAMES = [
  "Status",        // 0
  "Slots",         // 1
  "Lightbar",      // 2
  "Trigger Test",  // 3
  "Gyro Tilt",     // 4
  "Touchpad",      // 5
  "Diagnostics",   // 6
  "CPU/Clock",     // 7
  "RSSI",          // 8
  "VU Meters",     // 9
  "Settings",      // 10
] as const;
export const NUM_SCREENS = SCREEN_NAMES.length;

export const TRIGGER_PRESET_NAMES = [
  "Off", "Feedback", "Weapon", "Vibration", "Bow", "Galloping", "Machine Gun",
] as const;

export const LIGHTBAR_MODE_NAMES = [
  "LIVE", "FAV0", "FAV1", "FAV2", "FAV3", "Breathing", "Rainbow", "Fade",
] as const;

export interface SlotsSnapshot {
  addrs: number[][];      // 4 × [6 bytes]
  occupied: boolean[];    // 4
}

export interface DiagSnapshot {
  uptimeSeconds: number;
  usbFrames: number;
  btPackets: number;
  peakSpeaker: number;    // 0..255, decays on read
  peakHaptic:  number;
  hciErrors: number;
  prevUsbFrames?: number;
  prevBtPackets?: number;
  prevSampleMs?: number;
  usbRate?: number;       // computed frames/s
  btRate?: number;        // computed packets/s
}

// Mirrors the firmware CPU/Clock screen layout. Always representative mock
// values (mockCpu) — even when connected. The device exposes this on HID
// report 0xfc, but it is not readable over WebHID (declaring the report
// breaks DualSense enumeration on Windows; see ds5BridgeHid.ts / CHANGELOG).
export interface CpuSnapshot {
  setFreqMhz: number;   // configured target (SYS_CLOCK_KHZ / 1000)
  realFreqMhz: number;  // clk_sys measured by the on-chip frequency counter
  vcoreV: number;       // core voltage read back from the regulator
  tempC: number;        // RP2350 on-die temperature sensor
}

// Charge-ETA tracker — mirrors sample_charge_eta() in src/oled.cpp. The DS5
// only reports battery in 10% steps, so we time how long each step takes while
// charging and extrapolate, with a Li-ion taper weighting. Only meaningful
// while the preview is open and a controller is charging; like the firmware it
// shows "~--m" until a full 10% step has elapsed (~15-20 min).
export interface ChargeEtaState {
  charging: boolean;        // batteryState === 1 → render the token
  valid: boolean;           // a full step has been timed → minutes is real
  minutes: number;          // estimated minutes to 100%
  // internals (mirror the firmware's function-static state):
  ring: number[];           // recent bulk-equivalent step durations (ms)
  curStep: number;          // last observed 10% step, -1 = uninitialized
  stepStartMs: number;
  wasCharging: boolean;
  firstStepPending: boolean; // discard the partial step in progress at plug-in
}

export interface EmulatorState {
  currentScreen: number;
  isDemoMode: boolean;
  isConnected: boolean;
  bdAddr: string;
  config: ConfigBody;
  input: InputReport;
  slots: SlotsSnapshot;
  diag: DiagSnapshot;
  cpu: CpuSnapshot;
  rssi: number;
  triggerPreset: number;   // 0..6
  lightbarMode: number;    // 0..7 (LIVE / FAV0..3 / effects)
  lightbarRgb: [number, number, number];
  settingsSel: number;     // 0..4 — selected row on the Settings screen
  chargeEta: ChargeEtaState;
  // Firmware version label rendered on the Status screen. Pulled from
  // CI-bundled public/firmware-latest.json at runtime so a release on
  // the firmware repo automatically updates the web preview without a
  // matching web-repo edit. Defaults to "dev" if the JSON isn't loaded
  // yet (matches the firmware-side default when built without
  // -DVERSION).
  firmwareVersionLabel: string;
}

export function newEmulatorState(): EmulatorState {
  return {
    currentScreen: 0,
    isDemoMode: true,
    isConnected: false,
    bdAddr: "14:3A:9A:FF:D9:F9",
    config: { ...DEFAULT_CONFIG },
    input: emptyInputReport(),
    slots: {
      addrs: [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
      occupied: [false, false, false, false],
    },
    diag: {
      uptimeSeconds: 0, usbFrames: 0, btPackets: 0,
      peakSpeaker: 0, peakHaptic: 0, hciErrors: 0,
    },
    cpu: { setFreqMhz: 320, realFreqMhz: 320, vcoreV: 1.2, tempC: 33.6 },
    rssi: -60,
    triggerPreset: 0,
    lightbarMode: 0,
    lightbarRgb: [255, 215, 0],
    settingsSel: 0,
    chargeEta: {
      charging: false, valid: false, minutes: 0,
      ring: [], curStep: -1, stepStartMs: 0,
      wasCharging: false, firstStepPending: false,
    },
    firmwareVersionLabel: "dev",
  };
}

// Relative time the step ending at `toLevel` (10% units, 1..10) takes vs a bulk
// step — Li-ion CV taper. Mirrors charge_step_weight() in src/oled.cpp.
function chargeStepWeight(toLevel: number): number {
  if (toLevel >= 10) return 2.2; // 90→100%
  if (toLevel === 9) return 1.5; // 80→90%
  return 1.0;                    // bulk constant-current region
}

// Port of sample_charge_eta() (src/oled.cpp), milliseconds instead of µs.
// Call once per render tick; tracks 10% step transitions while charging and
// extrapolates remaining time with the taper weighting above.
export function sampleChargeEta(s: EmulatorState, nowMs: number): void {
  const e = s.chargeEta;
  const RING = 3;
  const step = Math.min(10, s.input.batteryRaw & 0x0f);
  const charging = s.input.batteryState === 1;

  if (!charging) {
    e.charging = false; e.valid = false; e.minutes = 0;
    e.ring = []; e.curStep = -1; e.wasCharging = false; e.firstStepPending = false;
    return;
  }

  if (!e.wasCharging) {
    // Just started charging: begin timing here; the in-progress step is partial.
    e.curStep = step; e.stepStartMs = nowMs; e.ring = [];
    e.firstStepPending = true; e.wasCharging = true;
  } else if (step === e.curStep + 1) {
    const dur = nowMs - e.stepStartMs;
    if (e.firstStepPending) {
      e.firstStepPending = false; // discard the partial plug-in step
    } else {
      e.ring.push(dur / chargeStepWeight(step));
      if (e.ring.length > RING) e.ring.shift();
    }
    e.curStep = step; e.stepStartMs = nowMs;
  } else if (step !== e.curStep) {
    // Multi-step jump or a small dip — resync without polluting the ring.
    e.curStep = step; e.stepStartMs = nowMs; e.firstStepPending = false;
  }

  e.charging = true;
  if (e.ring.length > 0 && e.curStep < 10) {
    const bulk = e.ring.reduce((a, b) => a + b, 0) / e.ring.length;
    let remMs = 0;
    for (let L = e.curStep + 1; L <= 10; L++) remMs += bulk * chargeStepWeight(L);
    e.minutes = Math.min(999, Math.max(0, Math.round(remMs / 60000)));
    e.valid = true;
  } else {
    e.valid = e.curStep >= 10;
    e.minutes = 0;
  }
}

export function formatBdAddr(bytes: number[]): string {
  return bytes
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}

// Cycle to the next screen with wrap.
export function nextScreen(s: EmulatorState): void {
  s.currentScreen = (s.currentScreen + 1) % NUM_SCREENS;
}

// KEY1 = "previous screen" on every screen. The old screen-2 / screen-3
// cycle overloads moved to controller-button rising-edge handlers
// (Triangle on Trigger Test, R1 on Lightbar) — see OledEmulator.tsx.
// Mirrors the firmware refactor in src/oled.cpp.
export function key1Action(s: EmulatorState): void {
  s.currentScreen = (s.currentScreen - 1 + NUM_SCREENS) % NUM_SCREENS;
}
