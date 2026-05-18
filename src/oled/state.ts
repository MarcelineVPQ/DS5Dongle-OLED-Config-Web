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
    cpu: { setFreqMhz: 320, realFreqMhz: 320, vcoreV: 1.2, tempC: 42 },
    rssi: -60,
    triggerPreset: 0,
    lightbarMode: 0,
    lightbarRgb: [255, 215, 0],
  };
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

// KEY1 behavior matches firmware's handle_buttons:
// - On Trigger Test (3): cycle trigger preset
// - On Lightbar (2): cycle lightbar mode
// - Everywhere else: step back one screen.
export function key1Action(s: EmulatorState): void {
  if (s.currentScreen === 3) {
    s.triggerPreset = (s.triggerPreset + 1) % TRIGGER_PRESET_NAMES.length;
  } else if (s.currentScreen === 2) {
    s.lightbarMode = (s.lightbarMode + 1) % LIGHTBAR_MODE_NAMES.length;
  } else {
    s.currentScreen = (s.currentScreen - 1 + NUM_SCREENS) % NUM_SCREENS;
  }
}
