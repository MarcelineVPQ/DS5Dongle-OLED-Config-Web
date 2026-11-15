// Tension buttons' ButtonPart codec and validator (protocol 1.24), against
// the firmware's docs/TENSION_BUTTONS.md §3 byte for byte: the layout of
// §3.2, the entries of §3.3 (with its own worked example and sizes), the
// targets of §3.4 and every rule of §3.5. The vectors are hand-built from the
// document, and the firmware's shared vectors (tests/fixtures/buttons-vectors.txt,
// the app's copy of its tests/host/fixtures/buttons/vectors.txt, whose
// expectations are set by hand per rule) are checked line by line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUTTON_PART_BYTES,
  buttonPartBytesValid,
  buttonsChunkReplyBytes,
  buttonsChunkSel,
  buttonTarget,
  decodeButtonPart,
  decodeButtonsChunk,
  DISABLE,
  emptyButtonPart,
  encodeButtonPart,
  partFromLegacy,
  poolBytes,
  pressWarnings,
  SOURCE,
  swapBase,
  withBasePress,
  type ButtonPart,
} from "../../src/protocol/buttons";
import { crc32, decodeSetWire, encodeSetBody, encodeSetWire, SET_WIRE_BYTES, STARTERS } from "../../src/protocol/tension";

// A ButtonPart's bytes: header [bflags, layers, window], then the pool.
function part({ bflags = 0x01, layers = 0, window = 25, pool = [] as number[], layerBytes = [] as number[], gyro = [] as number[] } = {}): Uint8Array {
  const b = new Uint8Array(BUTTON_PART_BYTES);
  b[0] = 1;
  b[1] = bflags;
  b[2] = layers;
  b[3] = window;
  b[4] = pool.length & 0xff;
  b[5] = pool.length >> 8;
  b.set(layerBytes, 6);
  b.set(gyro, 42);
  b.set(pool, 52);
  return b;
}
const layer = (name: string, colour = 0, lflags = 0) => {
  const l = new Array<number>(12).fill(0);
  [...name].forEach((c, i) => (l[i] = c.charCodeAt(0)));
  l[10] = colour;
  l[11] = lflags;
  return l;
};

const VECTORS = readFileSync(new URL("../fixtures/buttons-vectors.txt", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const [name, expectation, , crc, hex] = l.split(" ");
    return { name, ok: expectation === "ok", crc: parseInt(crc, 16), bytes: Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))) };
  });

describe("the firmware's shared vectors (tests/host/fixtures/buttons)", () => {
  it("reads them all: 360 bytes each, their CRC-32 as given", () => {
    expect(VECTORS.length).toBeGreaterThan(60);
    // loop: test
    for (const v of VECTORS) {
      expect(v.bytes, v.name).toHaveLength(BUTTON_PART_BYTES);
      expect(crc32(v.bytes), v.name).toBe(v.crc);
    }
  });

  it.each(VECTORS.map((v) => [v.name, v] as const))("%s: the app's checks say what the document does", (_, v) => {
    expect(buttonPartBytesValid(v.bytes)).toBe(v.ok);
    if (!v.ok) return expect(decodeButtonPart(v.bytes)).toBeNull();
    // A valid part decodes and encodes back to the same bytes.
    const part = decodeButtonPart(v.bytes);
    expect(encodeButtonPart(part)).toEqual(v.bytes);
  });
});

