// @vitest-environment jsdom
// Tension (protocol 1.23) end to end on the simulated board, which follows
// the firmware's tension.cpp: the client stages a set in three SETs and
// commits it with its CRC-32, reads the slots back by their CRC, Feel it runs
// the staged set, a game's choice is for now only and 0x12 / 0xFE end it, and
// the board's refusals are said in plain words. From 1.24 a slot is a whole
// button layout (trigger effects + buttons), sent for now with 0x22, and the
// board reports what it sent (0xE8). Then the Controller page's Tension group:
// on 1.24 it edits the layout in the editor's trigger effects, on 1.23 its own
// slots; either way staged and written only by the save bar's Save (page rule 4).
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { CommandError, Ds5BridgeClient, FEATURES4, FUNC, supportsTension, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { crc32, decodeSetBody, decodeSetWire, encodeSetBody, encodeSetWire, STARTERS } from "../../src/protocol/tension";
import { buttonTarget, emptyButtonPart, SOURCE, withBasePress } from "../../src/protocol/buttons";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { BoardDraftsProvider, useBoardDrafts, type BoardDrafts } from "../../src/desktop/live/boardDrafts";
import { tensionErrorText } from "../../src/desktop/live/tensionDraft";
import { TensionSection } from "../../src/desktop/live/Tension";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => i18n.changeLanguage("en"));

async function board(protoMinor?: number) {
  const dongle = new FakeDongle(protoMinor === undefined ? {} : { protoMinor });
  const client = new Ds5BridgeClient(dongle);
  const identity = await client.identity();
  return { dongle, client, identity };
}
const tensionSets = (d: FakeDongle) => d.sets.filter((p) => p[0] >= 0x1c && p[0] <= 0x20);

