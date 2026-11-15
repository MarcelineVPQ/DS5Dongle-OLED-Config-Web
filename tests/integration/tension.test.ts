// @vitest-environment jsdom
// Tension (protocol 1.23) end to end on the simulated board, which follows
// the firmware's tension.cpp: the client stages a set in three SETs and
// commits it with its CRC-32, reads the slots back by their CRC, Feel it runs
// the staged set, a game's choice is for now only and 0x12 / 0xFE end it, and
// the board's refusals are said in plain words. Then the Controller page's
// Tension group: a starter set is staged like every other board setting and
// written only by the save bar's Save (page rule 4).
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { CommandError, Ds5BridgeClient, FEATURES4, FUNC, supportsTension, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { crc32, decodeSetBody, encodeSetBody, STARTERS } from "../../src/protocol/tension";
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

  it("saves a set as three stage SETs (each ≤ 63 bytes) and a 0x1D with its CRC, and reads it back by that CRC", async () => {
    const { dongle, client } = await board();
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
  // loop: test — until the board's sets are read (a few reads of the simulated board)
  for (let i = 0; i < 100 && !container.textContent!.includes(i18n.t("desktop.tension.edit")) && protoMinor === undefined; i++) await act(() => new Promise((r) => setTimeout(r, 10)));
  return b;
}
const button = (text: string) => [...container!.querySelectorAll("button")].find((x) => x.textContent === text)!;

describe("the Tension group (Controller page → Adaptive triggers)", () => {
  it("stages a starter set and the saved choice; only the save bar's Save writes them, Revert drops them", async () => {
    const { dongle } = await page();
    act(() => button(i18n.t("desktop.tension.starters.bow")).click());
    expect(seen.drafts!.staged).toBe(true);
    expect(tensionSets(dongle)).toEqual([]); // nothing on the board yet
    expect(container!.textContent).toContain(i18n.t("desktop.tension.feel"));
    await act(async () => void (await seen.drafts!.saveStaged()));
    expect(decodeSetBody(dongle.tension.slots[0]!)).toEqual(STARTERS.bow);
    expect(seen.drafts!.staged).toBe(false);
    // Which set runs from power-on: staged too.
    const runs = container!.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      runs.value = "0";
      runs.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(seen.drafts!.staged).toBe(true);
    expect(dongle.tension.saved).toBe(0xff);
    await act(async () => void (await seen.drafts!.saveStaged()));
    expect(dongle.tension.saved).toBe(0);
    // Delete is staged as well, and Revert brings the set back.
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
