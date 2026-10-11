// Stick / trigger / gyro calibration kept in the dongle (protocol 1.5): the
// 18-byte body the firmware stores (src/calib.h there), its defaults, and the
// same correction math, so the app can preview the result. Get 0xEE, set
// 0xF6 func 0x0D ['C','L',ver, body].

export const CALIB_PROTO_VER = 1;
export const CALIB_BODY_SIZE = 18;

export interface StickCal {
  cx: number; // resting center, offset from 128 (-40..40)
  cy: number;
  deadzone: number; // 0..64
  outer: number; // 64..128, radius counted as full tilt
}
export interface TriggerCal {
  lo: number; // raw read as 0
  hi: number; // raw read as 255
}
export interface Calibration {
  sticks: [StickCal, StickCal]; // left, right
  triggers: [TriggerCal, TriggerCal]; // L2, R2
  gyro: [number, number, number]; // zero offset
}

export const DEFAULT_CALIBRATION: Calibration = {
  sticks: [
    { cx: 0, cy: 0, deadzone: 0, outer: 128 },
    { cx: 0, cy: 0, deadzone: 0, outer: 128 },
  ],
  triggers: [
    { lo: 0, hi: 255 },
    { lo: 0, hi: 255 },
  ],
  gyro: [0, 0, 0],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

// Within the firmware's limits (it refuses anything else).
export function normalizeCalibration(c: Calibration): Calibration {
  const stick = (s: StickCal): StickCal => {
    const outer = clamp(s.outer, 64, 128);
    return { cx: clamp(s.cx, -40, 40), cy: clamp(s.cy, -40, 40), deadzone: clamp(s.deadzone, 0, Math.min(64, outer - 1)), outer };
  };
  const trigger = (t: TriggerCal): TriggerCal => {
    const lo = clamp(t.lo, 0, 191);
    return { lo, hi: clamp(t.hi, lo + 64, 255) };
  };
  return {
    sticks: [stick(c.sticks[0]), stick(c.sticks[1])],
    triggers: [trigger(c.triggers[0]), trigger(c.triggers[1])],
    gyro: c.gyro.map((g) => clamp(g, -32768, 32767)) as [number, number, number],
  };
}

export function encodeCalibration(c: Calibration): Uint8Array {
  const n = normalizeCalibration(c);
  const out = new Uint8Array(CALIB_BODY_SIZE);
  const v = new DataView(out.buffer);
  n.sticks.forEach((s, i) => {
    v.setInt8(i * 4, s.cx);
    v.setInt8(i * 4 + 1, s.cy);
    v.setUint8(i * 4 + 2, s.deadzone);
    v.setUint8(i * 4 + 3, s.outer);
  });
  n.triggers.forEach((t, i) => {
    v.setUint8(8 + i * 2, t.lo);
    v.setUint8(9 + i * 2, t.hi);
  });
  n.gyro.forEach((g, i) => v.setInt16(12 + i * 2, g, true));
  return out;
}

export function decodeCalibration(bytes: Uint8Array): Calibration {
  if (bytes.length < CALIB_BODY_SIZE) throw new Error("Short calibration report");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stick = (i: number): StickCal => ({ cx: v.getInt8(i * 4), cy: v.getInt8(i * 4 + 1), deadzone: v.getUint8(i * 4 + 2), outer: v.getUint8(i * 4 + 3) });
  const trigger = (i: number): TriggerCal => ({ lo: v.getUint8(8 + i * 2), hi: v.getUint8(9 + i * 2) });
  return { sticks: [stick(0), stick(1)], triggers: [trigger(0), trigger(1)], gyro: [0, 1, 2].map((i) => v.getInt16(12 + i * 2, true)) as [number, number, number] };
}

// The firmware's correction (src/calib.cpp), for the live preview.
export function correctStick(x: number, y: number, s: StickCal): [number, number] {
  const dx = x - 128 - s.cx;
  const dy = y - 128 - s.cy;
  const mag = Math.hypot(dx, dy);
  if (mag <= s.deadzone) return [128, 128];
  const scaled = Math.min(127, ((mag - s.deadzone) / (s.outer - s.deadzone)) * 127);
  return [clamp(128 + (dx / mag) * scaled, 0, 255), clamp(128 + (dy / mag) * scaled, 0, 255)];
}
export const correctTrigger = (v: number, t: TriggerCal) => clamp(((v - t.lo) * 255) / (t.hi - t.lo), 0, 255);

// From samples taken while the stick rests: its center, and a deadzone just
// past its jitter (at least 4).
export function fitCenter(samples: Array<[number, number]>): Pick<StickCal, "cx" | "cy" | "deadzone"> {
  const cx = samples.reduce((a, [x]) => a + x, 0) / samples.length - 128;
  const cy = samples.reduce((a, [, y]) => a + y, 0) / samples.length - 128;
  const jitter = Math.max(...samples.map(([x, y]) => Math.hypot(x - 128 - cx, y - 128 - cy)));
  return { cx: Math.round(cx), cy: Math.round(cy), deadzone: Math.max(4, Math.ceil(jitter + 2)) };
}
// From samples while the stick circles its edge: the radius it actually
// reaches (a little inside, so full tilt is reliable).
export function fitOuter(samples: Array<[number, number]>, cx: number, cy: number): number {
  const r = Math.max(...samples.map(([x, y]) => Math.hypot(x - 128 - cx, y - 128 - cy)));
  return clamp(r * 0.97, 64, 128);
}
export function fitTrigger(samples: number[]): TriggerCal {
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  return { lo: lo > 0 ? lo + 2 : 0, hi: hi < 255 ? hi - 2 : 255 };
}
