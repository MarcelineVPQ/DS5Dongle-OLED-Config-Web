// The simulated dongle's OLED Status glyph (src/oled/statusPad.ts) must draw
// exactly what the firmware's src/oled_pad.h draws: the firmware host test's
// golden frame hashes (tests/host/test_oled_pad.cpp, FNV-1a over the pixels)
// match here too, and the same rules hold: mirror-symmetric around x = 63.5,
// Create/Options between L1 and R1, the Edge strip only on an Edge, the
// battery row spanning the stick boxes' inner edges.
import { describe, expect, it } from "vitest";
import {
  drawBattery,
  drawPad,
  H,
  kBattFill,
  kBtn,
  kBtnStep,
  kClusterCy,
  kDpadCx,
  kBattX0,
  kBattX1,
  kBattY,
  kEdgeH,
  kEdgeY,
  kLeft,
  kShoulderW,
  kShoulderX,
  kSmallH,
  kTop,
  packedCanvas,
  W,
} from "../../src/oled/statusPad";

const report = (set: Record<number, number> = {}): Uint8Array => {
  const d = new Uint8Array(63);
  d.set([128, 128, 128, 128], 0);
  d[7] = 0x08; // d-pad released
  for (const [i, v] of Object.entries(set)) d[Number(i)] = v;
  return d;
};

type Frame = ReturnType<typeof packedCanvas>;
const render = (r: Uint8Array, edge = false): Frame => {
  const f = packedCanvas(new Uint8Array(1024));
  drawPad(f, r, edge);
  return f;
};

// The same state seen in a mirror (as the firmware test's mirrored()).
function mirrored(r: Uint8Array): Uint8Array {
  const m = r.slice();
  m[0] = 255 - r[2];
  m[1] = r[3];
  m[2] = 255 - r[0];
  m[3] = r[1];
  m[4] = r[5];
  m[5] = r[4];
  const hat = r[7] & 0x0f;
  let face = r[7] & 0xa0;
  if (r[7] & 0x10) face |= 0x40;
  if (r[7] & 0x40) face |= 0x10;
  m[7] = face | (hat < 8 ? (8 - hat) % 8 : hat);
  const swap = (b: number, from: number) => {
    let out = b & ((1 << from) - 1);
    for (let bit = from; bit < 8; bit += 2) {
      if (b & (1 << bit)) out |= 2 << bit;
      if (b & (2 << bit)) out |= 1 << bit;
    }
    return out;
  };
  m[8] = swap(r[8], 0);
  m[9] = swap(r[9], 4);
  return m;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function bbox(a: Frame, b: Frame | null): Box | null {
  let box: Box | null = null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (b ? a.get(x, y) === b.get(x, y) : !a.get(x, y)) continue;
      box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
    }
  return box;
}
const mirrorBox = (b: Box | null): Box | null => b && { x0: W - 1 - b.x1, y0: b.y0, x1: W - 1 - b.x0, y1: b.y1 };

// Pixels where f differs from g seen in a mirror (outside the d-pad / face
// buttons, which mirror by position, not by direction: checked apart).
const ZONE = kBtnStep + (kBtn >> 1);
const inDpad = (x: number, y: number) => Math.abs(x - kDpadCx) <= ZONE && Math.abs(y - kClusterCy) <= ZONE;
const inCluster = (x: number, y: number) => inDpad(x, y) || inDpad(W - 1 - x, y);
function asymmetric(f: Frame, g: Frame): number {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inCluster(x, y) && f.get(x, y) !== g.get(W - 1 - x, y)) n++;
  return n;
}

function fnv(f: Frame): number {
  let h = 2166136261;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      h ^= f.get(x, y) ? 1 : 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
  return h >>> 0;
}

