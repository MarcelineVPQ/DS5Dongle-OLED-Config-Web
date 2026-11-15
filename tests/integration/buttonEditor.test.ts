// @vitest-environment jsdom
// Button assignments' layout editor (protocol 1.24, docs/design/button-layouts-2026-11.md)
// on the simulated board: it opens on the editor with no prerequisite and no
// word "set"; the layout in the editor is the one that runs from power-on
// (none yet: the first free slot, which then runs), staged and written only by
// the save bar (page rule 4); a picked button reads as sentences; the target
// picker's Controller grid and Key tab work from the keyboard; Hold brings its
// plain-word cost; layers add, inherit and reset; older firmware keeps today's
// list; the drawing badges changed buttons only.
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { buttonTarget, DISABLE, emptyButtonPart, SOURCE, TARGET_KIND, withBasePress, withRow } from "../../src/protocol/buttons";
import { DEFAULT_CONFIG } from "../../src/protocol/config";
import { decodeSetWire } from "../../src/protocol/tension";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { BoardDraftsProvider, useBoardDrafts, type BoardDrafts } from "../../src/desktop/live/boardDrafts";
import { ButtonAssignments, LayerTabs, newlyPressed } from "../../src/desktop/live/ButtonEditor";
import { layoutBadges } from "../../src/desktop/live/buttonWords";
import { FakeDongle, type FakeDongleOptions } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => i18n.changeLanguage("en"));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.restoreAllMocks();
});
// jsdom can't focus inside a popover="manual" element (as tests/integration/popups.test.ts):
// leave the attribute off, since the keyboard focus is what these tests check.
const noPopover = () => {
  const set = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (this: Element, name: string, value: string) {
    if (name !== "popover") set.call(this, name, value);
  });
};
beforeEach(noPopover);

const button = (text: string) => [...container!.querySelectorAll("button")].find((x) => x.textContent === text);
const wait = async (until: () => boolean) => {
  // loop: test — a few reads of the simulated board
  for (let i = 0; i < 100 && !until(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
};
const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

const seen: { d: BoardDrafts | null } = { d: null };
function Harness({ bridge }: { bridge: UseDs5BridgeResult }) {
  const d = useBoardDrafts();
  const [pick, setPick] = useState<number | null>(null);
  const [layer, setLayer] = useState(0);
  // lifetime: OK — acquires nothing (hands the drafts to the test, starts the board's read)
  useEffect(() => {
    seen.d = d;
    d.tension.load();
  });
  if (!d.layout.ready) return null;
  const part = d.layout.layout.buttons ?? emptyButtonPart();
  return createElement(
    "div",
    null,
    createElement(LayerTabs, { part, layer, onLayer: setLayer, onChange: (buttons) => d.layout.edit({ ...d.layout.layout, buttons }) }),
    createElement(ButtonAssignments, { bridge, pick, onPick: setPick, layer, onLayer: setLayer, edge: false, live: { truth: null, error: null } }),
  );
}

async function open(opts: FakeDongleOptions = {}, prepare?: (d: FakeDongle) => void) {
  const dongle = new FakeDongle(opts);
  prepare?.(dongle);
  const client = new Ds5BridgeClient(dongle);
  const identity = await client.identity();
  const draft = { ...DEFAULT_CONFIG };
  const bridge = {
    client,
    identity: identity as BridgeIdentity,
    operation: null,
    isConnected: true,
    draft,
    setDraftField: (k: "keysMouse", v: boolean) => (draft[k] = v),
    reconnectUsb: () => Promise.resolve(),
  } as unknown as UseDs5BridgeResult;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(BoardDraftsProvider, { bridge }, createElement(Harness, { bridge }))));
  await wait(() => !!container!.querySelector(".bt-layers") || seen.d?.layout.ready === false);
  return { dongle, client };
}
const pickButton = (source: number) => choose([...container!.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.text === i18n.t("desktop.buttons.pickNone")))!, String(source));
const rowButton = (row: string) => {
  const r = [...container!.querySelectorAll(".dk-row")].find((x) => x.querySelector(".dk-label")?.firstChild?.textContent === i18n.t(`desktop.buttons.row.${row}`));
  return r!.querySelector<HTMLButtonElement>(".bt-target")!;
};
const focused = () => document.activeElement as HTMLElement;

