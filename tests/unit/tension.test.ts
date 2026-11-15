// Tension's codec (protocol 1.23) against the firmware's contract,
// docs/TENSION.md in the firmware repo: the SetBody layout byte for byte (the
// bow of section 3), the same validation as tension.h (the board answers
// INVALID to anything else), the CRC-32 the commits carry, and the 0xE9
// replies read with their bounds checked.
import { describe, expect, it } from "vitest";
import {
  BOW_R2_STAGES,
  crc32,
  decodeSetBody,
  decodeTensionChunk,
  decodeTensionList,
  decodeTensionStatus,
  EFFECT,
  encodeSetBody,
  fixStage,
  newStage,
  paramRange,
  programPicture,
  SET_BODY_BYTES,
  setValid,
  stageValid,
  STARTER_KEYS,
  STARTERS,
  zoneLevels,
  type TensionSet,
  type TensionStage,
} from "../../src/protocol/tension";

const hex = (s: string) => s.split(" ").map((b) => parseInt(b, 16));
// TENSION.md §3, "The bow": R2's three stages as the table gives their bytes.
const BOW_STAGE_BYTES = [
  hex("03 00 01 1E 00 00 00 00 F2 FF 0F 82 08 32"),
  hex("00 00 00 00 00 00 00 00 F2 FF 00 00 00 00"),
  hex("01 00 01 00 00 00 00 00 00 F1 00 02 08 00"),
];
const bow: TensionSet = { name: "Bow", l2: { stages: [], policy: "fill" }, r2: { stages: BOW_R2_STAGES, policy: "replace" } };
const stage = (over: Partial<TensionStage>): TensionStage => ({ ...newStage(EFFECT.feedback), ...over });