describe("ButtonPart layout (TENSION_BUTTONS.md §3.2, §3.3)", () => {
  it("a set that leaves the buttons alone is 360 zero bytes", () => {
    expect([...encodeButtonPart(undefined)]).toEqual(new Array(BUTTON_PART_BYTES).fill(0));
    expect(decodeButtonPart(new Uint8Array(BUTTON_PART_BYTES))).toBeUndefined();
  });

  it("writes a Press-only entry as 5 bytes: Cross → Circle", () => {
    const p = withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.circle));
    const b = encodeButtonPart(p);
    expect([...b.subarray(0, 6)]).toEqual([1, 0x01, 0, 25, 5, 0]);
    expect([...b.subarray(52, 57)]).toEqual([13, 0x01, 1, 12, 0]);
    expect(decodeButtonPart(b)).toEqual(p);
  });

  it("reads the document's own example, Cross: Hold → △ (6 bytes, Press = itself)", () => {
    const b = part({ pool: [13, 0x02, 1, 11, 0, 30] });
    expect(decodeButtonPart(b)).toEqual({
      layers: [],
      doubleWindow: 25,
      gyro: null,
      entries: [{ source: 13, layer: 0, hold: { kind: 1, a: 11, b: 0 }, holdTime: 30 }],
    });
  });

  it("round-trips the largest entry (16 bytes) and the pool sizes of §3.3 (61 Press-only, 19 full)", () => {
    const full = [0, 0x3f, 1, 1, 0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 30, 10]; // L2: Press, Hold, Double, With PS, Toggle, Turbo
    expect(full).toHaveLength(16);
    const b = part({ pool: full });
    const p = decodeButtonPart(b)!;
    expect(encodeButtonPart(p)).toEqual(b);
    // 61 × 5 = 305 ≤ 308 and 19 × 16 = 304 ≤ 308: as many as the document says fit.
    expect(61 * 5).toBeLessThanOrEqual(308);
    expect(19 * 16).toBeLessThanOrEqual(308);
    expect(62 * 5).toBeGreaterThan(308);
    // One full entry per source 0..16 (PS and the With PS row excluded on 17), then two Press-only:
    const pool: number[] = [];
    for (let s = 0; s < 22 && pool.length + 16 <= 308; s++) if (s !== 17) pool.push(s, 0x3f, 1, 1, 0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 30, 10);
    expect(buttonPartBytesValid(part({ pool }))).toBe(true);
    expect(poolBytes(decodeButtonPart(part({ pool }))!)).toBe(pool.length);
  });

  it("keeps entries in (layer, source) order whatever order they were made in", () => {
    let p = withBasePress(emptyButtonPart(), SOURCE.square, DISABLE);
    p = withBasePress(p, SOURCE.l2, buttonTarget(SOURCE.r2));
    expect([...encodeButtonPart(p).subarray(52, 62)]).toEqual([0, 0x01, 1, 8, 0, 14, 0x01, 0, 0, 0]);
  });
});

