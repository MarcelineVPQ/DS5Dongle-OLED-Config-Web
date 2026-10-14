// The OLED Status screen's controller glyph and battery row, copied from the
// firmware's src/oled_pad.h (same geometry, same rules) for the simulated
// dongle's screen: two stick boxes, the L2/R2 bars beside them, L1/R1 and
// Create/Options at the top between the sticks, the d-pad and rounded face
// buttons, and on a DualSense Edge a strip with Fn L/R and LB/RB. Laid out
// symmetric around the screen's vertical center line (x <-> 127 - x).
// Pressed = filled, released = outline; L3/R3 invert their stick box.

export interface PadCanvas {
  px(x: number, y: number, on: boolean): void;
  outline(x: number, y: number, w: number, h: number): void;
  filled(x: number, y: number, w: number, h: number): void;
  invert(x: number, y: number, w: number, h: number): void;
}

export const W = 128;
export const H = 64;
export const kTop = 30;
export const kLeft = 6;
export const mirrorX = (x: number) => W - 1 - x;
export const mirrorLeft = (x: number, w: number) => W - x - w;

export const kBox = 31;
const kStickTravel = 24;
export const kTrigX = kLeft + kBox + 2;
export const kTrigW = 4;
const kTrigFill = kBox - 2;
export const kShoulderX = kTrigX + kTrigW + 2;
export const kShoulderW = 12;
const kShoulderH = 3;
export const kSmallX = kShoulderX + kShoulderW + 2;
export const kSmallW = 3;
export const kSmallH = 5;
export const kBtn = 5;
export const kBtnStep = 6;
export const kDpadCx = kShoulderX + kBtnStep + (kBtn >> 1);
export const kClusterCy = kTop + 17;
export const kEdgeH = 3;
export const kEdgeY = kTop + kBox - kEdgeH;
const kFnX = kSmallX;
const kFnW = kSmallW;
const kBackX = kShoulderX;
const kBackW = kFnX - 3 - kBackX;

// The battery row: outline + nub from the left stick box's inner edge to the
// right one's (x 36..91), the level text left of it, the charge ETA mirrored.
export const kBattY = 18;
const kBattH = 8;
export const kBattX0 = kLeft + kBox - 1;
export const kBattX1 = mirrorX(kBattX0);
const kNubW = 3;
const kNubH = 4;
export const kBattW = kBattX1 + 1 - kNubW - kBattX0;
export const kBattFill = kBattW - 4;
const kBattText = 5 * 6 - 1;
export const kBattTextX = kLeft;
export const kEtaX = mirrorLeft(kBattTextX, kBattText);

const battFill = (pct: number) => (pct <= 0 ? 0 : pct >= 100 ? kBattFill : Math.floor((pct * kBattFill) / 100));
const stickOffset = (v: number) => Math.floor((v * kStickTravel + 127) / 255);
const triggerFill = (v: number) => Math.floor((v * kTrigFill + 127) / 255);

export function drawBattery(c: PadCanvas, pct: number): void {
  c.outline(kBattX0, kBattY, kBattW, kBattH);
  c.filled(kBattX0 + kBattW, kBattY + (kBattH - kNubH) / 2, kNubW, kNubH);
  const n = battFill(pct);
  if (n > 0) c.filled(kBattX0 + 2, kBattY + 2, n, kBattH - 4);
}

function button(c: PadCanvas, x: number, y: number, w: number, h: number, on: boolean, round: boolean): void {
  if (on) c.filled(x, y, w, h);
  else c.outline(x, y, w, h);
  if (round) {
    c.px(x, y, false);
    c.px(x + w - 1, y, false);
    c.px(x, y + h - 1, false);
    c.px(x + w - 1, y + h - 1, false);
  }
}

function stick(c: PadCanvas, x: number, sx: number, sy: number, click: boolean): void {
  c.outline(x, kTop, kBox, kBox);
  const cx = x + 3 + stickOffset(sx);
  const cy = kTop + 3 + stickOffset(sy);
  c.filled(cx - 1, cy - 1, 3, 3);
  if (click) c.invert(x, kTop, kBox, kBox);
}

function trigger(c: PadCanvas, x: number, v: number): void {
  c.outline(x, kTop, kTrigW, kBox);
  const n = triggerFill(v);
  if (n > 0) c.filled(x + 1, kTop + 1 + kTrigFill - n, kTrigW - 2, n);
}