describe("Tension's SetBody (TENSION.md §2)", () => {
  it("encodes the bow of §3 byte for byte: R2's Program is 03 01, the three stages, then 14 zero bytes", () => {
    const b = encodeSetBody(bow);
    expect(b).toHaveLength(SET_BODY_BYTES);
    expect([b[0], b[1]]).toEqual([1, 0]); // ver 1, flags 0
    expect([...b.subarray(2, 18)]).toEqual([0x42, 0x6f, 0x77, ...new Array(13).fill(0)]); // "Bow", NUL-padded
    expect([...b.subarray(18, 76)]).toEqual(new Array(58).fill(0)); // L2: count 0 (left to the game), Fill in
    expect([...b.subarray(76, 134)]).toEqual([3, 1, ...BOW_STAGE_BYTES.flat(), ...new Array(14).fill(0)]);
  });

  it("decodes what it encodes, for the bow and every starter set", () => {
    expect(decodeSetBody(encodeSetBody(bow))).toEqual(bow);
    // loop: test
    for (const k of STARTER_KEYS) {
      expect(setValid(STARTERS[k]), k).toBe(true);
      expect(decodeSetBody(encodeSetBody(STARTERS[k])), k).toEqual(STARTERS[k]);
    }
    // The bow starter is §3's stages (Fill in, where the example is Replace).
    expect([...encodeSetBody(STARTERS.bow).subarray(78, 120)]).toEqual(BOW_STAGE_BYTES.flat());
  });

  it("reads nothing it shouldn't: a newer ver, bytes after the name's NUL, a stage past count, reserved ramp bits", () => {
    const good = encodeSetBody(bow);
    const bad = (at: number, v: number) => {
      const b = good.slice();
      b[at] = v;
      return decodeSetBody(b);
    };
    expect(bad(0, 2)).toBeNull();
    expect(bad(1, 1)).toBeNull();
    expect(bad(10, 0x41)).toBeNull(); // after the first NUL
    expect(bad(3, 0x80)).toBeNull(); // not ASCII
    expect(bad(18 + 2, 1)).toBeNull(); // L2 stage 0 set while count is 0
    expect(bad(76 + 2 + 11, 0x8a)).toBeNull(); // ramp bits 3..6
    expect(bad(76 + 1, 2)).toBeNull(); // policy 2
    expect(decodeSetBody(good.subarray(0, 133))).toBeNull();
  });

  it("validates as tension.h does (Sony's ranges, end after start, unused parameters 0, the ramp's end value)", () => {
    const weapon = (p: number[]) => stageValid(stage({ mode: EFFECT.weapon, p: [...p, 0, 0, 0, 0] }));
    expect(weapon([2, 3, 8])).toBe(true);
    expect(weapon([1, 3, 8])).toBe(false); // Weapon starts at zone 2 at the earliest
    expect(weapon([7, 7, 8])).toBe(false); // end after start
    expect(weapon([2, 9, 8])).toBe(false); // end ≤ 8
    expect(stageValid(stage({ mode: EFFECT.feedback, p: [0, 9, 0, 0, 0, 0, 0] }))).toBe(false); // 8 levels
    expect(stageValid(stage({ mode: EFFECT.feedback, p: [0, 4, 1, 0, 0, 0, 0] }))).toBe(false); // an unused parameter not 0
    expect(stageValid(stage({ pullMin: 10, pullMax: 9 }))).toBe(false);
    // A ramp by pull needs a window; by hold, a time; the end value must be a valid effect.
    expect(stageValid(stage({ pullMin: 50, pullMax: 50, ramp: { param: 1, to: 8, by: "pull" } }))).toBe(false);
    expect(stageValid(stage({ ramp: { param: 1, to: 8, by: "hold", tenths: 0 } }))).toBe(false);
    expect(stageValid(stage({ ramp: { param: 1, to: 9, by: "pull" } }))).toBe(false);
    expect(stageValid(stage({ mode: EFFECT.multiFeedback, p: [0x44, 0x44, 0x44, 0x44, 0x44, 0, 0], ramp: { param: 0, to: 0, by: "pull" } }))).toBe(false); // zones don't ramp
    expect(setValid({ ...bow, name: "" })).toBe(false);
    expect(setValid({ ...bow, name: "seventeen chars!!" })).toBe(false);
    expect(() => encodeSetBody({ ...bow, name: "Bogen ä" })).toThrow();
  });

  it("keeps edits valid: an end follows its start, a ramp's end stays in range", () => {
    const s = fixStage(stage({ mode: EFFECT.weapon, p: [6, 4, 5, 0, 0, 0, 0], ramp: { param: 0, to: 8, by: "pull" } }));
    expect(s.p.slice(0, 3)).toEqual([6, 7, 5]);
    expect(s.ramp).toEqual({ param: 0, to: 6, by: "pull" }); // the start may ramp only below the end (7)
    expect(stageValid(s)).toBe(true);
    expect(paramRange(EFFECT.weapon, 1, s.p)).toEqual([7, 8]);
    // loop: test — every effect's new stage is one the board takes
    for (let mode = 0; mode < 10; mode++) expect(stageValid(newStage(mode)), `mode ${mode}`).toBe(true);
  });

  it("checks CRC-32 against zlib's check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("the 0xE9 replies (TENSION.md §7)", () => {
  it("status: flags, the choices and each trigger's owner, stage, pull and time held; null when short or not 'TN'", () => {
    const b = new Uint8Array(38);
    b.set([0x54, 0x4e, 1, 0x01 | 0x04, 2, 5, 8, 4]);
    b.set([1, 2, 200, 17, 0x21], 8); // L2: Tension, stage 2, pull 200, 1.7 s, effect 0x21…
    b.set([3, 0xff, 10, 0], 23); // R2: Fill in waiting for the hold-off
    const s = decodeTensionStatus(b)!;
    expect(s.running && s.temporary && !s.feelIt && !s.newerStore && !s.paused).toBe(true);
    expect([s.savedChoice, s.choiceNow, s.slots, s.stages]).toEqual([2, 5, 8, 4]);
    expect(s.triggers[0]).toMatchObject({ owner: "tension", stage: 2, pull: 200, heldTenths: 17 });
    expect(s.triggers[0].effect[0]).toBe(0x21);
    expect(s.triggers[1]).toMatchObject({ owner: "waiting", stage: null, pull: 10 });
    expect(decodeTensionStatus(b.subarray(0, 37))).toBeNull();
    expect(decodeTensionStatus(new Uint8Array(38))).toBeNull();
  });

  it("list: the used mask, the CRCs and the choices (0xFF = none); a chunk checks its slot and number", () => {
    const b = new Uint8Array(38);
    b.set([1, 8, 0b101, 0xff, 2, 0x08]);
    new DataView(b.buffer).setUint32(6 + 4 * 2, 0xdeadbeef, true);
    const l = decodeTensionList(b)!;
    expect(l.used).toEqual([true, false, true, false, false, false, false, false]);
    expect(l.crcs[2]).toBe(0xdeadbeef);
    expect([l.savedChoice, l.choiceNow, l.newerStore]).toEqual([null, 2, true]);
    expect(decodeTensionList(b.subarray(0, 30))).toBeNull();
    const c = new Uint8Array(26);
    c.set([1, 3, 2, 1, 7]);
    expect(decodeTensionChunk(c, 3, 2)).toEqual({ used: true, bytes: c.slice(4) });
    expect(decodeTensionChunk(c, 4, 2)).toBeNull();
    expect(decodeTensionChunk(c.subarray(0, 25), 3, 2)).toBeNull();
  });
});

describe("the picture", () => {
  it("Slope Feedback's zones round as the board does; a stage behind an earlier one with no hold time is cut short", () => {
    expect(zoneLevels(EFFECT.slopeFeedback, [0, 9, 1, 8, 0, 0, 0])).toEqual([1, 2, 3, 3, 4, 5, 6, 6, 7, 8]);
    expect(zoneLevels(EFFECT.feedback, [3, 0, 0, 0, 0, 0, 0])).toEqual(new Array(10).fill(0)); // strength 0 is Off
    const pics = programPicture({ policy: "fill", stages: [stage({ pullMin: 0, pullMax: 100 }), stage({ pullMin: 50, pullMax: 200 }), stage({ pullMin: 10, pullMax: 90 })] });
    expect(pics.map((p) => [p.cutShort, p.never])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
    // The bow's draw (ramp by pull): strength 1 at the start of its window, 8 at its end.
    const draw = programPicture({ policy: "replace", stages: [BOW_R2_STAGES[2]] })[0].points;
    expect(draw[0]).toEqual([0, 1]);
    expect(draw.at(-1)).toEqual([241, 8]);
  });
});