describe("whole layouts on the board (protocol 1.24, TENSION_BUTTONS.md §6)", () => {
  const swapped = { ...STARTERS.heavy, buttons: withBasePress(withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.circle)), SOURCE.circle, buttonTarget(SOURCE.cross)) };

  it("stages the 494 bytes in nine ver-2 SETs (each ≤ 63 bytes), saves with the CRC of all of them, reads them back by it", async () => {
    const { dongle, client, identity } = await board();
    expect(client.setButtons && (identity.features5 & 0x01) !== 0).toBe(true);
    await client.saveTensionSet(2, swapped);
    const sent = tensionSets(dongle);
    expect(sent.map((p) => p[0])).toEqual([...new Array(9).fill(FUNC.tensionStage), FUNC.tensionSave]);
    expect(Math.max(...sent.map((p) => p.length))).toBe(63);
    expect(sent.slice(0, 9).map((p) => [p[1], p[2] | (p[3] << 8)])).toEqual([0, 59, 118, 177, 236, 295, 354, 413, 472].map((at) => [2, at]));
    const crc = crc32(encodeSetWire(swapped));
    expect([...sent[9].subarray(1)]).toEqual([2, 2, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]);
    expect(decodeSetWire(dongle.tension.slots[2]!)).toEqual(swapped);
    const list = (await client.readTensionList())!;
    expect(list.crcs[2]).toBe(crc);
    expect(await client.readTensionSet(2, crc)).toEqual(swapped);
  });

  it("Feel it ver 2 runs triggers and buttons; a 1.23 app's ver-1 save keeps the slot's buttons", async () => {
    const { dongle, client } = await board();
    await client.feelTension(swapped);
    expect(decodeSetWire(dongle.tension.feel!)).toEqual(swapped);
    await client.saveTensionSet(4, swapped);
    // An older app's save (0x1C / 0x1D ver 1, the SetBody only): the buttons stay.
    const body = encodeSetBody({ ...STARTERS.bow });
    for (let at = 0; at < 134; at += 60) await client.command(FUNC.tensionStage, [1, at, ...body.subarray(at, at + 60)]);
    const crc = crc32(body);
    await client.command(FUNC.tensionSave, [1, 4, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]);
    expect(decodeSetWire(dongle.tension.slots[4]!)).toEqual({ ...STARTERS.bow, buttons: swapped.buttons });
  });

  it("refuses a ButtonPart the rules don't allow (INVALID), nothing saved", async () => {
    const { dongle, client } = await board();
    const wire = encodeSetWire(swapped);
    wire[134 + 52] = 22; // source 22 doesn't exist
    for (let at = 0; at < wire.length; at += 59) await client.command(FUNC.tensionStage, [2, at & 0xff, at >> 8, ...wire.subarray(at, at + 59)]);
    const crc = crc32(wire);
    const r = await client.command(FUNC.tensionSave, [2, 0, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]).catch((e: unknown) => e);
    expect(tensionErrorText(r)).toBe(i18n.t("desktop.tension.errors.invalid"));
    expect(dongle.tension.slots[0]).toBeNull();
  });

  it("runs a layout for now (0x22, RAM only, choice now 0xFD); 0x22 [2, 0] and 0x12 end it", async () => {
    const { dongle, client } = await board();
    await client.runLayoutForNow(swapped);
    expect(decodeSetWire(dongle.tension.forNow!)).toEqual(swapped);
    expect(dongle.tension.slots.every((x) => x === null)).toBe(true); // never written to flash
    expect((await client.readTensionList())!.choiceNow).toBeNull(); // 0xFD: not a slot
    await client.runLayoutForNow(null);
    expect(dongle.tension.forNow).toBeNull();
    await client.runLayoutForNow(swapped);
    await client.revertRemap(); // a game ended
    expect(dongle.tension.forNow).toBeNull();
    // Firmware without the piece ([58] bit 6) refuses it.
    const step2 = new FakeDongle({ features5: 0x01 });
    const c2 = new Ds5BridgeClient(step2);
    await c2.identity();
    await expect(c2.runLayoutForNow(swapped)).rejects.toBeInstanceOf(CommandError);
  });

  it("pauses keys and mouse (0x21) only with [58] bit 4, and says so in identity [59]", async () => {
    const { client } = await board();
    await client.pauseKeysMouse(2);
    expect(((await client.identity()).keysMouseFlags ?? 0) & 0x02).toBe(0x02);
    await client.pauseKeysMouse(0);
    expect(((await client.identity()).keysMouseFlags ?? 0) & 0x02).toBe(0);
    const step2 = new FakeDongle({ features5: 0x01 });
    const c2 = new Ds5BridgeClient(step2);
    await c2.identity();
    await c2.pauseKeysMouse(2); // not sent at all
    expect(step2.sets.some((p) => p[0] === FUNC.buttonsPause)).toBe(false);
  });

  it("reads what the board sent (0xE8): the press, its target in the running layout, the sources down", async () => {
    const { dongle, client } = await board();
    await client.saveTensionSet(0, swapped);
    await client.chooseTension(0, false);
    expect((await client.readLiveTruth())!.last).toBeNull();
    dongle.input[7] = 0x08 | 0x20; // ✕ down (input byte 7 bit 5)
    const now = (await client.readLiveTruth())!;
    expect(now).toMatchObject({ running: true, what: 0, layer: 0, down: 1 << SOURCE.cross });
    expect(now.last).toMatchObject({ source: SOURCE.cross, type: "press", phase: "on", target: buttonTarget(SOURCE.circle) });
    dongle.input[7] = 0x08;
    expect((await client.readLiveTruth())!.last!.phase).toBe("released");
    const step2 = new Ds5BridgeClient(new FakeDongle({ features5: 0x01 }));
    await step2.identity();
    expect(await step2.readLiveTruth()).toBeNull(); // no [58] bit 3: never asked
  });
});

