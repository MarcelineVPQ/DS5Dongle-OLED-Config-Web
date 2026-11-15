// @vitest-environment jsdom
// Tension buttons in the Controller page (protocol 1.24, build step 2: Press
// only; the firmware's docs/TENSION_BUTTONS.md §7.2-§7.5, §7.11): Make a set
// from these buttons turns today's list into a staged set that the save bar
// writes (page rule 4), the set editor reads like sentences with its
// warnings in plain words, the target picker is a keyboard-usable grid with
// Disable, and the drawing gets badges for changed buttons only.
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { Ds5BridgeClient, type BridgeIdentity } from "../../src/protocol/bridgeClient";
import { buttonTarget, DISABLE, emptyButtonPart, SOURCE, withBasePress } from "../../src/protocol/buttons";
import { decodeSetWire, STARTERS, type TensionSet } from "../../src/protocol/tension";
import type { UseDs5BridgeResult } from "../../src/hooks/useDs5Bridge";
import { BoardDraftsProvider, useBoardDrafts, type BoardDrafts } from "../../src/desktop/live/boardDrafts";
import { MakeSetFromButtons, newlyPressed, SetButtonsEditor, setBadges } from "../../src/desktop/live/SetButtons";
import { FakeDongle } from "../support/fakeDongle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => i18n.changeLanguage("en"));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});
const mount = (el: ReturnType<typeof createElement>) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(el));
};
const button = (text: string) => [...container!.querySelectorAll("button")].find((x) => x.textContent === text);
const wait = async (until: () => boolean) => {
  // loop: test — a few reads of the simulated board
  for (let i = 0; i < 100 && !until(); i++) await act(() => new Promise((r) => setTimeout(r, 10)));
};

describe("Make a set from these buttons (§7.4)", () => {
  it("copies today's changed buttons into the first empty slot as a staged set, the saved choice; the save bar writes it", async () => {
    const dongle = new FakeDongle();
    dongle.remap = Array.from({ length: 16 }, (_, i) => (i === 13 ? 12 : i === 12 ? 13 : i)); // ✕ ↔ ○ in today's table
    const client = new Ds5BridgeClient(dongle);
    const identity = await client.identity();
    const bridge = { client, identity: identity as BridgeIdentity, operation: null, isConnected: true } as unknown as UseDs5BridgeResult;
    const seen: { d: BoardDrafts | null } = { d: null };
    function Make() {
      const d = useBoardDrafts();
      // lifetime: OK — acquires nothing (hands the drafts to the test, starts the sets' read)
      useEffect(() => {
        seen.d = d;
        d.tension.load();
      });
      return d.tension.loaded && d.remap.supported ? createElement(MakeSetFromButtons, { tn: d.tension, remap: d.remap }) : null;
    }
    mount(createElement(BoardDraftsProvider, { bridge }, createElement(Make)));
    await wait(() => !!button(i18n.t("desktop.buttons.makeSet")));
    expect(seen.d!.tension.editing).toBeNull(); // Without a set, first
    act(() => button(i18n.t("desktop.buttons.makeSet"))!.click());
    const set = seen.d!.tension.sets[0]!;
    expect(set.name).toBe("Buttons");
    expect(set.buttons!.entries.map((e) => [e.source, e.press])).toEqual([
      [SOURCE.circle, buttonTarget(SOURCE.cross)],
      [SOURCE.cross, buttonTarget(SOURCE.circle)],
    ]);
    expect([seen.d!.tension.choice, seen.d!.tension.editing, seen.d!.staged]).toEqual([0, 0, true]);
    expect(dongle.tension.slots[0]).toBeNull(); // nothing on the board until Save
    await act(async () => void (await seen.d!.saveStaged()));
    expect(decodeSetWire(dongle.tension.slots[0]!)).toEqual(set);
    expect(dongle.tension.saved).toBe(0);
    expect(dongle.remap[13]).toBe(12); // today's table is never changed by it
  });
});

function Editor({ start, out }: { start: TensionSet; out: { set: TensionSet | null } }) {
  const [set, setSet] = useState(start);
  const [pick, setPick] = useState<number | null>(null);
  out.set = set;
  return createElement(SetButtonsEditor, { set, onChange: setSet, pick, onPick: setPick, edge: false });
}