describe("the board's checks, rule by rule (§3.5)", () => {
  const ok = (b: Uint8Array) => buttonPartBytesValid(b);
  it("1: unused means all zero; used means bver 1 and no reserved bits", () => {
    const b = new Uint8Array(BUTTON_PART_BYTES);
    b[100] = 1;
    expect(ok(b)).toBe(false);
    const ver = part();
    ver[0] = 2;
    expect(ok(ver)).toBe(false);
    expect(ok(part({ bflags: 0x05 }))).toBe(false);
    expect(ok(part())).toBe(true); // used, no changes: every button itself
  });

  it("2: layers, double window, pool length and padding, names, colours, gyro per layer", () => {
    expect(ok(part({ layers: 4 }))).toBe(false);
    expect(ok(part({ window: 14 }))).toBe(false);
    expect(ok(part({ window: 51 }))).toBe(false);
    const long = part();
    long[4] = 309 & 0xff;
    long[5] = 309 >> 8;
    expect(ok(long)).toBe(false);
    const tail = part({ pool: [13, 0x01, 1, 12, 0] });
    tail[52 + 5] = 1; // a byte past pool_len
    expect(ok(tail)).toBe(false);
    expect(ok(part({ layers: 0, layerBytes: layer("Vehicle") }))).toBe(false); // a layer past `layers` not zero
    expect(ok(part({ layers: 1, layerBytes: layer("Vehicle", 5, 2) }))).toBe(true);
    expect(ok(part({ layers: 1, layerBytes: layer("Vehicle", 6) }))).toBe(false);
    expect(ok(part({ layers: 1, layerBytes: layer("Vehicle", 0, 3) }))).toBe(false);
    const gap = layer("Ve");
    gap[3] = 0x41; // a character after the NUL
    expect(ok(part({ layers: 1, layerBytes: gap }))).toBe(false);
    expect(ok(part({ layers: 1, layerBytes: layer("Café") }))).toBe(false); // not ASCII
    expect(ok(part({ gyro: [1, 0, 0, 64, 64, 8] }))).toBe(false); // a gyro block without bit1
    expect(ok(part({ bflags: 0x03, gyro: [1, 0, 0, 64, 64, 8] }))).toBe(true);
    expect(ok(part({ bflags: 0x03, gyro: [0, 0, 0, 64, 64, 8] }))).toBe(false); // mode 0 with bit1
  });

  it("3: entries parse exactly, sources < 22, layers that exist, strictly increasing, rows ≠ 0", () => {
    expect(ok(part({ pool: [13, 0x01, 1, 12] }))).toBe(false); // cut short
    expect(ok(part({ pool: [22, 0x01, 1, 0, 0] }))).toBe(false);
    expect(ok(part({ pool: [13 | (1 << 5), 0x01, 1, 12, 0] }))).toBe(false); // layer 1 of 0
    expect(ok(part({ pool: [13, 0x01, 1, 12, 0, 12, 0x01, 1, 13, 0] }))).toBe(false); // 13 before 12
    expect(ok(part({ pool: [13, 0x01, 1, 12, 0, 13, 0x01, 1, 11, 0] }))).toBe(false); // twice
    expect(ok(part({ pool: [13, 0x00] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x41, 1, 12, 0] }))).toBe(false); // rows bit 6
  });

  it("4: targets per §3.4, hold time 15..200, turbo 2..30", () => {
    const press = (kind: number, a: number, b: number, bflags = 0x01) => ok(part({ bflags, pool: [13, 0x01, kind, a, b], ...(bflags & 2 ? { gyro: [1, 0, 0, 1, 1, 0] } : {}) }));
    expect(press(0, 0, 0)).toBe(true);
    expect(press(0, 1, 0)).toBe(false);
    expect(press(1, 17, 0)).toBe(true);
    expect(press(1, 18, 0)).toBe(false); // the Edge's buttons are not targets
    expect(press(2, 0x04, 0)).toBe(true);
    expect(press(2, 0xa5, 0)).toBe(false);
    expect(press(2, 0, 0x02)).toBe(true); // modifiers only
    expect(press(2, 0, 0)).toBe(false);
    expect(press(3, 5, 0)).toBe(true);
    expect(press(3, 6, 0)).toBe(false);
    expect(press(4, 3, 255)).toBe(true);
    expect(press(4, 4, 31)).toBe(false); // wheel notches 1..30
    expect(press(4, 0, 0)).toBe(false);
    expect(press(6, 0, 0)).toBe(false); // gyro without bit1
    expect(press(6, 2, 0, 0x03)).toBe(true);
    expect(press(7, 0, 0)).toBe(false);
    expect(ok(part({ pool: [13, 0x02, 1, 11, 0, 14] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x02, 1, 11, 0, 201] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x20, 1] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x21, 1, 12, 0, 31] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x21, 1, 12, 0, 30] }))).toBe(true);
  });

  it("5: Toggle and Turbo need a Press that is a button, a key or a mouse button (none = itself)", () => {
    expect(ok(part({ pool: [13, 0x10] }))).toBe(true); // Toggle on the button itself
    expect(ok(part({ pool: [13, 0x11, 0, 0, 0] }))).toBe(false); // Toggle on Disable
    expect(ok(part({ pool: [13, 0x11, 4, 0, 10] }))).toBe(false); // on mouse motion
    expect(ok(part({ pool: [13, 0x11, 3, 1, 0] }))).toBe(true);
  });

  it("6: the PS button: only Hold and Double press, never With PS", () => {
    expect(ok(part({ pool: [17, 0x01, 1, 13, 0] }))).toBe(false);
    expect(ok(part({ pool: [17, 0x02, 1, 13, 0, 30] }))).toBe(true);
    expect(ok(part({ pool: [17, 0x08, 1, 13, 0] }))).toBe(false);
    expect(ok(part({ pool: [13, 0x08, 1, 11, 0] }))).toBe(true); // With PS on another button
  });

  it("7: a Layer target names an existing layer, never its own; a switch into L keeps no entry in L", () => {
    const one = layer("A");
    const two = [...layer("A"), ...layer("B")];
    expect(ok(part({ layers: 1, layerBytes: one, pool: [1, 0x01, 5, 1, 0] }))).toBe(true);
    expect(ok(part({ layers: 1, layerBytes: one, pool: [1, 0x01, 5, 2, 0] }))).toBe(false);
    expect(ok(part({ layers: 1, layerBytes: one, pool: [1 | (1 << 5), 0x01, 5, 1, 0] }))).toBe(false); // its own layer
    expect(ok(part({ layers: 2, layerBytes: two, pool: [1, 0x01, 5, 1, 1, 1 | (1 << 5), 0x01, 1, 9, 0] }))).toBe(false); // switches into 1 and has an entry there
    expect(ok(part({ layers: 2, layerBytes: two, pool: [1, 0x01, 5, 1, 0, 1 | (1 << 5), 0x01, 5, 2, 0] }))).toBe(true); // held, not switched: allowed
  });
});

