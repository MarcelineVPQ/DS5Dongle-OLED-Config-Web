// Decode the 63-byte DualSense input report (HID report 0x01 on USB).
// Byte layout matches USBGetStateData in firmware src/utils.h.

export interface Stick { x: number; y: number; } // 0..255, 128 = center

export interface Finger {
  x: number;       // 0..1919
  y: number;       // 0..1079
  touching: boolean;
  index: number;
}

export interface InputReport {
  // Sticks (0..255, 128 = center)
  leftStick: Stick;
  rightStick: Stick;
  // Triggers (0..255)
  triggerLeft: number;
  triggerRight: number;
  // D-pad (0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, 8=released)
  dpad: number;
  // Face buttons
  square: boolean;
  cross: boolean;
  circle: boolean;
  triangle: boolean;
  // Shoulder + back buttons
  l1: boolean; r1: boolean;
  l2: boolean; r2: boolean;       // digital (analog values in trigger*)
  create: boolean; options: boolean;
  l3: boolean; r3: boolean;
  // Special
  home: boolean; pad: boolean; mute: boolean;
  // Gyro (raw int16 angular velocity)
  gyroX: number; gyroY: number; gyroZ: number;
  // Accel (raw int16)
  accelX: number; accelY: number; accelZ: number;
  // Touchpad fingers (DS5 reports two)
  fingers: [Finger, Finger];
  // Battery (low nibble × 10 = %, high nibble = state)
  batteryRaw: number;
  batteryPct: number;
  batteryState: number;
}

export function decodeInputReport(data: Uint8Array | DataView): InputReport {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  // Bounds-safe access; firmware always sends 63 bytes but defensive in case
  // some upstream API includes the report ID byte at offset 0.
  const b = (i: number): number => (i >= 0 && i < bytes.length ? bytes[i] : 0);

  const b7 = b(7);
  const b8 = b(8);
  const b9 = b(9);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const i16 = (off: number): number =>
    off + 1 < bytes.length ? view.getInt16(off, true) : 0;

  const decodeFinger = (off: number): Finger => {
    const f =
      (b(off) >>> 0) |
      ((b(off + 1) << 8) >>> 0) |
      ((b(off + 2) << 16) >>> 0) |
      ((b(off + 3) << 24) >>> 0);
    return {
      index: f & 0x7f,
      touching: ((f >>> 7) & 1) === 0,
      x: (f >>> 8) & 0xfff,
      y: (f >>> 20) & 0xfff,
    };
  };

  const pwr = b(52);
  return {
    leftStick:  { x: b(0), y: b(1) },
    rightStick: { x: b(2), y: b(3) },
    triggerLeft:  b(4),
    triggerRight: b(5),
    dpad: b7 & 0x0f,
    square:   ((b7 >> 4) & 1) === 1,
    cross:    ((b7 >> 5) & 1) === 1,
    circle:   ((b7 >> 6) & 1) === 1,
    triangle: ((b7 >> 7) & 1) === 1,
    l1:       ((b8 >> 0) & 1) === 1,
    r1:       ((b8 >> 1) & 1) === 1,
    l2:       ((b8 >> 2) & 1) === 1,
    r2:       ((b8 >> 3) & 1) === 1,
    create:   ((b8 >> 4) & 1) === 1,
    options:  ((b8 >> 5) & 1) === 1,
    l3:       ((b8 >> 6) & 1) === 1,
    r3:       ((b8 >> 7) & 1) === 1,
    home: ((b9 >> 0) & 1) === 1,
    pad:  ((b9 >> 1) & 1) === 1,
    mute: ((b9 >> 2) & 1) === 1,
    gyroX:  i16(15),
    gyroZ:  i16(17),
    gyroY:  i16(19),
    accelX: i16(21),
    accelY: i16(23),
    accelZ: i16(25),
    fingers: [decodeFinger(32), decodeFinger(36)],
    batteryRaw: pwr,
    batteryPct: (pwr & 0x0f) * 10,
    batteryState: (pwr >> 4) & 0x0f,
  };
}

export function emptyInputReport(): InputReport {
  return {
    leftStick:  { x: 128, y: 128 },
    rightStick: { x: 128, y: 128 },
    triggerLeft: 0,
    triggerRight: 0,
    dpad: 8,
    square: false, cross: false, circle: false, triangle: false,
    l1: false, r1: false, l2: false, r2: false,
    create: false, options: false, l3: false, r3: false,
    home: false, pad: false, mute: false,
    gyroX: 0, gyroY: 0, gyroZ: 0,
    accelX: 0, accelY: 0, accelZ: 8000, // gravity baseline
    fingers: [
      { x: 0, y: 0, touching: false, index: 0 },
      { x: 0, y: 0, touching: false, index: 0 },
    ],
    batteryRaw: 0x0a,   // 10/10 = 100%
    batteryPct: 100,
    batteryState: 0,
  };
}
