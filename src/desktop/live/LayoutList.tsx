// Button layouts, the one list (protocol 1.24, docs/design/button-layouts-2026-11.md
// §2.4): every layout once, whether it is kept on this PC (the library), on
// the board (its eight slots), or both. Load puts one in the editor; Update
// writes the editor into it; Put on the board / Take off the board / Run from
// power-on are drafts the save bar writes (page rule 4); the library's own
// changes (Update, Delete, Save as layout) are saved at once, as before.
// Idle cost: none (static rows, rebuilt when the library or the board's
// layouts change).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { changedSources, emptyButtonPart, partFromLegacy } from "../../protocol/buttons";
import type { TensionSet } from "../../protocol/tension";
import { SectionGroup } from "../accordion/Section";
import { useLibrary } from "../library/libraryContext";
import type { LibraryFile } from "../games/library";
import { shown } from "../shownError";
import { useBoardDrafts } from "./boardDrafts";
import { changedLine } from "./buttonWords";
import { firstFreeSlot, layoutRecord, layoutSet, sameLayout, shownButtons, slotOnBoard } from "./layoutEditor";

// How many game profiles use each layout: one pass over the games per library change.
export function useLayoutUses(games: LibraryFile["games"]): Map<string, number> {
  return useMemo(() => {
    const m = new Map<string, number>();
    // loop: HOT-PATH-OK — N = games with a profile (tens to hundreds); once per library change
    for (const g of Object.values(games)) {
      const id = g.profile?.settings.buttonLayout;
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [games]);
}

interface Item {
  key: string;
  name: string;
  set: TensionSet; // buttons always there
  id: string | null; // the library's id; null = only on the board
  slot: number; // on the board in this slot, or -1
}

export function LayoutList() {
  const { t } = useTranslation();
  const desktop = window.desktop;
  const { library, setLibrary } = useLibrary();
  const { tension: tn, layout: editor, remap } = useBoardDrafts();
  const legacy = useMemo(() => (remap.supported ? partFromLegacy(remap.device, remap.extraDevice) : emptyButtonPart()), [remap.supported, remap.device, remap.extraDevice]);
  const items = useMemo(() => {
    const out: Item[] = [];
    const matched = new Set<number>();
    // loop: HOT-PATH-OK — N = saved layouts (a few) × 8 slots; once per library or board change (useMemo)
    for (const [id, l] of Object.entries(library.layouts ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name))) {
      const set = layoutSet(l);
      const slot = slotOnBoard(tn.sets, set);
      if (slot >= 0) matched.add(slot);
      out.push({ key: id, name: l.name, set, id, slot });
    }
    // loop: NOT-WORTH — N = 8 slots, once per library or board change (useMemo)
    tn.sets.forEach((s, slot) => {
      if (s && !matched.has(slot)) out.push({ key: `slot-${slot}`, name: s.name, set: { ...s, buttons: shownButtons(s, legacy) }, id: null, slot });
    });
    return out;
  }, [library.layouts, tn.sets, legacy]);
  const uses = useLayoutUses(library.games);
  if (!desktop) return null;
  const board = tn.loaded && !tn.readOnly;
  const free = firstFreeSlot(tn.sets);
  const save = (id: string, layoutName: string, set: TensionSet) => void desktop.librarySetLayout(layoutRecord(id, layoutName, set)).then(setLibrary).catch(shown("desktop.errors.layoutSave"));
  const summary = (set: TensionSet) => {
    const part = set.buttons ?? emptyButtonPart();
    // loop: HOT-PATH-OK — N ≤ 22 changed buttons per row; rebuilt per render of the list
    const lines = changedSources(part, 0).map((s) => changedLine(t, part, 0, s));
    if (part.layers.length) lines.push(t("desktop.layouts.layers", { count: part.layers.length }));
    if (set.l2.stages.length || set.r2.stages.length) lines.push(t("desktop.layouts.triggerEffects"));
    return lines.length ? lines.join(" · ") : t("desktop.layouts.noChanges");
  };
  return (
    <SectionGroup title={t("desktop.layouts.title")} info={t("desktop.layouts.hintBoard")}>
      {items.length === 0 ? (
        <p className="dk-hint">{t("desktop.layouts.none")}</p>
      ) : (
        <ul className="dk-layouts">
          {/* loop: HOT-PATH-OK — N = layouts (a few, ≤ 8 on the board); only on a library, board or editor change */}
          {items.map((it) => {
            const inEditor = sameLayout(it.set, editor.layout);
            const used = it.id ? (uses.get(it.id) ?? 0) : 0;
            return (
              <li key={it.key} className={inEditor ? "loaded" : undefined}>
                <div className="dk-layout-info">
                  <span className="dk-layout-name" title={it.name}>
                    {it.name}
                  </span>
                  {inEditor && <span className="dk-chip ok">{t("desktop.layouts.loadedChip")}</span>}
                  {it.slot >= 0 && <span className="dk-chip">{t("desktop.layouts.onBoard")}</span>}
                  {it.slot >= 0 && it.slot === tn.choice && <span className="dk-chip ok">{t("desktop.layouts.runs")}</span>}
                  {used > 0 && <span className="dk-hint"> · {t("desktop.layouts.usedBy", { count: used })}</span>}
                  <span className="dk-layout-changes">{summary(it.set)}</span>
                </div>
                <div className="dk-layout-btns">
                  {!inEditor && (
                    <button type="button" className="dk-btn" title={t("desktop.layouts.loadHintBoard")} onClick={() => editor.edit({ ...it.set })}>
                      {t("desktop.layouts.load")}
                    </button>
                  )}
                  {it.id && !inEditor && (
                    <button
                      type="button"
                      className="dk-btn"
                      title={t("desktop.layouts.updateHint", { name: it.name })}
                      onClick={() => {
                        save(it.id!, it.name, editor.layout);
                        // Its copy on the board follows (a draft for the save bar).
                        if (board && it.slot >= 0 && it.slot !== editor.slot) tn.edit(it.slot, editor.layout);
                      }}
                    >
                      {t("desktop.layouts.update")}
                    </button>
                  )}
                  {board && it.slot < 0 && free >= 0 && (
                    <button type="button" className="dk-btn" title={t("desktop.layouts.putOnBoardHint")} onClick={() => tn.edit(free, it.set)}>
                      {t("desktop.layouts.putOnBoard")}
                    </button>
                  )}
                  {board && it.slot >= 0 && it.slot !== tn.choice && (
                    <button type="button" className="dk-btn" onClick={() => tn.choose(it.slot)}>
                      {t("desktop.layouts.runFromPowerOn")}
                    </button>
                  )}
                  {board && it.slot >= 0 && (
                    <button type="button" className="dk-btn" onClick={() => tn.edit(it.slot, null)}>
                      {t("desktop.layouts.takeOff")}
                    </button>
                  )}
                  {it.id && <DeleteLayout id={it.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* loop: HOT-PATH-OK — N = layouts (a few) */}
      {board && free < 0 && items.some((it) => it.slot < 0) && <p className="dk-hint">{t("desktop.layouts.boardFull")}</p>}
      <SaveAsLayout onSave={(layoutName) => save(`l-${Date.now().toString(36)}`, layoutName, editor.layout)} />
    </SectionGroup>
  );
}

// Delete a library layout (games using it go back to the normal buttons).
export function DeleteLayout({ id }: { id: string }) {
  const { t } = useTranslation();
  const { setLibrary } = useLibrary();
  const desktop = window.desktop;
  if (!desktop) return null;
  return (
    <button type="button" className="dk-btn danger" title={t("desktop.layouts.deleteHint")} onClick={() => void desktop.libraryDeleteLayout(id).then(setLibrary).catch(shown("desktop.errors.layoutDelete"))}>
      {t("desktop.layouts.delete")}
    </button>
  );
}

// Save as layout: a name, then the caller saves what's in the editor under it.
export function SaveAsLayout({ onSave }: { onSave: (name: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  return (
    <form
      className="dk-row dk-layout-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave(name.trim());
        setName("");
      }}
    >
      <input className="dk-input" maxLength={40} placeholder={t("desktop.layouts.namePlaceholder")} aria-label={t("desktop.layouts.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="dk-btn primary" disabled={!name.trim()}>
        {t("desktop.layouts.saveAs")}
      </button>
    </form>
  );
}
