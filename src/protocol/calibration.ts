// Stick / trigger / gyro calibration kept in the dongle (protocol 1.5), one
// per pairing slot: the 18-byte body the firmware stores (src/calib.h there),
// its defaults, and the same correction math, so the app can preview the
// result. Get 0xEE ([slot in use] + body), set 0xF6 func 0x0D
// ['C','L',ver, slot, body].

import { KeyedError } from "../errorText";

export const CALIB_PROTO_VER = 2;
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
  // The raw gyro reading at rest, in report order (offsets 15, 17, 19 = the
  // InputReport's gyroX, gyroZ, gyroY); 0, 0, 0 = not calibrated. The dongle
  // subtracts only what's left after the controller's factory bias, which
  // games already remove.
  gyro: [number, number, number];
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
    // loop: HOT-PATH-OK — N = 3 gyro axes
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
  if (bytes.length < CALIB_BODY_SIZE) throw new KeyedError("desktop.errors.board.short");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stick = (i: number): StickCal => ({ cx: v.getInt8(i * 4), cy: v.getInt8(i * 4 + 1), deadzone: v.getUint8(i * 4 + 2), outer: v.getUint8(i * 4 + 3) });
  const trigger = (i: number): TriggerCal => ({ lo: v.getUint8(8 + i * 2), hi: v.getUint8(9 + i * 2) });
  return { sticks: [stick(0), stick(1)], triggers: [trigger(0), trigger(1)], gyro: [0, 1, 2].map((i) => v.getInt16(12 + i * 2, true)) as [number, number, number] };
}

const IDENTITY_STICK: StickCal = DEFAULT_CALIBRATION.sticks[0];
const isIdentityStick = (s: StickCal) => s.cx === 0 && s.cy === 0 && s.deadzone === 0 && s.outer === IDENTITY_STICK.outer;

// The firmware's correction (src/calib.cpp stick()), for the live preview:
// center offset, each half-axis normalized to its own reach (the side the
// center leans toward has less travel), a radial deadzone, full tilt at 0 and
// 255. An untouched stick passes through unchanged.
export function correctStick(x: number, y: number, s: StickCal): [number, number] {
  if (isIdentityStick(s)) return [x, y];
  const dx = x - 128 - s.cx;
  const dy = y - 128 - s.cy;
  const nx = dx / Math.min(s.outer, dx >= 0 ? 127 - s.cx : 128 + s.cx);
  const ny = dy / Math.min(s.outer, dy >= 0 ? 127 - s.cy : 128 + s.cy);
  const mag = Math.hypot(nx, ny);
  const dz = s.deadzone / s.outer;
  if (mag <= dz) return [128, 128];
  const k = Math.min(1, (mag - dz) / (1 - dz)) / mag;
  const out = (n: number) => clamp(128 + n * k * (n >= 0 ? 127 : 128), 0, 255);
  return [out(nx), out(ny)];
}
export const correctTrigger = (v: number, t: TriggerCal) => (t.lo === 0 && t.hi === 255 ? v : clamp(((v - t.lo) * 255) / (t.hi - t.lo), 0, 255));

// The least travel a guided step must see to count; less means the stick or
// trigger wasn't pushed all the way, and the old value is kept.
export const MIN_STICK_REACH = 100;
export const MIN_TRIGGER_TRAVEL = 180;

// From samples taken while the stick rests: its center, and a deadzone just
// past its jitter (at least 4).
export function fitCenter(samples: Array<[number, number]>): Pick<StickCal, "cx" | "cy" | "deadzone"> {
  const cx = samples.reduce((a, [x]) => a + x, 0) / samples.length - 128;
  const cy = samples.reduce((a, [, y]) => a + y, 0) / samples.length - 128;
  const jitter = Math.max(...samples.map(([x, y]) => Math.hypot(x - 128 - cx, y - 128 - cy)));
  return { cx: Math.round(cx), cy: Math.round(cy), deadzone: Math.max(4, Math.ceil(jitter + 2)) };
}
// From samples while the stick circles its edge: the radius it actually
// reaches (a little inside, so full tilt is reliable); null if it never got
// near the edge.
export function fitOuter(samples: Array<[number, number]>, cx: number, cy: number): number | null {
  const r = Math.max(...samples.map(([x, y]) => Math.hypot(x - 128 - cx, y - 128 - cy)));
  return r < MIN_STICK_REACH ? null : clamp(r * 0.97, 64, 128);
}
// The trigger's travel; null if it wasn't pressed all the way.
export function fitTrigger(samples: number[]): TriggerCal | null {
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  if (hi - lo < MIN_TRIGGER_TRAVEL) return null;
  return { lo: lo > 0 ? lo + 2 : 0, hi: hi < 255 ? hi - 2 : 255 };
}
// The gyro at rest, in report order ([x, z, y] of the InputReport); null if
// the controller moved (spread over GYRO_STILL counts on any axis).
export const GYRO_STILL = 40;
export function fitGyro(samples: Array<[number, number, number]>): [number, number, number] | null {
  const axis = (i: number) => samples.map((s) => s[i]);
  for (let i = 0; i < 3; i++) if (Math.max(...axis(i)) - Math.min(...axis(i)) > GYRO_STILL) return null;
  // loop: NOT-WORTH — once when a gyro calibration step ends
  const avg = [0, 1, 2].map((i) => Math.round(axis(i).reduce((a, v) => a + v, 0) / samples.length)) as [number, number, number];
  // 0, 0, 0 means "not calibrated" to the firmware.
  if (avg[0] === 0 && avg[1] === 0 && avg[2] === 0) avg[2] = 1;
  return avg;
}