// `input` = the controller's input report as 0xF0 carries it: [0..3] sticks,
// [4,5] L2/R2, [7] d-pad + face, [8] L1 R1 L2 R2 Create Options L3 R3, and on
// an Edge [9] bits 4..7 Fn L, Fn R, LB, RB.
export function drawPad(c: PadCanvas, input: Uint8Array, edge = false): void {
  const b7 = input[7];
  const b8 = input[8];
  stick(c, kLeft, input[0], input[1], (b8 & 0x40) !== 0);
  stick(c, mirrorLeft(kLeft, kBox), input[2], input[3], (b8 & 0x80) !== 0);
  trigger(c, kTrigX, input[4]);
  trigger(c, mirrorLeft(kTrigX, kTrigW), input[5]);

  button(c, kShoulderX, kTop, kShoulderW, kShoulderH, (b8 & 0x01) !== 0, false); // L1
  button(c, mirrorLeft(kShoulderX, kShoulderW), kTop, kShoulderW, kShoulderH, (b8 & 0x02) !== 0, false); // R1
  button(c, kSmallX, kTop, kSmallW, kSmallH, (b8 & 0x10) !== 0, false); // Create
  button(c, mirrorLeft(kSmallX, kSmallW), kTop, kSmallW, kSmallH, (b8 & 0x20) !== 0, false); // Options

  // D-pad: hat 0..7 clockwise from N, 8 = released; diagonals light both.
  const dp = b7 & 0x0f;
  const n = dp === 7 || dp === 0 || dp === 1;
  const e = dp === 1 || dp === 2 || dp === 3;
  const s = dp === 3 || dp === 4 || dp === 5;
  const w = dp === 5 || dp === 6 || dp === 7;
  const h = kBtn >> 1;
  const dx = kDpadCx - h;
  const dy = kClusterCy - h;
  button(c, dx, dy - kBtnStep, kBtn, kBtn, n, false);
  button(c, dx + kBtnStep, dy, kBtn, kBtn, e, false);
  button(c, dx, dy + kBtnStep, kBtn, kBtn, s, false);
  button(c, dx - kBtnStep, dy, kBtn, kBtn, w, false);

  // Face buttons, rounded so they read apart from the d-pad.
  const fx = mirrorX(kDpadCx) - h;
  button(c, fx, dy - kBtnStep, kBtn, kBtn, (b7 & 0x80) !== 0, true); // Triangle
  button(c, fx + kBtnStep, dy, kBtn, kBtn, (b7 & 0x40) !== 0, true); // Circle
  button(c, fx, dy + kBtnStep, kBtn, kBtn, (b7 & 0x20) !== 0, true); // Cross
  button(c, fx - kBtnStep, dy, kBtn, kBtn, (b7 & 0x10) !== 0, true); // Square

  if (edge) {
    const b9 = input[9];
    button(c, kFnX, kEdgeY, kFnW, kEdgeH, (b9 & 0x10) !== 0, false); // Fn L
    button(c, mirrorLeft(kFnX, kFnW), kEdgeY, kFnW, kEdgeH, (b9 & 0x20) !== 0, false); // Fn R
    button(c, kBackX, kEdgeY, kBackW, kEdgeH, (b9 & 0x40) !== 0, false); // LB
    button(c, mirrorLeft(kBackX, kBackW), kEdgeY, kBackW, kEdgeH, (b9 & 0x80) !== 0, false); // RB
  }
}

// A canvas over the firmware's packed frame (128 x 64, row-major, 16 bytes a
// row, MSB = leftmost pixel), the layout the OLED mirror (0xEF) carries.
export function packedCanvas(fb: Uint8Array): PadCanvas & { get(x: number, y: number): boolean } {
  const inside = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
  const get = (x: number, y: number) => inside(x, y) && (fb[y * 16 + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  const px = (x: number, y: number, on: boolean) => {
    if (!inside(x, y)) return;
    const bit = 0x80 >> (x & 7);
    if (on) fb[y * 16 + (x >> 3)] |= bit;
    else fb[y * 16 + (x >> 3)] &= ~bit;
  };
  return {
    get,
    px,
    outline(x, y, w, h) {
      for (let i = 0; i < w; i++) {
        px(x + i, y, true);
        px(x + i, y + h - 1, true);
      }
      for (let i = 0; i < h; i++) {
        px(x, y + i, true);
        px(x + w - 1, y + i, true);
      }
    },
    filled(x, y, w, h) {
      // loop: NOT-WORTH — small rects on the simulated OLED only (dev/test fake)
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, true);
    },
    invert(x, y, w, h) {
      // loop: NOT-WORTH — small rects on the simulated OLED only (dev/test fake)
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, !get(x + i, y + j));
    },
  };
}