describe("Tension on the board (protocol 1.23)", () => {
  it("is offered from 1.23 with identity [49] bit 7, and not to older firmware", async () => {
    const now = await board();
    expect(now.identity.features4 & FEATURES4.tension).toBe(FEATURES4.tension);
    expect(supportsTension(now.identity) && now.client.tension).toBe(true);
    const old = await board(22);
    expect(supportsTension(old.identity) || old.client.tension).toBe(false);
    expect(await old.client.readTensionStatus()).toBeNull();
    await expect(old.client.saveTensionSet(0, STARTERS.bow)).rejects.toThrow();
    expect(tensionSets(old.dongle)).toEqual([]);
  });

  it("saves a set as three stage SETs (each ≤ 63 bytes) and a 0x1D with its CRC, and reads it back by that CRC (1.23)", async () => {
    const { dongle, client } = await board(23);
    await client.saveTensionSet(3, STARTERS.bow);
    const sent = tensionSets(dongle);
    expect(sent.map((p) => p[0])).toEqual([FUNC.tensionStage, FUNC.tensionStage, FUNC.tensionStage, FUNC.tensionSave]);
    expect(sent.map((p) => p.length)).toEqual([63, 63, 17, 7]);
    expect(sent.slice(0, 3).map((p) => p[2])).toEqual([0, 60, 120]); // offsets
    const crc = crc32(encodeSetBody(STARTERS.bow));
    expect([...sent[3].subarray(1)]).toEqual([1, 3, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]);
    const list = (await client.readTensionList())!;
    expect(list.used[3]).toBe(true);
    expect(list.crcs[3]).toBe(crc);
    expect(await client.readTensionSet(3, crc)).toEqual(STARTERS.bow);
    expect(await client.readTensionSet(2, 0)).toBeNull(); // an empty slot
    await expect(client.readTensionSet(3, crc ^ 1)).rejects.toThrow(); // changed between the list and the chunks
  });

  it("runs the saved choice, a game's choice for now (0x12 and 0xFE end it), and Feel it over both", async () => {
    const { client } = await board();
    await client.saveTensionSet(0, STARTERS.bow);
    await client.saveTensionSet(1, STARTERS.heavy);
    await client.chooseTension(0, false);
    expect(await client.readTensionStatus()).toMatchObject({ running: true, savedChoice: 0, choiceNow: 0, temporary: false });
    await client.chooseTension(1, true);
    expect(await client.readTensionStatus()).toMatchObject({ savedChoice: 0, choiceNow: 1, temporary: true });
    await client.revertRemap(); // a game ended (0x12): its Tension choice ends too
    expect(await client.readTensionStatus()).toMatchObject({ choiceNow: 0, temporary: false });
    await client.chooseTension(1, true);
    await client.chooseTension("saved", true);
    expect(await client.readTensionStatus()).toMatchObject({ choiceNow: 0, temporary: false });
    await client.feelTension(STARTERS.brake);
    expect(await client.readTensionStatus()).toMatchObject({ feelIt: true, choiceNow: 0 });
    await client.feelTension(null);
    expect((await client.readTensionStatus())!.feelIt).toBe(false);
    // Deleting the chosen set chooses none.
    await client.deleteTensionSet(0);
    expect(await client.readTensionList()).toMatchObject({ savedChoice: null, used: [false, true, false, false, false, false, false, false] });
  });

  it("says the board's refusals in plain words: a wrong CRC, an empty slot, sets saved by newer firmware", async () => {
    const { dongle, client } = await board();
    await expect(client.command(FUNC.tensionSave, [1, 0, 1, 2, 3, 4])).rejects.toBeInstanceOf(CommandError);
    const empty = await client.chooseTension(5, false).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(CommandError);
    expect(tensionErrorText(empty)).toBe(i18n.t("desktop.tension.errors.invalid"));
    dongle.tension.newerStore = true;
    const newer = await client.saveTensionSet(0, STARTERS.bow).catch((e: unknown) => e);
    expect(tensionErrorText(newer)).toBe(i18n.t("desktop.tension.errors.failed"));
    expect((await client.readTensionList())!.newerStore).toBe(true);
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});
const seen: { drafts: BoardDrafts | null } = { drafts: null };
const keep = (d: BoardDrafts) => {
  seen.drafts = d;
};
function Probe() {
  const d = useBoardDrafts();
  // lifetime: OK — acquires nothing (hands the drafts to the test)
  useEffect(() => keep(d));
  return null;
}
async function page(protoMinor?: number) {
  const b = await board(protoMinor);
  const bridge = { client: b.client, identity: b.identity as BridgeIdentity, operation: null, isConnected: true } as unknown as UseDs5BridgeResult;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(BoardDraftsProvider, { bridge }, createElement(TensionSection, { bridge }), createElement(Probe))));
  const ready = () => container!.textContent!.includes(i18n.t("desktop.tension.edit")) || container!.textContent!.includes(i18n.t("desktop.tension.presets"));
  // loop: test — until the board's layouts are read (a few reads of the simulated board)
  for (let i = 0; i < 100 && !ready() && (protoMinor === undefined || protoMinor >= 23); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  return b;
}
const button = (text: string) => [...container!.querySelectorAll("button")].find((x) => x.textContent === text)!;

const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("Adaptive triggers' Tension group (Controller page)", () => {
  it("1.24: edits the trigger effects of the layout in the editor; a preset replaces L2 and R2 only; the save bar writes it", async () => {
    const { dongle } = await page();
    expect(container!.textContent).not.toMatch(/\bsets?\b/i);
    act(() => button(i18n.t("desktop.tension.starters.bow")).click());
    // No layout runs yet: the first free slot takes it and runs it from power-on, staged.
    expect(seen.drafts!.staged).toBe(true);
    expect(seen.drafts!.tension.choice).toBe(0);
    expect(tensionSets(dongle)).toEqual([]);
    await act(async () => void (await seen.drafts!.saveStaged()));
    const saved = decodeSetWire(dongle.tension.slots[0]!)!;
    expect([saved.l2, saved.r2]).toEqual([STARTERS.bow.l2, STARTERS.bow.r2]);
    expect(saved.buttons).toEqual(emptyButtonPart()); // today's table had no changes
    expect(dongle.tension.saved).toBe(0);
  });

  it("1.23: its own slots: stages a starter and the saved choice; only Save writes them, Revert drops them", async () => {
    const { dongle } = await page(23);
    const edit = container!.querySelector<HTMLSelectElement>("select")!;
    expect(edit.value).toBe("0");
    act(() => button(i18n.t("desktop.tension.starters.bow")).click());
    expect(seen.drafts!.staged).toBe(true);
    expect(tensionSets(dongle)).toEqual([]); // nothing on the board yet
    expect(container!.textContent).toContain(i18n.t("desktop.tension.feel"));
    await act(async () => void (await seen.drafts!.saveStaged()));
    expect(decodeSetBody(dongle.tension.slots[0]!)).toEqual(STARTERS.bow);
    expect(seen.drafts!.staged).toBe(false);
    // What runs from power-on: staged too (the first row once a slot is saved).
    choose(container!.querySelector<HTMLSelectElement>("select")!, "0");
    expect(seen.drafts!.staged).toBe(true);
    expect(dongle.tension.saved).toBe(0xff);
    await act(async () => void (await seen.drafts!.saveStaged()));
    expect(dongle.tension.saved).toBe(0);
    // Clearing is staged as well, and Revert brings it back.
    act(() => button(i18n.t("desktop.tension.delete")).click());
    expect(seen.drafts!.staged).toBe(true);
    act(() => seen.drafts!.revertStaged());
    expect(seen.drafts!.staged).toBe(false);
    expect(dongle.tension.slots[0]).not.toBeNull();
  });

  it("older firmware: says what to update, with the link to the board's Firmware (no greyed controls)", async () => {
    await page(22);
    expect(container!.textContent).toContain(i18n.t("desktop.tension.needsFirmware"));
    expect(button(i18n.t("desktop.settings2.firmwareLink"))).toBeTruthy();
    expect(container!.querySelector("select")).toBeNull();
  });
});