describe("Button assignments opens on the layout editor", () => {
  it("first open: the editor, no prerequisite, no word 'set'; the Changed list starts empty", async () => {
    await open();
    expect(seen.d!.layout.ready).toBe(true);
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.pickHint"));
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.noneChanged"));
    expect(container!.textContent).toContain(i18n.t("desktop.layers.base"));
    expect(container!.textContent).not.toMatch(/\bsets?\b/i);
  });

  it("starts from today's table when no layout runs; Press set from the grid by keyboard; staged into the first free slot, which runs from power-on", async () => {
    const { dongle } = await open({}, (d) => {
      d.remap = Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : i === 1 ? 0 : i)); // L2 ↔ L1 in today's table
      d.flashRemap = d.remap.slice();
    });
    await wait(() => container!.textContent!.includes("L2 → L1"));
    expect(container!.textContent).toContain("L2 → L1");
    pickButton(SOURCE.cross);
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.does", { button: "Cross ✕" }));
    const press = rowButton("press");
    expect(press.textContent).toBe(`Cross ✕ (${i18n.t("desktop.live.remapDefault")})`);
    act(() => press.click());
    expect(container!.querySelector(".bt-pop")?.getAttribute("role")).toBe("dialog");
    expect(focused().textContent).toBe("✕");
    act(() => focused().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(focused().textContent).toBe("△");
    act(() => focused().click());
    expect(container!.querySelector(".bt-pop")).toBeNull();
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.noCross"));
    expect(seen.d!.tension.choice).toBe(0);
    expect(seen.d!.staged).toBe(true);
    expect(dongle.tension.slots[0]).toBeNull(); // nothing on the board until Save
    await act(async () => void (await seen.d!.saveStaged()));
    const saved = decodeSetWire(dongle.tension.slots[0]!)!;
    expect(saved.buttons!.entries.map((e) => [e.source, e.press])).toEqual([
      [SOURCE.l2, buttonTarget(SOURCE.l1)],
      [SOURCE.l1, buttonTarget(SOURCE.l2)],
      [SOURCE.cross, buttonTarget(SOURCE.triangle)],
    ]);
    expect(dongle.tension.saved).toBe(0);
  });

  it("Escape returns to the row, Disable, Hold with its cost, a key from the Key tab, Reset this button", async () => {
    await open();
    pickButton(SOURCE.r1);
    const press = rowButton("press");
    act(() => press.click());
    act(() => focused().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container!.querySelector(".bt-pop")).toBeNull();
    expect(focused()).toBe(press);
    act(() => press.click());
    act(() => button(i18n.t("remap.disabled"))!.click());
    expect(seen.d!.layout.layout.buttons!.entries).toEqual([{ source: SOURCE.r1, layer: 0, press: DISABLE }]);
    // Hold → △, with its plain-word cost under it.
    act(() => rowButton("hold").click());
    act(() => container!.querySelector<HTMLButtonElement>('.bt-cell[aria-label="Triangle △"]')!.click());
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.holdCost", { button: "R1" }));
    expect(seen.d!.layout.layout.buttons!.entries[0]).toMatchObject({ hold: buttonTarget(SOURCE.triangle), holdTime: 30 });
    // Double press → a key: the Key tab, armed, takes F5 with Ctrl held.
    act(() => rowButton("double").click());
    act(() => button(i18n.t("desktop.buttons.tab.key"))!.click());
    const capture = button(i18n.t("desktop.buttons.target.pressKey"))!;
    act(() => {
      capture.focus();
      capture.click();
    });
    act(() => focused().dispatchEvent(new KeyboardEvent("keydown", { key: "F5", code: "F5", ctrlKey: true, bubbles: true })));
    expect(seen.d!.layout.layout.buttons!.entries[0].double).toEqual({ kind: TARGET_KIND.key, a: 0x3e, b: 0x01 });
    // Keys and mouse are off on the board: said, with the one-click fix.
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.needsKeys"));
    expect(button(i18n.t("desktop.buttons.turnOn"))).toBeTruthy();
    act(() => button(i18n.t("desktop.buttons.resetButton"))!.click());
    expect(seen.d!.layout.layout.buttons!.entries).toEqual([]);
  });

  it("layers: + Layer adds a tab; a button is same as base until switched off; Delete layer removes it", async () => {
    await open();
    act(() => button(i18n.t("desktop.layers.add"))!.click());
    expect(seen.d!.layout.layout.buttons!.layers).toHaveLength(1);
    expect(container!.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(i18n.t("desktop.layers.defaultName", { n: 1 }));
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.layerNoEntry"));
    pickButton(SOURCE.square);
    const same = [...container!.querySelectorAll<HTMLButtonElement>('[role="switch"]')][0];
    expect(same.getAttribute("aria-checked")).toBe("true");
    act(() => same.click());
    expect(seen.d!.layout.layout.buttons!.entries).toEqual([{ source: SOURCE.square, layer: 1, press: buttonTarget(SOURCE.square) }]);
    act(() => button(i18n.t("desktop.layers.delete"))!.click());
    expect(seen.d!.layout.layout.buttons!.layers).toEqual([]);
    expect(seen.d!.layout.layout.buttons!.entries).toEqual([]);
  });

  it("firmware without press types or layers ([58] = bit 0 only): Press only, no tabs, no presets", async () => {
    await open({ features5: 0x01 });
    expect(seen.d!.layout.ready).toBe(true);
    pickButton(SOURCE.cross);
    expect(container!.textContent).not.toContain(i18n.t("desktop.buttons.row.hold"));
    expect(container!.textContent).not.toContain(i18n.t("desktop.buttons.presets"));
  });

  it("older firmware (no [58] bit 0): no editor (Button assignments keeps today's list)", async () => {
    await open({ features5: 0 });
    expect(seen.d!.layout.ready).toBe(false);
  });
});

