// Demo-mode data generators. Produce believable input report + feature
// report values when no controller is connected, so the emulator screens
// all show something interesting for the Discord-share use case.

import { InputReport } from "./inputReport";

export interface MockState {
  startMs: number;
}

export function newMockState(): MockState {
  return { startMs: performance.now() };
}

// Animate sticks doing slow lazy circles, gyro tilting back and forth,
// touchpad showing a slowly-moving finger, triggers pulsing.
export function mockInputReport(state: MockState): InputReport {
  const t = (performance.now() - state.startMs) / 1000;
  const stick = (phase: number) => ({
    x: Math.max(0, Math.min(255, Math.round(128 + 60 * Math.sin(t * 0.7 + phase)))),
    y: Math.max(0, Math.min(255, Math.round(128 + 60 * Math.cos(t * 0.7 + phase)))),
  });
  const triggerL = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t * 0.9))));
  const triggerR = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.cos(t * 1.1))));
  const finger1Touching = (Math.floor(t / 2) % 2) === 0;
  return {
    leftStick: stick(0),
    rightStick: stick(Math.PI),
    triggerLeft: triggerL,
    triggerRight: triggerR,
    dpad: 8,
    square: false, cross: false, circle: false, triangle: false,
    l1: false, r1: false, l2: triggerL > 128, r2: triggerR > 128,
    create: false, options: false, l3: false, r3: false,
    home: false, pad: false, mute: false,
    gyroX: Math.round(800 * Math.sin(t * 0.5)),
    gyroY: Math.round(800 * Math.cos(t * 0.3)),
    gyroZ: 0,
    accelX: Math.round(1200 * Math.sin(t * 0.4)),
    accelY: Math.round(1200 * Math.cos(t * 0.4)),
    accelZ: 8000,
    fingers: [
      { x: Math.round(960 + 800 * Math.sin(t * 0.6)), y: Math.round(540 + 400 * Math.cos(t * 0.6)),
        touching: finger1Touching, index: 1 },
      { x: 0, y: 0, touching: false, index: 0 },
    ],
    batteryRaw: 0x08,
    batteryPct: 80,
    batteryState: 0,
  };
}

export function mockSlots(state: MockState) {
  const t = (performance.now() - state.startMs) / 1000;
  return {
    addrs: [
      [0x14, 0x3A, 0x9A, 0xFF, 0xD9, 0xF9] as number[],
      [0x2C, 0xAB, 0x33, 0xCC, 0x14, 0xDD] as number[],
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00] as number[],
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00] as number[],
    ],
    // Slot 0 always occupied; slot 1 flickers in/out every 8s to make it interesting.
    occupied: [true, (Math.floor(t / 8) % 2) === 0, false, false],
  };
}

export function mockDiag(state: MockState) {
  const elapsed = Math.floor((performance.now() - state.startMs) / 1000);
  return {
    uptimeSeconds: elapsed + 514,           // start with non-zero
    usbFrames: 48000 * elapsed,
    btPackets: 50 * elapsed,
    peakSpeaker: Math.round(120 + 80 * Math.sin(elapsed * 0.5)),
    peakHaptic:  Math.round(80 + 60 * Math.sin(elapsed * 0.4 + 1)),
    hciErrors: 0,
  };
}

export function mockRssi(state: MockState): number {
  const t = (performance.now() - state.startMs) / 1000;
  return Math.round(-55 + 10 * Math.sin(t * 0.3));
}

export function mockBdAddr(): string {
  return "14:3A:9A:FF:D9:F9";
}