describe("Press-only editing (build step 2)", () => {
  it("a Press back to the button itself removes its entry", () => {
    const p = withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.circle));
    expect(withBasePress(p, SOURCE.cross, buttonTarget(SOURCE.cross)).entries).toEqual([]);
    expect(withBasePress(p, SOURCE.cross, null).entries).toEqual([]);
  });

  it("Swap with… swaps the whole jobs, a button that was itself handing over its own", () => {
    const p = swapBase(emptyButtonPart(), SOURCE.cross, SOURCE.circle);
    expect(p.entries).toEqual([
      { source: SOURCE.circle, layer: 0, press: buttonTarget(SOURCE.cross) },
      { source: SOURCE.cross, layer: 0, press: buttonTarget(SOURCE.circle) },
    ]);
    expect(swapBase(p, SOURCE.cross, SOURCE.circle).entries).toEqual([]); // swapped back: nothing changed
  });

  it("Make a set from these buttons: every changed legacy button and Edge extra as a Press entry", () => {
    const table = Array.from({ length: 16 }, (_, i) => i);
    table[13] = 12;
    table[12] = 13;
    table[1] = 0xff;
    const p = partFromLegacy(table, [0xff, 0xfe, 9, 0xff]);
    expect(p.entries.map((e) => [e.source, e.press])).toEqual([
      [1, DISABLE],
      [12, buttonTarget(13)],
      [13, buttonTarget(12)],
      [19, DISABLE],
      [20, buttonTarget(9)],
    ]);
    expect(buttonPartBytesValid(encodeButtonPart(p))).toBe(true);
  });

  it("warns when nothing presses ✕ or ○, and on two buttons doing one job (§7.6)", () => {
    const none: ButtonPart = emptyButtonPart();
    expect(pressWarnings(none)).toMatchObject({ noCross: false, noCircle: false });
    expect(pressWarnings(none).duplicates.size).toBe(0);
    const moved = withBasePress(none, SOURCE.cross, buttonTarget(SOURCE.triangle));
    const w = pressWarnings(moved);
    expect(w.noCross).toBe(true);
    expect(w.duplicates.get(SOURCE.cross)).toEqual([SOURCE.triangle]);
    expect(w.duplicates.get(SOURCE.triangle)).toEqual([SOURCE.cross]);
    // A Hold that reaches ✕ counts.
    expect(pressWarnings({ ...moved, entries: [...moved.entries, { source: SOURCE.square, layer: 0, hold: buttonTarget(SOURCE.cross), holdTime: 30 }] }).noCross).toBe(false);
  });
});

describe("the 494-byte wire and its reads (§3.1, §6.3)", () => {
  it("is the SetBody then the ButtonPart; a set without buttons ends in 360 zeros", () => {
    const set = { ...STARTERS.bow, buttons: withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.circle)) };
    const wire = encodeSetWire(set);
    expect(wire).toHaveLength(SET_WIRE_BYTES);
    expect(wire.subarray(0, 134)).toEqual(encodeSetBody(STARTERS.bow));
    expect(decodeSetWire(wire)).toEqual(set);
    const plain = encodeSetWire(STARTERS.bow);
    expect(plain.subarray(134).every((v) => v === 0)).toBe(true);
    expect(decodeSetWire(plain)).toEqual(STARTERS.bow); // no `buttons` key: the set leaves the buttons alone
    expect(crc32(plain)).not.toBe(crc32(wire));
  });

  it("reads the ButtonPart in seven chunks: sel 0x80 | slot << 3 | chunk, 60-byte replies and 28 for the last", () => {
    expect(buttonsChunkSel(5, 6)).toBe(0x80 | (5 << 3) | 6);
    expect([0, 1, 2, 3, 4, 5, 6].map(buttonsChunkReplyBytes)).toEqual([60, 60, 60, 60, 60, 60, 28]);
    const reply = new Uint8Array(28);
    reply.set([2, 5, 6, 1, 9]);
    expect(decodeButtonsChunk(reply, 5, 6)).toEqual({ used: true, bytes: reply.slice(4) });
    expect(decodeButtonsChunk(reply, 4, 6)).toBeNull(); // another slot's
    expect(decodeButtonsChunk(reply.subarray(0, 27), 5, 6)).toBeNull();
  });
});