describe("the drawing", () => {
  const t = i18n.t.bind(i18n) as never;
  it("badges only the changed buttons; a layer shows the base's dimmed and its own plainly", () => {
    let p = withBasePress(withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.r2)), SOURCE.l1, DISABLE);
    expect([...layoutBadges(t, p, 0).keys()]).toEqual(["l1", "cross"]);
    expect(layoutBadges(t, p, 0).get("cross")!.text).toBe("→ R2");
    expect(layoutBadges(t, p, 0).get("l1")!.text).toBe(`→ ${i18n.t("desktop.layouts.off")}`);
    p = { ...p, layers: [{ name: "Vehicle", colour: 2, gyro: 0 }] };
    p = withRow(p, 0, SOURCE.r1, "hold", { kind: TARGET_KIND.layer, a: 1, b: 0 });
    p = withRow(p, 1, SOURCE.square, "press", buttonTarget(SOURCE.circle));
    const inLayer = layoutBadges(t, p, 1);
    expect(inLayer.get("cross")).toMatchObject({ dim: true });
    expect(inLayer.get("square")).toMatchObject({ text: "→ ○", dim: false });
    expect(layoutBadges(t, p, 0).get("r1")).toMatchObject({ dot: true, colour: 2 });
  });

  it("picks a button on its rising edge in the live input, not while it stays down", () => {
    expect(newlyPressed(new Set(), new Set(["cross"]))).toBe(SOURCE.cross);
    expect(newlyPressed(new Set(["cross"]), new Set(["cross"]))).toBeNull();
    expect(newlyPressed(new Set(), new Set(["mute"]))).toBeNull(); // not a source
  });
});