// The firmware host test's golden_states() and kDualSenseGolden, in order.
function goldenStates(): Uint8Array[] {
  const v: Uint8Array[] = [];
  const add = (byte: number, val: number, b9: number) => {
    const r = report({ [byte]: val });
    r[9] = b9;
    v.push(r);
  };
  add(7, 0x08, 0);
  add(7, 0x08, 0xf0);
  for (let bit = 0; bit < 8; bit++) add(8, 1 << bit, 0);
  for (let hat = 0; hat < 8; hat++) add(7, hat, 0);
  for (let bit = 4; bit < 8; bit++) add(7, 0x08 | (1 << bit), 0);
  for (let a = 0; a < 6; a++) {
    add(a, 0, 0);
    add(a, 255, 0);
    add(a, 77, 0);
  }
  v.push(report({ 0: 0, 1: 0, 2: 255, 3: 255, 4: 255, 5: 255, 7: 0xf1, 8: 0xff, 9: 0xff }));
  return v;
}
const GOLDEN = [
  0x259460d3, 0x259460d3, 0xc8fad721, 0xff78edb1, 0x259460d3, 0x259460d3, 0x6c842652, 0xeb04fa88, 0xff155c60, 0xdbfb1fc6, 0xde93066c, 0x22236ba7, 0xe203fb98, 0x468a6aa3, 0xc10df1c8, 0x788cb613,
  0x14064708, 0xf0212037, 0x5f93709e, 0x1e2ea062, 0xa588c4ce, 0x6537a506, 0x08971143, 0xf13cd563, 0xba73d2ed, 0x8cb1276b, 0xe6466863, 0x58678c57, 0x9db00e03, 0xf1c87ca3, 0xd9dfc475, 0xcac70ea3,
  0xb413fb4f, 0xae99ca67, 0x259460d3, 0x0000e2bd, 0xd9991ba9, 0x259460d3, 0xbc74564d, 0x14b14619, 0x4fe6228b,
];

describe("OLED Status glyph (as the firmware's oled_pad.h)", () => {
  it("draws the firmware's exact pixels (its golden frames)", () => {
    const states = goldenStates();
    expect(states).toHaveLength(GOLDEN.length);
    expect(states.map((r) => fnv(render(r)))).toEqual(GOLDEN);
  });

  it("is symmetric: idle equals its own mirror image", () => {
    const idle = render(report());
    expect(asymmetric(idle, idle)).toBe(0);
    expect(asymmetric(render(report(), true), render(report(), true))).toBe(0);
  });

  it("mirrors a state onto its mirrored state (sticks, triggers, shoulders, Create/Options, Edge marks)", () => {
    const states = [report({ 8: 0x01 }), report({ 8: 0x10 }), report({ 8: 0x40 }), report({ 4: 200 }), report({ 0: 0, 1: 255 }), report({ 9: 0x10 }), report({ 9: 0x40 })];
    for (const r of states) for (const edge of [false, true]) expect(asymmetric(render(r, edge), render(mirrored(r), edge))).toBe(0);
  });

  it("lights Create and Options between L1 and R1, in the top row, mirrored", () => {
    const idle = render(report());
    const c = bbox(render(report({ 8: 0x10 })), idle);
    const o = bbox(render(report({ 8: 0x20 })), idle);
    expect(c).not.toBeNull();
    expect(c!.y0).toBeGreaterThanOrEqual(kTop);
    expect(c!.y1).toBeLessThan(kTop + kSmallH);
    expect(c!.x0).toBeGreaterThan(kShoulderX + kShoulderW);
    expect(c!.x1).toBeLessThan(W / 2);
    expect(o).toEqual(mirrorBox(c));
  });

  it("stays clear of the header and the button chrome", () => {
    const all = render(report({ 4: 255, 5: 255, 7: 0xf1, 8: 0xff, 9: 0xff }), true);
    const b = bbox(all, null)!;
    expect(b.x0).toBeGreaterThanOrEqual(kLeft);
    expect(b.x1).toBeLessThanOrEqual(W - 1 - kLeft);
    expect(b.y0).toBeGreaterThanOrEqual(kTop);
  });

  it("an Edge only adds its strip; a DualSense draws nothing there", () => {
    for (const r of goldenStates()) {
      const diff = bbox(render(r, true), render(r))!;
      expect(diff.y0).toBeGreaterThanOrEqual(kEdgeY);
      expect(diff.y1).toBeLessThan(kEdgeY + kEdgeH);
    }
    const ds = render(report({ 9: 0xf0 }));
    expect(fnv(ds)).toBe(GOLDEN[0]);
  });

  it("the battery row spans the stick boxes' inner edges (x 36..91), fill proportional", () => {
    for (const pct of [0, 50, 80, 100]) {
      const f = packedCanvas(new Uint8Array(1024));
      drawBattery(f, pct);
      const b = bbox(f, null)!;
      expect([b.x0, b.x1, b.y0]).toEqual([36, 91, kBattY]);
      expect([kBattX0, kBattX1]).toEqual([36, 91]);
      expect(b.y1).toBeLessThan(kTop - 1);
      let fill = 0;
      for (let x = kBattX0 + 1; x < kBattX1 - 3; x++) fill += f.get(x, kBattY + 2) ? 1 : 0;
      expect(fill).toBe(Math.floor((pct * kBattFill) / 100));
    }
  });
});