describe("the set's button editor (§7.3, §7.5, §7.6)", () => {
  const base = { ...STARTERS.empty, buttons: emptyButtonPart() };

  it("starts with the Changed list; a picked button reads as sentences, its Press set from the controller grid", () => {
    const out: { set: TensionSet | null } = { set: null };
    mount(createElement(Editor, { start: base, out }));
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.noneChanged"));
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.pickHint"));
    const pick = container!.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      pick.value = String(SOURCE.cross);
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.does", { button: "Cross ✕" }));
    // The Press row shows the button itself, "(default)".
    const target = container!.querySelector<HTMLButtonElement>(".bt-target")!;
    expect(target.textContent).toBe(`Cross ✕ (${i18n.t("desktop.live.remapDefault")})`);
    act(() => target.click());
    const grid = container!.querySelector(".bt-pop")!;
    expect(grid.getAttribute("role")).toBe("dialog");
    expect(grid.querySelector(".bt-cell.own")?.getAttribute("aria-label")).toBe(`Cross ✕ (${i18n.t("desktop.live.remapDefault")})`);
    // Arrow keys move over the controller's layout: from ✕ up to △.
    const focused = () => document.activeElement as HTMLElement;
    expect(focused().textContent).toBe("✕");
    act(() => focused().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(focused().textContent).toBe("△");
    act(() => focused().click());
    expect(container!.querySelector(".bt-pop")).toBeNull();
    expect(out.set!.buttons!.entries).toEqual([{ source: SOURCE.cross, layer: 0, press: buttonTarget(SOURCE.triangle) }]);
    // Its warnings, in plain words under the row: ✕ unreachable, and △ twice.
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.noCross"));
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.warn.duplicate", { other: "Triangle △" }));
    // Reset this button puts it back.
    act(() => button(i18n.t("desktop.buttons.resetButton"))!.click());
    expect(out.set!.buttons!.entries).toEqual([]);
  });

  it("Disable, Escape back to the row, Swap with…, the Changed list's links, Reset all", () => {
    const out: { set: TensionSet | null } = { set: null };
    mount(createElement(Editor, { start: base, out }));
    const pick = container!.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      pick.value = String(SOURCE.l1);
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const target = container!.querySelector<HTMLButtonElement>(".bt-target")!;
    act(() => target.click());
    act(() => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container!.querySelector(".bt-pop")).toBeNull();
    expect(document.activeElement).toBe(target);
    act(() => target.click());
    act(() => button(i18n.t("remap.disabled"))!.click());
    expect(out.set!.buttons!.entries).toEqual([{ source: SOURCE.l1, layer: 0, press: DISABLE }]);
    act(() => button(i18n.t("desktop.buttons.swap"))!.click());
    act(() => container!.querySelector<HTMLButtonElement>('.bt-cell[aria-label="R1"]')!.click());
    // L1's job (nothing) is R1's now, and R1's own job is L1's.
    expect(out.set!.buttons!.entries).toEqual([
      { source: SOURCE.l1, layer: 0, press: buttonTarget(SOURCE.r1) },
      { source: SOURCE.r1, layer: 0, press: DISABLE },
    ]);
    act(() => {
      pick.value = "";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const links = [...container!.querySelectorAll(".bt-changed button")].map((b) => b.textContent);
    expect(links).toEqual(["L1 → R1", `R1 → ${i18n.t("remap.disabled")}`]);
    act(() => button(i18n.t("desktop.live.remapReset"))!.click());
    expect(out.set!.buttons!.entries).toEqual([]);
  });

  it("the PS button keeps its Press (always), with nothing to swap or reset", () => {
    mount(createElement(Editor, { start: base, out: { set: null } }));
    const pick = container!.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      pick.value = String(SOURCE.ps);
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container!.textContent).toContain(i18n.t("desktop.buttons.psFixed"));
    expect(container!.querySelector(".bt-target")).toBeNull();
    expect(button(i18n.t("desktop.buttons.swap"))).toBeUndefined();
  });
});

describe("the drawing (§7.2)", () => {
  it("badges only the changed buttons, with the new job's glyph", () => {
    const t = i18n.t.bind(i18n) as never;
    const p = withBasePress(withBasePress(emptyButtonPart(), SOURCE.cross, buttonTarget(SOURCE.r2)), SOURCE.l1, DISABLE);
    const badges = setBadges(t, p);
    expect([...badges.keys()]).toEqual(["l1", "cross"]);
    expect(badges.get("cross")!.text).toBe("→ R2");
    expect(badges.get("l1")!.text).toBe(`→ ${i18n.t("desktop.layouts.off")}`);
  });

  it("picks a button on its rising edge in the live input, not while it stays down", () => {
    expect(newlyPressed(new Set(), new Set(["cross"]))).toBe(SOURCE.cross);
    expect(newlyPressed(new Set(["cross"]), new Set(["cross"]))).toBeNull();
    expect(newlyPressed(new Set(), new Set(["mute"]))).toBeNull(); // not a source
  });
});
